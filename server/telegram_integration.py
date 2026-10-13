"""TinyFrens — Telegram Mini App / Bot integration helpers (pure, unit-testable).

A Telegram Mini App is just our existing ``web/`` PWA rendered inside Telegram's
iframe, which injects ``window.Telegram.WebApp``. The interesting parts live here:

* ``validate_init_data`` verifies the HMAC-SHA256 signature Telegram attaches to
  launch data (Bot API). Passing this check means we can trust the ``user``.
* ``user_profile`` turns a Telegram user into a TinyFren pet profile so a returning
  user keeps the same fren.
* ``bot_api`` / ``classify`` / ``reply_markup`` cover JSON and media messages.
  Private chats use a ``web_app`` button; groups use a normal Mini App deep link.

Docs: https://core.telegram.org/bots/webapps  ·  https://core.telegram.org/bots/api
"""
import hashlib
import hmac
import json
import re
import time
from urllib.parse import unquote

from aiohttp import ClientSession, ClientTimeout, FormData

TG_API = 'https://api.telegram.org'

# Pet shapes / palettes mirrored from web/customize.js so a Telegram user's first
# fren looks consistent with the rest of the app.
SHAPES = ['cat', 'blob', 'robot', 'bunny', 'duck', 'pig', 'frog', 'turtle']
PALETTE = ['#a474f1', '#66c7d2', '#ffb95e', '#82eba1', '#ff82a7', '#4d96ff']


def validate_init_data(init_data, bot_token, max_age=86400):
    """Validate a Telegram ``initData`` string against the bot token.

    Returns a dict with ``user``, ``chat``, ``auth_date``, ``start_param`` and
    ``chat_instance``. Raises ``ValueError`` if the signature is missing, invalid,
    expired, or the bot is not configured. Implements the documented algorithm:
    build a data-check-string from sorted ``key=value`` pairs (excluding ``hash``),
    derive the secret via HMAC_SHA256(key=b"WebAppData", msg=bot_token), and
    compare the resulting hex digest to the supplied ``hash``.
    """
    if not isinstance(init_data, str) or not init_data:
        raise ValueError('Missing Telegram initData')
    if not bot_token:
        raise ValueError('Telegram bot is not configured')
    fields = {}
    pairs = []
    for chunk in init_data.split('&'):
        if '=' not in chunk:
            continue
        raw_key, raw_value = chunk.split('=', 1)
        key, value = unquote(raw_key), unquote(raw_value)
        if key == 'hash':
            fields['hash'] = value
            continue
        pairs.append(key + '=' + value)
        fields[key] = value
    received = fields.get('hash')
    if not received:
        raise ValueError('initData is missing its signature')
    data_check = '\n'.join(sorted(pairs))
    secret = hmac.new(b'WebAppData', bot_token.encode(), hashlib.sha256).digest()
    computed = hmac.new(secret, data_check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(computed, received):
        raise ValueError('initData signature is invalid')

    try:
        auth_date = int(fields.get('auth_date', '0'))
    except ValueError:
        auth_date = 0
    if max_age and auth_date and time.time() - auth_date > max_age:
        raise ValueError('initData has expired')

    user = None
    if 'user' in fields:
        try:
            user = json.loads(fields['user'])
        except json.JSONDecodeError:
            raise ValueError('initData user is malformed')
    chat = None
    if 'chat' in fields:
        try:
            chat = json.loads(fields['chat'])
        except json.JSONDecodeError:
            chat = None
    return {
        'user': user,
        'chat': chat,
        'auth_date': auth_date,
        'start_param': fields.get('start_param', ''),
        'chat_instance': fields.get('chat_instance', ''),
        'query_id': fields.get('query_id', ''),
    }


def user_profile(user):
    """Derive a deterministic TinyFren pet profile from a Telegram user."""
    if not isinstance(user, dict):
        raise ValueError('No Telegram user in initData')
    uid = int(user.get('id', 0) or 0)
    name = user.get('first_name') or user.get('username') or 'Fren'
    name = re.sub(r'\s+', ' ', re.sub(r'[\x00-\x1f\x7f]', '', str(name))).strip()[:20] or 'Fren'
    return {
        'name': name,
        'shape': SHAPES[uid % len(SHAPES)],
        'color': PALETTE[uid % len(PALETTE)],
    }


async def bot_api(method, payload, token, files=None):
    """Call a Telegram Bot API method. Returns (data, http_status)."""
    url = TG_API + '/bot' + token + '/' + method
    timeout = ClientTimeout(total=15)
    body = payload
    if files:
        body = FormData()
        for key, value in payload.items():
            body.add_field(key, json.dumps(value) if isinstance(value, (dict, list)) else str(value))
        for key, value in files.items():
            body.add_field(key, value, filename=key + '.gif', content_type='image/gif')
    async with ClientSession(timeout=timeout) as session:
        async with session.post(url, data=body if files else None, json=None if files else body) as response:
            return await response.json(content_type=None), response.status


def reply_markup(url, text='🐾 Open TinyFrens', private=True):
    """Open the Mini App in DMs; use a normal deep link where web_app is invalid."""
    button = {'text': text, 'web_app': {'url': url}} if private else {'text': text, 'url': url}
    return {'inline_keyboard': [[button]]}


def link_code(update):
    """Read a 12-character account-sync code from a private /link command."""
    message = update.get('message') if isinstance(update, dict) else None
    if not isinstance(message, dict) or (message.get('chat') or {}).get('type') != 'private':
        return None
    match = re.fullmatch(r'/link(?:@\w+)?\s+([A-HJ-NP-Z2-9 -]{12,16})\s*', str(message.get('text') or ''), re.I)
    if not match:
        return None
    code = re.sub(r'[-\s]', '', match.group(1)).upper()
    return code if len(code) == 12 else None


def classify(update):
    """Categorise an incoming Bot API update.

    Returns ``(kind, chat_id, chat)`` where kind is one of:
    ``start`` (a /start message), ``added`` (bot joined a group), ``message``,
    ``removed`` (bot kicked from a group) or ``unknown``.
    """
    if isinstance(update.get('message'), dict):
        msg = update['message']
        text = msg.get('text') or ''
        chat = msg.get('chat') or {}
        if text.startswith('/start'):
            return 'start', chat.get('id'), chat
        return 'message', chat.get('id'), chat
    if isinstance(update.get('my_chat_member'), dict):
        mcm = update['my_chat_member']
        status = (mcm.get('new_chat_member') or {}).get('status')
        chat = mcm.get('chat') or {}
        if status in ('member', 'administrator'):
            return 'added', chat.get('id'), chat
        return 'removed', chat.get('id'), chat
    return 'unknown', None, None


def party_room_id(chat):
    """Return a stable room id for a Telegram chat (``tg:<id>``), or None."""
    if not isinstance(chat, dict):
        return None
    cid = chat.get('id')
    if cid is None:
        return None
    return 'tg:' + str(cid)

