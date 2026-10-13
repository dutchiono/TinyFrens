"""TinyFrens — Telegram Bot Moderation & Keyword Filters.

Provides:
- Auto-responder keyword filters (`/filter <trigger> <response>`)
- Content blocklist with progressive 2-strike punishment (`/blocklist add|remove|list`)
- Admin moderation ban (`/ban` or `/aiban` in reply to a message)
- Chat administrator verification via Telegram Bot API (`getChatMember`)
"""
import re
import time

SCHEMA = '''
CREATE TABLE IF NOT EXISTS tg_filters(
    chat_id TEXT NOT NULL,
    trigger TEXT NOT NULL,
    response TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    PRIMARY KEY(chat_id, trigger)
);
CREATE TABLE IF NOT EXISTS tg_blocklist(
    chat_id TEXT NOT NULL,
    pattern TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    PRIMARY KEY(chat_id, pattern)
);
CREATE TABLE IF NOT EXISTS tg_strikes(
    chat_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    strikes INTEGER NOT NULL DEFAULT 0,
    last_violation TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(chat_id, user_id)
);
'''


def install_schema(db):
    """Ensure moderation and filter tables exist."""
    db.executescript(SCHEMA)
    db.commit()


# --- Command Parsers ---

def parse_filter_command(text):
    """Parse a filter management command.

    Returns:
      ('list', None, None)
      ('remove', trigger, None)
      ('set', trigger, response)
      or None if not a filter command.
    """
    if not isinstance(text, str):
        return None
    cleaned = text.strip()
    if re.fullmatch(r'/(?:filter|filters)(?:@\w+)?(?:\s+list)?\s*', cleaned, re.I):
        return ('list', None, None)
    match_rm = re.fullmatch(r'/filter(?:@\w+)?\s+(?:remove|delete)\s+(\S+)\s*', cleaned, re.I)
    if match_rm:
        return ('remove', match_rm.group(1).lower().lstrip('/'), None)
    match_set = re.fullmatch(r'/filter(?:@\w+)?\s+(\S+)\s+([\s\S]+)', cleaned, re.I)
    if match_set:
        first, rest = match_set.group(1), match_set.group(2).strip()
        if first.lower() in ('remove', 'delete'):
            return ('remove', rest.split()[0].lower().lstrip('/'), None)
        return ('set', first.lower().lstrip('/'), rest)
    return None


def parse_blocklist_command(text):
    """Parse a blocklist management command.

    Returns:
      ('list', None)
      ('add', pattern)
      ('remove', pattern)
      or None if not a blocklist command.
    """
    if not isinstance(text, str):
        return None
    cleaned = text.strip()
    if re.fullmatch(r'/blocklist(?:@\w+)?(?:\s+list)?\s*', cleaned, re.I):
        return ('list', None)
    match_add = re.fullmatch(r'/blocklist(?:@\w+)?\s+add\s+([\s\S]+)', cleaned, re.I)
    if match_add:
        return ('add', match_add.group(1).strip().lower())
    match_rm = re.fullmatch(r'/blocklist(?:@\w+)?\s+(?:remove|delete)\s+([\s\S]+)', cleaned, re.I)
    if match_rm:
        return ('remove', match_rm.group(1).strip().lower())
    return None


def parse_ban_command(text):
    """Parse a ban command (/ban or /aiban).

    Returns (True, reason) if matches, or (False, None).
    """
    if not isinstance(text, str):
        return False, None
    cleaned = text.strip()
    match = re.fullmatch(r'/(?:ai)?ban(?:@\w+)?(?:\s+([\s\S]*))?', cleaned, re.I)
    if match:
        reason = (match.group(1) or '').strip()
        return True, reason or None
    return False, None


# --- Filters Database Logic ---

def add_filter(db, chat_id, trigger, response, created_by=''):
    trigger = str(trigger or '').strip().lower().lstrip('/')
    if not trigger or len(trigger) > 64:
        raise ValueError('Trigger must be 1 to 64 characters without spaces')
    if ' ' in trigger:
        raise ValueError('Trigger cannot contain spaces')
    response = str(response or '').strip()
    if not response or len(response) > 2000:
        raise ValueError('Filter response must be between 1 and 2000 characters')
    with db:
        db.execute(
            'INSERT OR REPLACE INTO tg_filters(chat_id, trigger, response, created_by, created_at) VALUES(?,?,?,?,?)',
            (str(chat_id), trigger, response, str(created_by), int(time.time()))
        )
    return trigger


def remove_filter(db, chat_id, trigger):
    trigger = str(trigger or '').strip().lower().lstrip('/')
    with db:
        cur = db.execute('DELETE FROM tg_filters WHERE chat_id=? AND trigger=?', (str(chat_id), trigger))
        return cur.rowcount > 0


def list_filters(db, chat_id):
    rows = db.execute(
        'SELECT trigger, response, created_by, created_at FROM tg_filters WHERE chat_id=? ORDER BY trigger ASC',
        (str(chat_id),)
    ).fetchall()
    return [{'trigger': r[0], 'response': r[1], 'created_by': r[2], 'created_at': r[3]} for r in rows]


def match_filter(db, chat_id, text):
    """Check if text matches any active trigger in the chat.

    Matches whole-word boundary or command form (/trigger).
    Returns response string or None.
    """
    if not isinstance(text, str) or not text.strip():
        return None
    rows = db.execute('SELECT trigger, response FROM tg_filters WHERE chat_id=?', (str(chat_id),)).fetchall()
    if not rows:
        return None
    for trigger, response in sorted(rows, key=lambda r: len(r[0]), reverse=True):
        pattern = rf'(?:^/{re.escape(trigger)}(?:@\w+)?(?:\s|$)|(?<!\w){re.escape(trigger)}(?!\w))'
        if re.search(pattern, text, re.I):
            return response
    return None


# --- Blocklist Database Logic ---

def add_blocklist(db, chat_id, pattern, created_by=''):
    pattern = str(pattern or '').strip().lower()
    if not pattern or len(pattern) > 128:
        raise ValueError('Blocklist pattern must be between 1 and 128 characters')
    with db:
        db.execute(
            'INSERT OR REPLACE INTO tg_blocklist(chat_id, pattern, created_by, created_at) VALUES(?,?,?,?)',
            (str(chat_id), pattern, str(created_by), int(time.time()))
        )
    return pattern


def remove_blocklist(db, chat_id, pattern):
    pattern = str(pattern or '').strip().lower()
    with db:
        cur = db.execute('DELETE FROM tg_blocklist WHERE chat_id=? AND pattern=?', (str(chat_id), pattern))
        return cur.rowcount > 0


def list_blocklist(db, chat_id):
    rows = db.execute(
        'SELECT pattern FROM tg_blocklist WHERE chat_id=? ORDER BY pattern ASC',
        (str(chat_id),)
    ).fetchall()
    return [r[0] for r in rows]


def match_blocklist(db, chat_id, text):
    r"""Check if text contains any blocklisted pattern.

    If pattern is alphanumeric word: uses boundary check (?<!\w)pattern(?!\w).
    Otherwise (urls, phrases, symbols): uses case-insensitive substring match.
    Returns the matched pattern or None.
    """
    if not isinstance(text, str) or not text.strip():
        return None
    patterns = list_blocklist(db, chat_id)
    if not patterns:
        return None
    for pattern in patterns:
        if re.fullmatch(r'\w+', pattern):
            if re.search(rf'(?<!\w){re.escape(pattern)}(?!\w)', text, re.I):
                return pattern
        else:
            if pattern in text.lower():
                return pattern
    return None


# --- Strikes & Warnings ---

def get_strikes(db, chat_id, user_id):
    row = db.execute('SELECT strikes FROM tg_strikes WHERE chat_id=? AND user_id=?',
                     (str(chat_id), str(user_id))).fetchone()
    return int(row[0]) if row else 0


def record_strike(db, chat_id, user_id, violation=''):
    now = int(time.time())
    with db:
        cur = db.execute('SELECT strikes FROM tg_strikes WHERE chat_id=? AND user_id=?',
                         (str(chat_id), str(user_id))).fetchone()
        count = (cur[0] if cur else 0) + 1
        db.execute(
            'INSERT OR REPLACE INTO tg_strikes(chat_id, user_id, strikes, last_violation, updated_at) VALUES(?,?,?,?,?)',
            (str(chat_id), str(user_id), count, str(violation)[:100], now)
        )
        return count


def reset_strikes(db, chat_id, user_id):
    with db:
        cur = db.execute('DELETE FROM tg_strikes WHERE chat_id=? AND user_id=?',
                         (str(chat_id), str(user_id)))
        return cur.rowcount > 0


# --- Admin Verification ---

async def is_chat_admin(bot_api, chat, sender, token, message=None):
    """Verify if sender is a creator or administrator in the given chat.

    Handles anonymous group admins (where sender_chat matches chat_id).
    """
    if not isinstance(chat, dict) or chat.get('type') not in ('group', 'supergroup'):
        return False
    chat_id = chat.get('id')
    if chat_id is None:
        return False

    if message and isinstance(message, dict):
        sender_chat = message.get('sender_chat') or {}
        if sender_chat.get('id') == chat_id:
            return True

    user_id = (sender or {}).get('id')
    if not user_id:
        return False

    try:
        data, status = await bot_api('getChatMember', {'chat_id': chat_id, 'user_id': user_id}, token)
        if status == 200 and isinstance(data, dict) and data.get('ok'):
            member = data.get('result') or {}
            return member.get('status') in ('creator', 'administrator')
    except Exception:
        pass
    return False
