"""Token-protected admin surface for the TinyFrens relay.

Non-public by design (docs/robots-care.md §8):

  * every route needs `Authorization: Bearer <ADMIN_TOKEN>`;
  * with no `ADMIN_TOKEN` configured the whole surface stays disabled (503), so
    nothing is exposed by accident;
  * tunables live in `app_settings` and are read live by the care layer, so the
    admin can retune gameplay without a restart.

Reads: robot-care tunables + usage, and the credit ledger (read-only). This
module never touches keys, seeds or deployments.
"""
import hmac
import json
import logging
import os
import re
import time

from aiohttp import web

import robot_care

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
"""

PRICE_KEYS = tuple('price_' + action for action in robot_care.CARE_ACTIONS)
INT_KEYS = ('dailyAllowance', 'gameRewardCredits')
ALLOWED_KEYS = INT_KEYS + PRICE_KEYS
MAX_ALLOWANCE = 100_000
MAX_GAME_REWARD = 10 ** 12
MAX_PRICE = 10 ** 15


class Disabled(Exception):
    """No ADMIN_TOKEN configured."""


class Unauthorized(Exception):
    """Missing or wrong bearer token."""


class BadRequest(Exception):
    """Caller sent something invalid."""


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
    """Settings store + audit log for the operator surface."""

    def __init__(self, db, token, now=time.time):
        self.db = db
        self.token = (token or '').strip()
        self.now = now
        self.db.executescript(SCHEMA)
        self.db.commit()

    @property
    def enabled(self):
        return bool(self.token)

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


def install(app, db, *, token, economy_settings=None, treasury_settings=None, economy=None):
    """Register the admin routes.

    `economy_settings()` / `treasury_settings()` are read for a status view and must
    never move money; `economy` is read for the credits-per-FRENS rate.
    """
    admin = Admin(db, token)

    def guard(request):
        if not admin.enabled:
            raise Disabled()
        header = request.headers.get('Authorization', '')
        if not header.startswith('Bearer '):
            raise Unauthorized()
        if not hmac.compare_digest(header[7:].strip(), admin.token):
            raise Unauthorized()

    def counts():
        def one(sql, args=()):
            try:
                return admin.db.execute(sql, args).fetchone()[0] or 0
            except Exception:
                return 0
        day = time.strftime('%Y-%m-%d', time.gmtime(admin.now()))
        return {
            'pets': one('SELECT COUNT(*) FROM pets'),
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
            except Unauthorized:
                return web.json_response({'error': 'Unauthorized'}, status=401)
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

    @guarded
    async def state(request):
        return web.json_response({
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
        # Served by the relay too, so an operator can reach it from any host.
        return web.HTTPFound('/web/admin.html')

    app.router.add_get('/api/admin/state', state)
    app.router.add_post('/api/admin/settings', update_settings)
    app.router.add_get('/api/admin/ledger', ledger)
    app.router.add_get('/api/admin/care', care_usage)
    app.router.add_get('/admin', page)
    return admin
