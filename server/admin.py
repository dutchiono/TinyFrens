"""Token- and user-authenticated admin surface for the TinyFrens relay.

Non-public operator surface hosted at miono.live (docs/robots-care.md §8):

  * authenticates via session tokens issued by username/password login
    (default operator: dutch / nottodayjunior) or legacy Authorization: Bearer <ADMIN_TOKEN>;
  * without an admin user or ADMIN_TOKEN configured the whole surface stays disabled (503);
  * tunables live in `app_settings` and are read live by the care layer, so the
    admin can retune gameplay without a restart.

Reads: robot-care tunables + usage, and the credit ledger (read-only). This
module never touches keys, seeds or deployments.
"""
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import sqlite3
import time

from aiohttp import web

import robot_care
from market_quote import MarketQuote

log = logging.getLogger("admin")

SCHEMA = """
CREATE TABLE IF NOT EXISTS app_settings(
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS admin_audit(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    detail TEXT,
    created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS admin_users(
    username TEXT PRIMARY KEY,
    salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS admin_sessions(
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    created INTEGER NOT NULL,
    expires INTEGER NOT NULL);
"""

PRICE_KEYS = tuple('price_' + action for action in robot_care.CARE_ACTIONS)
INT_KEYS = ('dailyAllowance', 'gameRewardCredits')
ALLOWED_KEYS = INT_KEYS + PRICE_KEYS
MAX_ALLOWANCE = 100_000
MAX_GAME_REWARD = 10 ** 12
MAX_PRICE = 10 ** 15

try:
    ADMIN_USER_KEY = web.RequestKey('admin_user', str)
    ADMIN_TOKEN_KEY = web.RequestKey('admin_token', str)
except AttributeError:  # pragma: no cover - older aiohttp
    ADMIN_USER_KEY = 'admin_user'
    ADMIN_TOKEN_KEY = 'admin_token'


class Disabled(Exception):
    """No admin user or ADMIN_TOKEN configured."""


class Unauthorized(Exception):
    """Missing or invalid credentials / bearer token."""


class BadRequest(Exception):
    """Caller sent something invalid."""


def hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100_000).hex()


def verify_password(password: str, salt_hex: str, hash_hex: str) -> bool:
    try:
        salt = bytes.fromhex(salt_hex)
        computed = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100_000).hex()
        return hmac.compare_digest(computed, hash_hex)
    except Exception:
        return False


def _env_int(name, default):
    try:
        return int(os.environ[name])
    except (KeyError, TypeError, ValueError):
        return default


def _clamp_int(value, low, high):
    if isinstance(value, bool):
        raise BadRequest('Expected a whole number')
    try:
        value = int(value)
    except (TypeError, ValueError):
        raise BadRequest('Expected a whole number')
    if value < low or value > high:
        raise BadRequest('Value out of range')
    return value


def overrides_only(db):
    """Stored admin overrides as a flat ``{key: int}`` map (unknown keys skipped)."""
    stored = {}
    for key, value in db.execute('SELECT key, value FROM app_settings'):
        if key not in ALLOWED_KEYS:
            continue
        try:
            stored[key] = int(json.loads(value))
        except (TypeError, ValueError):
            continue
    return stored


def _shape_overrides(stored):
    """Flat overrides -> the shape the page edits: ``{dailyAllowance, gameRewardCredits, prices}``."""
    shaped = {}
    for key in INT_KEYS:
        if key in stored:
            shaped[key] = stored[key]
    prices = {action: stored['price_' + action]
              for action in robot_care.CARE_ACTIONS if 'price_' + action in stored}
    if prices:
        shaped['prices'] = prices
    return shaped


def effective_settings(db):
    """Defaults <- env <- admin overrides, resolved for the live care layer."""
    stored = overrides_only(db)
    allowance = stored.get('dailyAllowance')
    if allowance is None:
        allowance = _env_int('ROBOT_CARE_DAILY_ALLOWANCE', robot_care.DEFAULT_DAILY_ALLOWANCE)
    reward = stored.get('gameRewardCredits')
    if reward is None:
        reward = _env_int('ROBOT_CARE_GAME_REWARD_CREDITS', robot_care.DEFAULT_GAME_REWARD_CREDITS)
    prices = {}
    for action in robot_care.CARE_ACTIONS:
        value = stored.get('price_' + action)
        if value is None:
            value = _env_int('ROBOT_CARE_PRICE_' + action.upper(),
                             robot_care.DEFAULT_PRICES_FRENS[action])
        prices[action] = max(0, int(value))
    return {'dailyAllowance': max(0, int(allowance)),
            'gameRewardCredits': max(0, int(reward)), 'prices': prices}


def care_settings(db):
    """`settings` callable handed to ``robot_care.install``."""
    return effective_settings(db)


class Admin:
    """Settings store, operator credentials and audit log."""

    def __init__(self, db, token=None, now=time.time, initial_user='dutch',
                 initial_password='nottodayjunior', seed_default_user=True):
        self.db = db
        self.token = (token or '').strip() if token else None
        self.now = now
        self.db.executescript(SCHEMA)
        self.db.commit()
        if seed_default_user:
            self._ensure_initial_user(initial_user or 'dutch', initial_password or 'nottodayjunior')

    def _ensure_initial_user(self, username, password):
        row = self.db.execute('SELECT COUNT(*) FROM admin_users').fetchone()
        if not row or row[0] == 0:
            self.create_user(username, password)

    @property
    def enabled(self):
        if bool(self.token):
            return True
        row = self.db.execute('SELECT COUNT(*) FROM admin_users').fetchone()
        return bool(row and row[0] > 0)

    def create_user(self, username, password):
        user_clean = str(username or '').strip().lower()
        if not user_clean or len(user_clean) < 3:
            raise BadRequest('Username must be at least 3 characters')
        if not password or len(str(password)) < 6:
            raise BadRequest('Password must be at least 6 characters')
        salt = secrets.token_bytes(16)
        pw_hash = hash_password(str(password), salt)
        now = int(self.now())
        self.db.execute(
            'INSERT OR REPLACE INTO admin_users(username, salt, password_hash, created, updated) VALUES(?,?,?,?,?)',
            (user_clean, salt.hex(), pw_hash, now, now)
        )
        self.db.commit()
        self.audit('create_user', {'username': user_clean})
        return user_clean

    def list_users(self):
        rows = self.db.execute('SELECT username, created FROM admin_users ORDER BY username ASC').fetchall()
        return [{'username': r[0], 'created': r[1]} for r in rows]

    def authenticate(self, username, password):
        user_clean = str(username or '').strip().lower()
        row = self.db.execute(
            'SELECT username, salt, password_hash FROM admin_users WHERE username=?',
            (user_clean,)
        ).fetchone()
        if not row or not verify_password(str(password or ''), row[1], row[2]):
            raise Unauthorized('Invalid username or password')
        session_token = secrets.token_urlsafe(32)
        now = int(self.now())
        expires = now + (7 * 86400)
        self.db.execute(
            'INSERT INTO admin_sessions(token, username, created, expires) VALUES(?,?,?,?)',
            (session_token, row[0], now, expires)
        )
        self.db.commit()
        self.audit('login', {'username': row[0]})
        return session_token, row[0], expires

    def validate_session(self, token_str):
        if not token_str:
            return None
        now = int(self.now())
        row = self.db.execute('SELECT username, expires FROM admin_sessions WHERE token=?', (token_str,)).fetchone()
        if not row:
            return None
        if row[1] < now:
            self.db.execute('DELETE FROM admin_sessions WHERE token=?', (token_str,))
            self.db.commit()
            return None
        return row[0]

    def logout_session(self, token_str):
        row = self.db.execute('SELECT username FROM admin_sessions WHERE token=?', (token_str,)).fetchone()
        if row:
            self.db.execute('DELETE FROM admin_sessions WHERE token=?', (token_str,))
            self.db.commit()
            self.audit('logout', {'username': row[0]})
            return True
        return False

    def is_valid_token(self, token_str):
        if not token_str:
            return False, ''
        user = self.validate_session(token_str)
        if user:
            return True, user
        if self.token and hmac.compare_digest(token_str, self.token):
            return True, 'system'
        return False, ''

    def audit(self, action, detail=None):
        self.db.execute('INSERT INTO admin_audit(action,detail,created) VALUES(?,?,?)',
                        (action, None if detail is None else json.dumps(detail), int(self.now())))
        self.db.commit()

    def recent_audit(self, count=20):
        rows = self.db.execute(
            'SELECT action,detail,created FROM admin_audit ORDER BY id DESC LIMIT ?',
            (max(1, int(count)),),
        ).fetchall()
        entries = []
        for action, detail, created in rows:
            try:
                detail = json.loads(detail) if detail else None
            except (TypeError, ValueError):
                pass
            entries.append({'action': action, 'detail': detail, 'created': created})
        return entries

    def save(self, body):
        """Validate + persist a settings patch, then audit it."""
        if not isinstance(body, dict):
            raise BadRequest('Expected an object')
        unknown = set(body) - {'dailyAllowance', 'gameRewardCredits', 'prices'}
        if unknown:
            raise BadRequest('Unknown setting(s): ' + ', '.join(sorted(unknown)))
        changed = {}
        if 'dailyAllowance' in body:
            changed['dailyAllowance'] = _clamp_int(body['dailyAllowance'], 0, MAX_ALLOWANCE)
        if 'gameRewardCredits' in body:
            changed['gameRewardCredits'] = _clamp_int(body['gameRewardCredits'], 0, MAX_GAME_REWARD)
        prices = body.get('prices')
        if prices is not None:
            if not isinstance(prices, dict):
                raise BadRequest('prices must be an object')
            for action, value in prices.items():
                if action not in robot_care.CARE_ACTIONS:
                    raise BadRequest('Unknown care action: ' + str(action))
                changed['price_' + action] = _clamp_int(value, 0, MAX_PRICE)
        if not changed:
            raise BadRequest('No settings to update')
        ts = int(self.now())
        for key, value in changed.items():
            self.db.execute(
                'INSERT INTO app_settings(key,value,updated) VALUES(?,?,?) '
                'ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated=excluded.updated',
                (key, json.dumps(value), ts),
            )
        self.db.commit()
        self.audit('settings', changed)
        return effective_settings(self.db)


ADMIN_HTML_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'admin.html')


def install(app, db, *, token=None, initial_user=None, initial_password=None,
            seed_default_user=True, economy_settings=None, treasury_settings=None,
            economy=None):
    """Register the admin routes.

    `economy_settings()` / `treasury_settings()` are read for a status view and must
    never move money; `economy` is read for the credits-per-FRENS rate.
    """
    user_init = initial_user or os.environ.get('ADMIN_USERNAME', 'dutch')
    pass_init = initial_password or os.environ.get('ADMIN_PASSWORD', 'nottodayjunior')
    admin = Admin(
        db,
        token=token,
        initial_user=user_init,
        initial_password=pass_init,
        seed_default_user=seed_default_user,
    )
    market = MarketQuote()

    def guard(request):
        if not admin.enabled:
            raise Disabled()
        header = request.headers.get('Authorization', '')
        if not header.startswith('Bearer '):
            raise Unauthorized('Missing bearer authorization')
        token_str = header[7:].strip()
        valid, username = admin.is_valid_token(token_str)
        if not valid:
            raise Unauthorized('Invalid or expired token')
        request[ADMIN_USER_KEY] = username
        request[ADMIN_TOKEN_KEY] = token_str

    def counts():
        def one(sql, args=()):
            try:
                return admin.db.execute(sql, args).fetchone()[0] or 0
            except sqlite3.Error:
                log.warning('Admin metric unavailable: %s', sql)
                return None
        day = time.strftime('%Y-%m-%d', time.gmtime(admin.now()))
        return {
            'registeredDevices': one('SELECT COUNT(*) FROM pets'),
            'syncAccounts': one('SELECT COUNT(DISTINCT account) FROM device_sync_members'),
            'creditAccounts': one('SELECT COUNT(*) FROM credit_accounts'),
            'credits': one('SELECT COALESCE(SUM(balance),0) FROM credit_accounts'),
            'deposits': one('SELECT COUNT(*) FROM deposits'),
            'careToday': one('SELECT COALESCE(SUM(used),0) FROM robot_care_daily WHERE day=?', (day,)),
        }

    def economy_view():
        view = {'treasury': None, 'creditsPerFrens': None,
                'maxCreditsPerTransfer': None}
        if economy is not None:
            try:
                view['creditsPerFrens'] = economy.credits_per_frens
            except Exception:
                pass
        if treasury_settings is not None:
            try:
                t = treasury_settings() or {}
                view['treasury'] = t.get('address') or None
                view['maxCreditsPerTransfer'] = t.get('maxCreditsPerTransfer')
            except Exception:
                log.warning('treasury settings unavailable', exc_info=True)
        if economy_settings is not None:
            try:
                s = economy_settings() or {}
                view.update({'enabled': bool(s.get('enabled')), 'mode': s.get('mode'),
                             'chainId': s.get('chainId'), 'symbol': s.get('symbol'),
                             'frensToken': s.get('frensToken'),
                             'depositsEnabled': bool(s.get('depositsEnabled'))})
            except Exception:
                log.warning('economy settings unavailable', exc_info=True)
        return view

    def guarded(handler):
        async def wrapped(request):
            try:
                guard(request)
            except Disabled:
                return web.json_response({'error': 'Admin is disabled'}, status=503)
            except Unauthorized as exc:
                return web.json_response({'error': str(exc) or 'Unauthorized'}, status=401)
            try:
                return await handler(request)
            except BadRequest as exc:
                return web.json_response({'error': str(exc)}, status=400)
            except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
                return web.json_response({'error': str(exc) or 'Bad request'}, status=400)
            except Exception:
                log.exception('admin request failed')
                return web.json_response({'error': 'Admin unavailable'}, status=503)
        return wrapped

    async def login(request):
        if not admin.enabled:
            return web.json_response({'error': 'Admin is disabled'}, status=503)
        try:
            body = await request.json()
        except Exception:
            return web.json_response({'error': 'Expected JSON body'}, status=400)
        username = body.get('username')
        password = body.get('password')
        if not username or not password:
            return web.json_response({'error': 'Username and password required'}, status=400)
        try:
            token_val, user, expires = admin.authenticate(username, password)
            return web.json_response({'token': token_val, 'username': user, 'expires': expires})
        except Unauthorized as exc:
            return web.json_response({'error': str(exc)}, status=401)
        except Exception:
            log.exception('admin login failed')
            return web.json_response({'error': 'Authentication failed'}, status=500)

    @guarded
    async def logout(request):
        token_str = request.get(ADMIN_TOKEN_KEY)
        admin.logout_session(token_str)
        return web.json_response({'ok': True})

    @guarded
    async def create_user_handler(request):
        try:
            body = await request.json()
        except Exception:
            return web.json_response({'error': 'Expected JSON body'}, status=400)
        username = body.get('username')
        password = body.get('password')
        created = admin.create_user(username, password)
        return web.json_response({'ok': True, 'user': created, 'users': admin.list_users()})

    @guarded
    async def state(request):
        return web.json_response({
            'currentUser': request.get(ADMIN_USER_KEY, 'admin'),
            'users': admin.list_users(),
            'settings': effective_settings(db),
            'overrides': _shape_overrides(overrides_only(db)),
            'actions': list(robot_care.CARE_ACTIONS),
            'freeActions': list(robot_care.FREE_ACTIONS),
            'economy': economy_view(),
            'counts': counts(),
            'audit': admin.recent_audit(),
        })

    @guarded
    async def update_settings(request):
        body = await request.json()
        effective = admin.save(body)
        return web.json_response({
            'settings': effective,
            'overrides': _shape_overrides(overrides_only(db)),
        })

    @guarded
    async def market_view(request):
        return web.json_response(await market.get(economy_view()), headers={'Cache-Control': 'no-store'})

    @guarded
    async def ledger(request):
        count = _clamp_int(request.query.get('limit', 50), 1, 200)
        rows = db.execute(
            'SELECT id,pet_id,delta,balance,reason,ref_type,ref_id,created '
            'FROM credit_ledger ORDER BY id DESC LIMIT ?', (count,)
        ).fetchall()
        entries = [{'id': r[0], 'petId': r[1], 'delta': r[2], 'balance': r[3], 'reason': r[4],
                    'refType': r[5], 'refId': r[6], 'created': r[7]} for r in rows]
        top = db.execute(
            'SELECT pet_id,balance,updated_at FROM credit_accounts ORDER BY balance DESC LIMIT ?',
            (count,)
        ).fetchall()
        return web.json_response({
            'entries': entries,
            'top': [{'petId': r[0], 'balance': r[1], 'updatedAt': r[2]} for r in top],
        })

    @guarded
    async def care_usage(request):
        day = request.query.get('day') or time.strftime('%Y-%m-%d', time.gmtime(admin.now()))
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day):
            raise BadRequest('day must be YYYY-MM-DD')
        count = _clamp_int(request.query.get('limit', 50), 1, 200)
        rows = db.execute(
            'SELECT pet_id,used,updated FROM robot_care_daily WHERE day=? ORDER BY used DESC LIMIT ?',
            (day, count)
        ).fetchall()
        return web.json_response({
            'day': day,
            'allowance': effective_settings(db)['dailyAllowance'],
            'rows': [{'petId': r[0], 'used': r[1], 'updated': r[2]} for r in rows],
        })

    async def page(request):
        if os.path.isfile(ADMIN_HTML_PATH):
            with open(ADMIN_HTML_PATH, 'r', encoding='utf-8') as f:
                content = f.read()
            return web.Response(
                text=content,
                content_type='text/html',
                charset='utf-8',
                headers={'Cache-Control': 'no-store, private'}
            )
        return web.Response(text='Admin page not found', status=404)

    app.router.add_post('/api/admin/login', login)
    app.router.add_post('/api/admin/logout', logout)
    app.router.add_post('/api/admin/users', create_user_handler)
    app.router.add_get('/api/admin/state', state)
    app.router.add_get('/api/admin/market', market_view)
    app.router.add_post('/api/admin/settings', update_settings)
    app.router.add_get('/api/admin/ledger', ledger)
    app.router.add_get('/api/admin/care', care_usage)
    app.router.add_get('/admin', page)
    app.router.add_get('/admin/', page)
    app.router.add_get('/admin.html', page)
    app.router.add_get('/web/admin.html', page)
    return admin
