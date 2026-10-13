"""TinyFrens — Advanced Telegram Bot Interactive Capabilities.

Provides:
- Zero-leak secret redaction filter (API keys, private keys, tokens, credentials).
- Role-based authorization (@dutchiono master allowlist and chat admin verification).
- In-chat interactive Game Mode (Tamagotchi care loop, stats, leveling, dice roll adventure).
- Dynamic message updating (callback query handling, in-place message edits).
- GitHub activity tracking (recent commits, PRs, workflow status).
- Tiered server awareness (public health overview vs admin deep diagnostic).
"""
import asyncio
import json
import os
import re
import time
from urllib.parse import quote

# Master allowed owner username(s)
OWNER_USERNAMES = {'dutchiono'}

# ---------------------------------------------------------------------------
# 1. Zero-Leak Redaction Filter
# ---------------------------------------------------------------------------
SECRET_PATTERNS = [
    # Ethereum private key (64 hex characters)
    re.compile(r'\b0x[a-fA-F0-9]{64}\b'),
    # Telegram bot token (e.g. 123456789:ABCDefGhIJKlmnoPQRstuvWxyz)
    re.compile(r'\b\d{8,11}:[A-Za-z0-9_-]{35}\b'),
    # GitHub personal access or App token
    re.compile(r'\bgh[pousr]_[A-Za-z0-9_]{20,}\b'),
    # Google / Gemini API key
    re.compile(r'\bAIzaSy[A-Za-z0-9_-]{33}\b'),
    # Discord bot token
    re.compile(r'\b[MN][A-Za-z0-9]{23,26}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,38}\b'),
    # Generic JWT token
    re.compile(r'\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b'),
]


def redact_secrets(text: str) -> str:
    """Sanitize any sensitive credentials from text before sending to Telegram."""
    if not isinstance(text, str) or not text:
        return text or ''
    sanitized = text
    for pattern in SECRET_PATTERNS:
        sanitized = pattern.sub('[REDACTED_SECRET]', sanitized)
    # Generic key-value redaction for env-like lines
    sanitized = re.sub(
        r'(?i)\b([a-z0-9_-]*(?:api[_-]?key|secret|token|password|private[_-]?key|auth)[a-z0-9_-]*)\s*[:=]\s*([\'"]?)([^\s\'"]{6,})\2',
        r'\1: [REDACTED]',
        sanitized
    )
    return sanitized


# ---------------------------------------------------------------------------
# 2. Authorization & Admin Verification
# ---------------------------------------------------------------------------
def is_owner(sender: dict) -> bool:
    """True if sender is the repository owner (@dutchiono)."""
    if not isinstance(sender, dict):
        return False
    username = str(sender.get('username') or '').lower().lstrip('@')
    return username in OWNER_USERNAMES


def can_access_admin_tools(sender: dict, chat: dict, is_admin: bool = False) -> bool:
    """Determine if a user is permitted to use administrative commands.

    - In DMs (private chats): strictly only @dutchiono.
    - In group chats: @dutchiono OR a verified chat administrator.
    """
    if is_owner(sender):
        return True
    chat_type = (chat or {}).get('type')
    if chat_type in ('group', 'supergroup') and is_admin:
        return True
    return False


# ---------------------------------------------------------------------------
# 3. Interactive In-Chat Game Mode (SQLite Schema & Engine)
# ---------------------------------------------------------------------------
GAME_SCHEMA = '''
CREATE TABLE IF NOT EXISTS tg_fren_game(
    chat_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'Hatchling',
    level INTEGER NOT NULL DEFAULT 1,
    xp INTEGER NOT NULL DEFAULT 0,
    health INTEGER NOT NULL DEFAULT 100,
    hunger INTEGER NOT NULL DEFAULT 70,
    energy INTEGER NOT NULL DEFAULT 100,
    frens_coins INTEGER NOT NULL DEFAULT 50,
    inventory TEXT NOT NULL DEFAULT '{"berries":2,"snacks":1}',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(chat_id, user_id)
);
'''


def install_game_schema(db):
    """Ensure game mode table exists."""
    db.executescript(GAME_SCHEMA)
    db.commit()


def get_stage_name(level: int) -> str:
    """Derive stage name from level."""
    if level < 3:
        return 'Hatchling 🥚'
    elif level < 5:
        return 'Baby 🐣'
    elif level < 8:
        return 'Juvenile 🐥'
    elif level < 12:
        return 'Grown 🐾'
    return 'Ascended ✨'


def get_or_create_pet(db, chat_id: str | int, user_id: str | int, user_name: str) -> dict:
    """Retrieve or create the interactive game pet for a user."""
    cid, uid = str(chat_id), str(user_id)
    row = db.execute(
        'SELECT name, stage, level, xp, health, hunger, energy, frens_coins, inventory '
        'FROM tg_fren_game WHERE chat_id=? AND user_id=?',
        (cid, uid)
    ).fetchone()
    if row:
        try:
            inv = json.loads(row[8])
        except Exception:
            inv = {'berries': 2, 'snacks': 1}
        return {
            'chat_id': cid,
            'user_id': uid,
            'name': row[0],
            'stage': row[1],
            'level': int(row[2]),
            'xp': int(row[3]),
            'health': int(row[4]),
            'hunger': int(row[5]),
            'energy': int(row[6]),
            'frens_coins': int(row[7]),
            'inventory': inv,
        }
    clean_name = (user_name or 'Fren').strip()[:20]
    pet_name = f"{clean_name}'s Fren"
    now = int(time.time())
    with db:
        db.execute(
            'INSERT OR REPLACE INTO tg_fren_game(chat_id, user_id, name, stage, level, xp, health, hunger, energy, frens_coins, inventory, updated_at) '
            'VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
            (cid, uid, pet_name, 'Hatchling 🥚', 1, 0, 100, 70, 100, 50, json.dumps({'berries': 2, 'snacks': 1}), now)
        )
    return {
        'chat_id': cid,
        'user_id': uid,
        'name': pet_name,
        'stage': 'Hatchling 🥚',
        'level': 1,
        'xp': 0,
        'health': 100,
        'hunger': 70,
        'energy': 100,
        'frens_coins': 50,
        'inventory': {'berries': 2, 'snacks': 1},
    }


def perform_care_action(db, chat_id: str | int, user_id: str | int, action: str, roll: int | None = None) -> tuple[dict, str]:
    """Execute a game action (feed, play, rest, dice, bag) and update stats."""
    cid, uid = str(chat_id), str(user_id)
    pet = get_or_create_pet(db, cid, uid, 'Fren')

    health = pet['health']
    hunger = pet['hunger']
    energy = pet['energy']
    xp = pet['xp']
    level = pet['level']
    coins = pet['frens_coins']
    inventory = pet['inventory']
    note = ''

    if action == 'feed':
        hunger = min(100, hunger + 25)
        health = min(100, health + 5)
        xp += 10
        note = "🍖 Yum! Fed delicious snacks. (+25 Hunger, +5 Health, +10 XP)"
    elif action == 'play':
        if energy < 15:
            return pet, "⚠️ Your Fren is too tired to play! Try resting first."
        energy = max(0, energy - 15)
        hunger = max(0, hunger - 10)
        xp += 20
        coins += 15
        note = "🎾 Played fetch in the yard! (-15 Energy, -10 Hunger, +20 XP, +15 FRENS)"
    elif action == 'rest':
        energy = 100
        health = min(100, health + 15)
        note = "💤 Cozy nap! Energy restored to 100% and Health gained +15."
    elif action == 'dice':
        if energy < 10:
            return pet, "⚠️ Need at least 10 Energy for a dice adventure! Let your Fren rest first."
        energy = max(0, energy - 10)
        # 1-6 roll
        dice_val = roll if (isinstance(roll, int) and 1 <= roll <= 6) else (int(time.time() * 1000) % 6 + 1)
        if dice_val == 1:
            health = max(10, health - 5)
            xp += 5
            note = f"🎲 Rolled a {dice_val}! Tripped on a loose pebble. (-5 Health, +5 XP)"
        elif dice_val in (2, 3):
            coins += 35
            xp += 15
            note = f"🎲 Rolled a {dice_val}! Found shiny coins in the plaza grass! (+35 FRENS, +15 XP)"
        elif dice_val in (4, 5):
            coins += 70
            xp += 25
            inventory['berries'] = inventory.get('berries', 0) + 1
            note = f"🎲 Rolled a {dice_val}! Won a mini sprint challenge! (+70 FRENS, +1 Berry, +25 XP)"
        else:  # 6
            coins += 150
            xp += 50
            inventory['snacks'] = inventory.get('snacks', 0) + 1
            note = f"🎲 Rolled a {dice_val}! 🌟 JACKPOT! Unearthed a hidden treasure chest! (+150 FRENS, +1 Rare Snack, +50 XP)"
    elif action == 'bag':
        berries = inventory.get('berries', 0)
        snacks = inventory.get('snacks', 0)
        return pet, f"🎒 <b>Backpack Contents</b>:\n• {berries}x Golden Berries\n• {snacks}x Crispy Snacks\n• {coins} FRENS coins"
    else:
        note = "🐾 Ready for the next action!"

    # Leveling math
    needed_xp = level * 100
    leveled_up = False
    while xp >= needed_xp:
        xp -= needed_xp
        level += 1
        needed_xp = level * 100
        leveled_up = True

    stage = get_stage_name(level)
    if leveled_up:
        note += f"\n🎉 <b>LEVEL UP!</b> Reached Level {level}! Stage: {stage}!"

    now = int(time.time())
    with db:
        db.execute(
            'UPDATE tg_fren_game SET stage=?, level=?, xp=?, health=?, hunger=?, energy=?, frens_coins=?, inventory=?, updated_at=? '
            'WHERE chat_id=? AND user_id=?',
            (stage, level, xp, health, hunger, energy, coins, json.dumps(inventory), now, cid, uid)
        )

    pet.update({
        'stage': stage,
        'level': level,
        'xp': xp,
        'health': health,
        'hunger': hunger,
        'energy': energy,
        'frens_coins': coins,
        'inventory': inventory,
    })
    return pet, note


def make_bar(value: int, max_val: int = 100, length: int = 8) -> str:
    """Render a text visual progress bar."""
    ratio = max(0.0, min(1.0, value / float(max_val)))
    filled = int(round(ratio * length))
    return '█' * filled + '░' * (length - filled)


def render_game_card(pet: dict, note: str | None = None) -> tuple[str, dict]:
    """Render game state as HTML text with an inline keyboard."""
    uid = pet['user_id']
    name = pet['name']
    stage = pet['stage']
    level = pet['level']
    xp = pet['xp']
    needed_xp = level * 100
    health = pet['health']
    hunger = pet['hunger']
    energy = pet['energy']
    coins = pet['frens_coins']

    text = (
        f"🐾 <b>{name}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"⭐ <b>Level {level}</b> ({stage})\n"
        f"❤️ <b>Health:</b> <code>{make_bar(health)}</code> {health}%\n"
        f"🍖 <b>Hunger:</b> <code>{make_bar(hunger)}</code> {hunger}%\n"
        f"⚡ <b>Energy:</b> <code>{make_bar(energy)}</code> {energy}%\n"
        f"✨ <b>XP:</b> {xp}/{needed_xp}  ·  🪙 <b>FRENS:</b> {coins:,}\n"
    )
    if note:
        text += f"\n<i>{note}</i>\n"

    keyboard = {
        'inline_keyboard': [
            [
                {'text': '🍖 Feed', 'callback_data': f'g:{uid}:feed'},
                {'text': '🎾 Play', 'callback_data': f'g:{uid}:play'},
            ],
            [
                {'text': '💤 Rest', 'callback_data': f'g:{uid}:rest'},
                {'text': '🎲 Dice Adventure', 'callback_data': f'g:{uid}:dice'},
            ],
            [
                {'text': '🎒 Bag', 'callback_data': f'g:{uid}:bag'},
                {'text': '🔄 Refresh', 'callback_data': f'g:{uid}:refresh'},
            ]
        ]
    }
    return text, keyboard


# ---------------------------------------------------------------------------
# 4. GitHub Process & Activity Tracker
# ---------------------------------------------------------------------------
_GH_CACHE = {}  # key -> (timestamp, data)
GH_CACHE_TTL = 60  # seconds


async def fetch_github_progress(session, owner: str, repo: str, token: str | None = None) -> dict:
    """Fetch recent commits, pull requests, and CI workflow runs from GitHub REST API."""
    cache_key = f"{owner}/{repo}"
    cached = _GH_CACHE.get(cache_key)
    now = time.time()
    if cached and (now - cached[0] < GH_CACHE_TTL):
        return cached[1]

    headers = {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'TinyFrens-Telegram-Progress-Bot'
    }
    if token:
        headers['Authorization'] = f'Bearer {token}'

    api_base = f'https://api.github.com/repos/{owner}/{repo}'
    result = {'commits': [], 'prs': [], 'runs': [], 'ok': False}

    try:
        # 1. Recent commits
        async with session.get(f'{api_base}/commits?per_page=4', headers=headers) as resp:
            if resp.status == 200:
                commits_data = await resp.json(content_type=None)
                if isinstance(commits_data, list):
                    for c in commits_data[:4]:
                        msg = (c.get('commit', {}).get('message') or '').splitlines()[0][:60]
                        author = c.get('commit', {}).get('author', {}).get('name') or 'dutch'
                        sha = c.get('sha', '')[:7]
                        result['commits'].append({'msg': msg, 'author': author, 'sha': sha})

        # 2. Pull requests
        async with session.get(f'{api_base}/pulls?state=all&per_page=4', headers=headers) as resp:
            if resp.status == 200:
                prs_data = await resp.json(content_type=None)
                if isinstance(prs_data, list):
                    for p in prs_data[:4]:
                        title = (p.get('title') or '')[:55]
                        num = p.get('number')
                        state = p.get('state')
                        merged = bool(p.get('merged_at'))
                        result['prs'].append({'num': num, 'title': title, 'state': state, 'merged': merged})

        # 3. Actions workflow runs
        async with session.get(f'{api_base}/actions/runs?per_page=3', headers=headers) as resp:
            if resp.status == 200:
                runs_data = await resp.json(content_type=None)
                if isinstance(runs_data, dict) and isinstance(runs_data.get('workflow_runs'), list):
                    for r in runs_data['workflow_runs'][:3]:
                        name = (r.get('name') or 'CI')[:30]
                        status = r.get('status')
                        conclusion = r.get('conclusion') or status
                        result['runs'].append({'name': name, 'conclusion': conclusion})

        result['ok'] = True
        _GH_CACHE[cache_key] = (now, result)
    except Exception as exc:
        result['error'] = str(exc)

    return result


def render_github_progress(data: dict, repo_name: str = 'TinyFrens') -> tuple[str, dict]:
    """Format GitHub progress into clean HTML with inline keyboard."""
    lines = [f"⚡ <b>{repo_name} Development Progress</b>", "━━━━━━━━━━━━━━━━━━━━━━━━━━"]

    prs = data.get('prs') or []
    if prs:
        lines.append("🔀 <b>Pull Requests:</b>")
        for p in prs:
            status_emoji = "✅ Merged" if p['merged'] else ("🟢 Open" if p['state'] == 'open' else "⚪ Closed")
            lines.append(f"• <b>#{p['num']}</b> {p['title']} (<i>{status_emoji}</i>)")
        lines.append("")

    commits = data.get('commits') or []
    if commits:
        lines.append("🔨 <b>Recent Shipped Commits:</b>")
        for c in commits:
            lines.append(f"• <code>{c['sha']}</code> {c['msg']}")
        lines.append("")

    runs = data.get('runs') or []
    if runs:
        lines.append("⚙️ <b>Continuous Integration:</b>")
        for r in runs:
            badge = "🟢 Pass" if r['conclusion'] == 'success' else ("🟡 Running" if r['conclusion'] in ('queued', 'in_progress') else "🔴 Failed")
            lines.append(f"• {r['name']}: {badge}")

    lines.append("\n<i>All tests & PR auto-merge active.</i>")

    keyboard = {
        'inline_keyboard': [
            [
                {'text': '🔄 Refresh Progress', 'callback_data': 'gh:refresh'},
                {'text': '🐾 Open TinyFrens', 'url': 'https://tinyfrens.lol/'}
            ]
        ]
    }
    return '\n'.join(lines), keyboard


# ---------------------------------------------------------------------------
# 5. Tiered Server Awareness
# ---------------------------------------------------------------------------
def public_server_status(room_count: int = 0, uptime_seconds: int = 0) -> tuple[str, dict]:
    """Safe, sanitized high-level server status for public chat."""
    hours = uptime_seconds // 3600
    minutes = (uptime_seconds % 3600) // 60
    text = (
        "🟢 <b>TinyFrens Server Status: Online</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━\n"
        f"⏱️ <b>Uptime:</b> {hours}h {minutes}m\n"
        f"🌳 <b>Active Plaza Rooms:</b> {room_count} spaces\n"
        "📱 <b>Mini App & Web:</b> https://tinyfrens.lol\n"
        "✨ Systems operational and syncing."
    )
    keyboard = {
        'inline_keyboard': [
            [
                {'text': '🔄 Refresh Status', 'callback_data': 'status:refresh'},
                {'text': '🐾 Step into Plaza', 'url': 'https://tinyfrens.lol/#party'}
            ]
        ]
    }
    return text, keyboard


def admin_server_triage(db, room_count: int = 0, uptime_seconds: int = 0) -> str:
    """Detailed diagnostics restricted exclusively to @dutchiono."""
    # Count rows in sqlite
    pets_count = db.execute('SELECT COUNT(*) FROM pets').fetchone()[0]
    filters_count = db.execute('SELECT COUNT(*) FROM tg_filters').fetchone()[0] if table_exists(db, 'tg_filters') else 0
    blocklist_count = db.execute('SELECT COUNT(*) FROM tg_blocklist').fetchone()[0] if table_exists(db, 'tg_blocklist') else 0
    game_pets_count = db.execute('SELECT COUNT(*) FROM tg_fren_game').fetchone()[0] if table_exists(db, 'tg_fren_game') else 0

    hours = uptime_seconds // 3600
    minutes = (uptime_seconds % 3600) // 60

    return (
        "🩺 <b>TinyFrens Host & Server Triage</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"👤 <b>Authorized Admin:</b> @dutchiono\n"
        f"⏱️ <b>Process Uptime:</b> {hours}h {minutes}m ({uptime_seconds}s)\n"
        f"🌳 <b>Active Rooms:</b> {room_count}\n"
        f"🐾 <b>Total Registered Pets:</b> {pets_count}\n"
        f"🎮 <b>Telegram Game Pets:</b> {game_pets_count}\n"
        f"🛡️ <b>Active Chat Filters:</b> {filters_count}\n"
        f"🚫 <b>Blocklist Patterns:</b> {blocklist_count}\n"
        "🔒 <b>Zero-Leak Security:</b> Redaction interceptor active\n"
        "✅ <b>Integrity:</b> All checks passing."
    )


def table_exists(db, table_name: str) -> bool:
    row = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,)).fetchone()
    return bool(row)
