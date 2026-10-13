"""TinyFrens — turn a chat conversation into a GitHub issue (pure + testable).

Someone typing "open an issue" in the Telegram bot should end up with a real
GitHub issue describing what the conversation was about. Three steps:

* ``parse_repo`` / ``transcript`` normalise the inputs (``owner/name`` plus the
  last N buffered chat messages).
* ``draft_issue`` asks the model for a title, optional labels and a Markdown
  body; ``parse_draft`` parses that strict reply so a chatty model can never
  produce a malformed issue.
* ``create_issue`` posts it with the REST API.

Docs: https://docs.github.com/rest/issues/issues#create-an-issue
"""
import hashlib
import hmac
import re

from aiohttp import ClientSession, ClientTimeout

GITHUB_API = 'https://api.github.com'
GITHUB_API_VERSION = '2022-11-28'
GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
HISTORY_SIZE = 25
MAX_TITLE = 90
MAX_BODY = 60000
# Control characters are stripped; newlines and tabs are kept inside bodies.
_NO_CTRL = r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]'
_REPO_PART = r'[A-Za-z0-9._-]{1,100}'


def parse_repo(value):
    """Validate a ``owner/name`` string. Returns ``(owner, name)``.

    Raises ``ValueError`` with a human-readable message so the caller can paste
    it straight into a chat reply.
    """
    if not isinstance(value, str):
        raise ValueError('GITHUB_REPO must look like owner/name')
    parts = value.strip().split('/')
    if len(parts) != 2:
        raise ValueError('GITHUB_REPO must look like owner/name')
    owner, name = parts[0].strip(), parts[1].strip()
    if not re.fullmatch(_REPO_PART, owner) or not re.fullmatch(_REPO_PART, name):
        raise ValueError('GITHUB_REPO must look like owner/name')
    return owner, name


def transcript(messages, limit=HISTORY_SIZE):
    """Format the most recent ``messages`` as ``Name: text`` lines.

    Accepts a list of ``{'name': ..., 'text': ...}`` dicts — the shape the relay
    buffers per chat. Empty and malformed entries are skipped so a partial
    history still yields a usable transcript.
    """
    if not isinstance(messages, (list, tuple)):
        raise ValueError('Conversation history was invalid')
    lines = []
    for message in messages[-limit:]:
        if not isinstance(message, dict):
            continue
        name = re.sub(r'\s+', ' ', str(message.get('name') or 'someone')).strip()[:40] or 'someone'
        text = re.sub(_NO_CTRL, '', str(message.get('text') or '')).strip()[:500]
        if text:
            lines.append(name + ': ' + text)
    return '\n'.join(lines)


DRAFT_SYSTEM = (
    'You turn a chat conversation into a single GitHub issue. Read the transcript and '
    'reply with EXACTLY this shape and nothing else — no greeting, no code fence:\n'
    'TITLE: one short imperative line, 90 characters or fewer\n'
    'LABELS: at most three comma-separated labels, or the word none\n'
    '---\n'
    'BODY in Markdown with a "## What happened" section, then a "## Suggested next steps" '
    'section with short bullets.\n'
    'Rules: only use facts present in the transcript, attribute points to the person who '
    'made them, keep the body under 40 lines, never invent details, and never include '
    'private keys, seed phrases, wallet addresses, bot tokens or API keys. If the '
    'transcript does not describe a problem, bug, feature request or task, reply with '
    'just "TITLE: none".'
)


def draft_prompt(lines, chat_title=''):
    """Build the user prompt handed to the model."""
    header = 'Chat: ' + ((chat_title or 'a group chat').strip()[:80]) + '\nRecent conversation:\n'
    return header + lines


def parse_draft(text):
    """Parse a strict ``TITLE:`` / ``LABELS:`` / ``---`` / body reply.

    Returns ``{'title', 'labels', 'body'}``. Raises ``ValueError`` when the reply
    is unusable — empty, unparseable, or explicitly "no issue here".
    """
    if not isinstance(text, str) or not text.strip():
        raise ValueError('The model returned an empty draft')
    lines = text.replace('\r\n', '\n').strip().split('\n')
    head = lines[0].strip()
    if not head[:6].upper() == 'TITLE:':
        raise ValueError('The model returned a draft without a title')
    title = re.sub(r'\s+', ' ', head[6:]).strip()[:MAX_TITLE]
    if not title or title.lower() in ('none', 'n/a', 'null'):
        raise ValueError('No issue to file from this conversation')

    rest = lines[1:]
    labels = []
    if rest and rest[0].strip()[:7].upper() == 'LABELS:':
        raw = rest[0].strip()[7:].strip()
        if raw.lower() not in ('none', 'n/a', ''):
            labels = [part.strip()[:50] for part in raw.split(',') if part.strip()][:3]
        rest = rest[1:]
    if rest and rest[0].strip() == '---':
        rest = rest[1:]

    body = re.sub(_NO_CTRL, '', '\n'.join(rest)).strip()
    if not body:
        body = '_No extra detail was captured._'
    return {'title': title, 'labels': labels, 'body': body[:MAX_BODY]}


def issue_body(draft, footer):
    """Combine a parsed draft with a provenance footer."""
    body = draft['body'].rstrip()
    if footer:
        body = body + '\n\n---\n\n' + footer
    return body[:MAX_BODY]


async def draft_issue(lines, api_key, chat_title='', model=None, timeout=20):
    """Ask the model for an issue draft. Returns ``{'title','labels','body'}``."""
    if not api_key:
        raise ValueError('Pet chat is not connected yet')
    if not lines:
        raise ValueError('No recent conversation to summarise')
    model = model or 'gemini-2.0-flash'
    payload = {'systemInstruction': {'parts': [{'text': DRAFT_SYSTEM}]},
               'contents': [{'role': 'user', 'parts': [{'text': draft_prompt(lines, chat_title)}]}],
               'generationConfig': {'temperature': 0.2, 'maxOutputTokens': 900}}
    client_timeout = ClientTimeout(total=timeout)
    async with ClientSession(timeout=client_timeout) as session:
        async with session.post(GEMINI_URL.format(model=model),
                                headers={'x-goog-api-key': api_key}, json=payload) as response:
            data = await response.json(content_type=None)
            if response.status >= 400:
                raise ValueError('The model could not read this conversation')
    candidates = data.get('candidates') if isinstance(data, dict) else None
    parts = candidates[0].get('content', {}).get('parts', []) if candidates else []
    reply = '\n'.join(str(part.get('text', '')) for part in parts).strip()
    return parse_draft(reply)


async def list_labels(owner, repo, token, timeout=20):
    """Return the repo's existing label names as a set.

    GitHub rejects a create-issue request with **422 Validation Failed** if any
    label in ``labels`` does not already exist, and silently drops labels when the
    token lacks push access. Filtering against this list keeps a model-invented
    label from failing the whole request.
    """
    url = GITHUB_API + '/repos/' + owner + '/' + repo + '/labels?per_page=100'
    headers = {'Accept': 'application/vnd.github+json',
               'Authorization': 'Bearer ' + token,
               'X-GitHub-Api-Version': GITHUB_API_VERSION,
               'User-Agent': 'TinyFrens-Telegram-Bot'}
    client_timeout = ClientTimeout(total=timeout)
    names = set()
    async with ClientSession(timeout=client_timeout) as session:
        async with session.get(url, headers=headers) as response:
            if response.status >= 400:
                return names
            data = await response.json(content_type=None)
    for label in data if isinstance(data, list) else []:
        if isinstance(label, dict) and isinstance(label.get('name'), str):
            names.add(label['name'])
    return names


def filter_labels(requested, available):
    """Keep only requested labels that exist in the repo, preserving order.

    Unknown names are dropped rather than sent, so one invented label cannot
    fail the whole issue. Matching is case-insensitive but the repo's own
    spelling is returned, so the created issue looks tidy.
    """
    if not available:
        return []
    by_lower = {name.lower(): name for name in available}
    kept, seen = [], set()
    for raw in requested or []:
        if not isinstance(raw, str):
            continue
        match = by_lower.get(raw.strip().lower())
        if match and match.lower() not in seen:
            seen.add(match.lower())
            kept.append(match)
    return kept


def verify_webhook_signature(secret, body, signature):
    """Verify a GitHub webhook delivery signature.

    GitHub signs the **raw request body** with HMAC-SHA256 using the webhook
    secret and sends it as ``X-Hub-Signature-256: sha256=<hex>``. Verification
    must use the exact bytes received — re-serialising the JSON changes them and
    breaks the signature.

    Returns True/False. Fails closed: no secret, no signature, or a malformed
    header all return False so the caller never trusts an unverified delivery.
    Only SHA-256 is accepted; the legacy ``X-Hub-Signature`` SHA-1 header is
    deliberately ignored as it is cryptographically weak.
    """
    if not (secret and signature) or not isinstance(body, (bytes, bytearray)):
        return False
    if isinstance(signature, bytes):
        signature = signature.decode('utf-8', 'replace')
    prefix, _, digest = signature.partition('=')
    if prefix.strip().lower() != 'sha256' or not digest:
        return False
    expected = hmac.new(secret.encode(), bytes(body), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, digest.strip().lower())


def issue_event(payload):
    """Flatten an ``issues`` / ``issue_comment`` webhook payload.

    Returns ``{'action','number','title','url','repo','who','text'}`` or None
    for events we do not relay. Text is truncated so a huge comment body cannot
    flood the chat.
    """
    if not isinstance(payload, dict):
        return None
    event = payload.get('event')
    action = payload.get('action')
    issue = payload.get('issue')
    if not isinstance(issue, dict):
        return None
    number = issue.get('number')
    if not isinstance(number, int):
        return None
    if event == 'issue_comment':
        if action != 'created':
            return None
        comment = payload.get('comment') if isinstance(payload.get('comment'), dict) else {}
        text = re.sub(r'\s+', ' ', str(comment.get('body') or '')).strip()[:300]
        kind = 'comment'
    elif event == 'issues':
        if action not in ('closed', 'reopened'):
            return None
        text = ''
        kind = action
    else:
        return None
    repo = payload.get('repository') if isinstance(payload.get('repository'), dict) else {}
    who = (payload.get('sender') or {}).get('login') if isinstance(payload.get('sender'), dict) else None
    return {'kind': kind,
            'number': number,
            'title': re.sub(r'\s+', ' ', str(issue.get('title') or '')).strip()[:MAX_TITLE],
            'url': str(issue.get('html_url') or ''),
            'repo': str(repo.get('full_name') or ''),
            'who': str(who or 'someone')[:60],
            'text': text}


def issue_event_message(details):
    """Render an ``issue_event`` result as a short chat line."""
    if not details:
        return None
    head = '#' + str(details['number'])
    if details['title']:
        head += ' ' + details['title']
    if details['kind'] == 'comment':
        body = '💬 ' + details['who'] + ' commented on issue ' + head
        if details['text']:
            body += ':\n' + details['text']
    else:
        body = ('✅ ' if details['kind'] == 'closed' else '🔓 ') + 'Issue ' + head + ' was ' + details['kind']
    if details['url']:
        body += '\n' + details['url']
    return body


async def create_issue(owner, repo, token, title, body, labels=None, timeout=20):
    """Create a GitHub issue. Returns ``(data, http_status)``."""
    payload = {'title': title, 'body': body}
    if labels:
        payload['labels'] = list(labels)
    url = GITHUB_API + '/repos/' + owner + '/' + repo + '/issues'
    headers = {'Accept': 'application/vnd.github+json',
               'Authorization': 'Bearer ' + token,
               'X-GitHub-Api-Version': GITHUB_API_VERSION,
               'User-Agent': 'TinyFrens-Telegram-Bot'}
    client_timeout = ClientTimeout(total=timeout)
    async with ClientSession(timeout=client_timeout) as session:
        async with session.post(url, headers=headers, json=payload) as response:
            return await response.json(content_type=None), response.status


def error_detail(data, status):
    """Extract a short, safe error line from a GitHub error response."""
    if isinstance(data, dict):
        message = data.get('message')
        if isinstance(message, str) and message.strip():
            return message.strip()[:200]
    return 'GitHub refused the issue (HTTP ' + str(status) + ')'


def response_summary(data, status, owner, repo):
    """Normalise a ``create_issue`` result into ``{'ok': ...}``."""
    if status >= 400:
        return {'ok': False, 'error': error_detail(data, status)}
    number = data.get('number') if isinstance(data, dict) else None
    url = data.get('html_url') if isinstance(data, dict) else None
    if not number or not url:
        return {'ok': False, 'error': 'GitHub did not return an issue link'}
    return {'ok': True, 'number': int(number), 'url': str(url), 'repo': owner + '/' + repo,
            'title': str(data.get('title', ''))[:MAX_TITLE],
            'labels': [str(label.get('name', '')) for label in (data.get('labels') or [])
                       if isinstance(label, dict)]}


def labels_from_env(raw):
    """Parse a comma-separated ``GITHUB_ISSUE_LABELS`` value into a list."""
    if not isinstance(raw, str):
        return []
    return [part.strip()[:50] for part in raw.split(',') if part.strip()][:5]


def history_from_env(raw, default=HISTORY_SIZE):
    """Clamp a configured history size to 1..200."""
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        return default
    return max(1, min(200, value))
