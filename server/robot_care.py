"""Robots v1 (Tamagotchi) care economy: ownership gate, action quotes, and the
free daily allowance ledger.

The care *simulation* stays in `web/pet-engine.js`; the server only owns what
touches money (see docs/tamagotchi-robots.md). That is:

  * which care actions exist and what each costs once the free allowance is gone,
  * how much of today's free allowance a pet has left.

This module never moves FRENS. Charging the paid top-up, the paid revive and the
game pay-back land in P4, once the deposit path exists. For now the paid branch
just reports the price so the client can prompt for a top-up.
"""
import inspect
import json
import logging
import re
import time

from aiohttp import web

log = logging.getLogger("robot_care")

ROBOTS_TOKEN_MIN = 1
ROBOTS_TOKEN_MAX = 2664  # TinyFrens: Robots v1 supply; mirrors server/robot_companion.py

# Care actions that spend the free daily allowance. Kept in parity with the actions
# `web/pet-engine.js` handles; test_robot_care.py fails if the two drift apart.
CARE_ACTIONS = ('feed', 'play', 'rest', 'adventure', 'clean', 'vitamin', 'scold', 'revive')
# Flavour interactions: never cost anything and never touch the allowance.
FREE_ACTIONS = ('pet',)

# Default FRENS price for one use *beyond* the free daily allowance. These are
# placeholders so the shape is fixed; the admin page tunes the real numbers (§6/§8).
DEFAULT_PRICES_FRENS = {
    'feed': 1000,
    'play': 1500,
    'rest': 500,
    'adventure': 1500,
    'clean': 500,
    'vitamin': 5000,
    'scold': 250,
    'revive': 100000,
}
DEFAULT_DAILY_ALLOWANCE = 24

SCHEMA = """
CREATE TABLE IF NOT EXISTS robot_care_daily(
    pet_id TEXT NOT NULL,
    day TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL,
    PRIMARY KEY(pet_id, day));
"""


class UnknownAction(ValueError):
    """The care loop does not know this action."""


class NotLinked(ValueError):
    """The pet has no linked wallet, so ownership cannot be checked."""


def token_id(value):
    if isinstance(value, bool) or not re.fullmatch(r'[0-9]{1,4}', str(value)) or not ROBOTS_TOKEN_MIN <= int(value) <= ROBOTS_TOKEN_MAX:
        raise ValueError('Invalid Robots v1 token number')
    return int(value)


def _day(ts):
    return time.strftime('%Y-%m-%d', time.gmtime(ts))


class RobotCare:
    """Per-pet free daily allowance plus the price of one paid top-up action."""

    def __init__(self, db, now=time.time, allowance=DEFAULT_DAILY_ALLOWANCE, prices=None, settings=None):
        self.db = db
        self.now = now
        self._allowance = max(0, int(allowance))
        self._prices = dict(DEFAULT_PRICES_FRENS)
        if prices:
            self._prices.update({str(a): max(0, int(p)) for a, p in prices.items()})
        # When given, `settings` is re-read on every call so the admin page can
        # retune live; otherwise the baked defaults above are used.
        self._settings = settings
        self.db.executescript(SCHEMA)
        self.db.commit()

    def _policy(self):
        if self._settings is None:
            return self._allowance, dict(self._prices)
        raw = self._settings() or {}
        try:
            allowance = max(0, int(raw.get('dailyAllowance', self._allowance)))
        except (TypeError, ValueError):
            allowance = self._allowance
        prices = dict(DEFAULT_PRICES_FRENS)
        for action, value in (raw.get('prices') or {}).items():
            try:
                prices[str(action)] = max(0, int(value))
            except (TypeError, ValueError):
                continue
        return allowance, prices

    def _used(self, pet_id, day):
        row = self.db.execute(
            'SELECT used FROM robot_care_daily WHERE pet_id=? AND day=?', (pet_id, day)
        ).fetchone()
        return row[0] if row else 0

    def _left(self, pet_id, allowance, ts):
        day = _day(ts if ts is not None else self.now())
        used = self._used(pet_id, day)
        return {'day': day, 'limit': allowance, 'used': used,
                'remaining': max(0, allowance - used)}

    def allowance_left(self, pet_id, ts=None):
        allowance, _ = self._policy()
        return self._left(pet_id, allowance, ts)

    def status(self, pet_id, ts=None):
        allowance, prices = self._policy()
        return {
            'allowance': self._left(pet_id, allowance, ts),
            'prices': {a: prices.get(a, 0) for a in CARE_ACTIONS},
            'actions': list(CARE_ACTIONS),
            'freeActions': list(FREE_ACTIONS),
        }

    def consume(self, pet_id, action, ts=None):
        """Record one use of `action`.

        Within the free allowance this is silent (allowed, charged 0). Once the
        allowance is spent it reports `requiresPayment` and the FRENS price; P4
        charges it. Raises UnknownAction for anything the care loop cannot do.
        """
        if action not in CARE_ACTIONS:
            raise UnknownAction(action)
        allowance, prices = self._policy()
        ts = ts if ts is not None else self.now()
        day = _day(ts)
        used = self._used(pet_id, day)
        if used < allowance:
            self.db.execute(
                'INSERT INTO robot_care_daily(pet_id,day,used,updated) VALUES(?,?,?,?) '
                'ON CONFLICT(pet_id,day) DO UPDATE SET used=excluded.used, updated=excluded.updated',
                (pet_id, day, used + 1, int(ts)),
            )
            self.db.commit()
            return {'allowed': True, 'free': True, 'charged': 0, 'action': action,
                    'allowance': self._left(pet_id, allowance, ts)}
        price = prices.get(action, 0)
        return {'allowed': False, 'free': False, 'charged': 0, 'action': action,
                'requiresPayment': bool(price), 'priceFrens': price,
                'allowance': self._left(pet_id, allowance, ts)}


def install(app, db, *, token_pet, limit, settings, owner_check):
    """Register the robots care routes.

    token_pet(token) -> pet_id            raises ValueError on a bad token
    limit(key, max, seconds)              raises ValueError when rate limited
    settings() -> {'dailyAllowance': int, 'prices': {action: int}}
    owner_check(pet_id, token_id) -> wallet | None
                                          sync or async; raises NotLinked when the
                                          pet has no wallet to check against
    """
    care = RobotCare(db, settings=settings)

    async def _owned(pid, tid):
        wallet = owner_check(pid, tid)
        if inspect.isawaitable(wallet):
            wallet = await wallet
        return wallet

    async def _parse(request):
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError('Bad request')
        return token_pet(body.get('token')), token_id(body.get('tokenId')), body

    async def care_status(request):
        try:
            pid, tid, _ = await _parse(request)
            limit(('robot-care-status', pid), 120, 3600)
            if not await _owned(pid, tid):
                return web.json_response({'error': 'You do not own this robot'}, status=403)
            data = care.status(pid)
            data['tokenId'] = tid
            return web.json_response(data)
        except NotLinked as exc:
            return web.json_response({'error': str(exc)}, status=403)
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
            return web.json_response({'error': str(exc) or 'Bad request'}, status=400)
        except Exception:
            log.exception('robot care status failed')
            return web.json_response({'error': 'Robot care unavailable'}, status=503)

    async def care_action(request):
        try:
            pid, tid, body = await _parse(request)
            limit(('robot-care', pid), 120, 3600)
            if not await _owned(pid, tid):
                return web.json_response({'error': 'You do not own this robot'}, status=403)
            action = str(body.get('action') or '').strip().lower()
            try:
                result = care.consume(pid, action)
            except UnknownAction:
                return web.json_response({'error': 'Unknown care action'}, status=400)
            result['tokenId'] = tid
            return web.json_response(result)
        except NotLinked as exc:
            return web.json_response({'error': str(exc)}, status=403)
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
            return web.json_response({'error': str(exc) or 'Bad request'}, status=400)
        except Exception:
            log.exception('robot care action failed')
            return web.json_response({'error': 'Robot care unavailable'}, status=503)

    app.router.add_post('/api/robots/care', care_status)
    app.router.add_post('/api/robots/care/action', care_action)
    return care
