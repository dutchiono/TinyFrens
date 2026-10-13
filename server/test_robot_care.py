import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import robot_care as rc
import economy as econ

WEB_ROOT = Path(__file__).resolve().parent.parent / 'web'
ORIGIN = 'https://tinyfrens.lol'


class FakeClock:
    def __init__(self, t=1_700_000_000):
        self.t = t

    def __call__(self):
        return self.t

    def advance(self, seconds):
        self.t += seconds


class RulesUnitTests(unittest.TestCase):
    def test_care_and_free_actions_are_disjoint(self):
        self.assertFalse(set(rc.CARE_ACTIONS) & set(rc.FREE_ACTIONS))

    def test_every_care_action_has_a_price(self):
        for action in rc.CARE_ACTIONS:
            self.assertIn(action, rc.DEFAULT_PRICES_FRENS)
            self.assertGreaterEqual(rc.DEFAULT_PRICES_FRENS[action], 0)

    def test_engine_understands_every_catalogued_action(self):
        # Parity: the server must only price actions web/pet-engine.js can perform.
        source = (WEB_ROOT / 'pet-engine.js').read_text(encoding='utf-8')
        for action in rc.CARE_ACTIONS + rc.FREE_ACTIONS:
            self.assertIn("'" + action + "'", source, action)

    def test_token_bounds_match_robots_collection(self):
        from robot_companion import token_id as collection_token_id

        for tid in (1, 2664):
            self.assertEqual(rc.token_id(tid), collection_token_id(tid))
        for bad in (0, 2665, 'x', True, None):
            self.assertRaises(ValueError, rc.token_id, bad)
            self.assertRaises(ValueError, collection_token_id, bad)


class AllowanceUnitTests(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.db = sqlite3.connect(':memory:')
        self.care = rc.RobotCare(self.db, now=self.clock, allowance=3)

    def tearDown(self):
        self.db.close()

    def test_free_uses_then_requires_payment(self):
        for i in range(3):
            r = self.care.consume('pet-1', 'feed')
            self.assertTrue(r['allowed'])
            self.assertTrue(r['free'])
            self.assertEqual(r['charged'], 0)
            self.assertEqual(r['allowance']['remaining'], 2 - i)
        r = self.care.consume('pet-1', 'feed')
        self.assertFalse(r['allowed'])
        self.assertTrue(r['requiresPayment'])
        self.assertEqual(r['priceFrens'], rc.DEFAULT_PRICES_FRENS['feed'])
        self.assertEqual(self.care.allowance_left('pet-1')['remaining'], 0)

    def test_allowance_resets_next_utc_day(self):
        self.care.consume('pet-1', 'play')
        self.clock.advance(86400)
        self.assertEqual(self.care.allowance_left('pet-1')['remaining'], 3)

    def test_unknown_action_rejected(self):
        self.assertRaises(rc.UnknownAction, self.care.consume, 'pet-1', 'teleport')

    def test_allowance_is_per_pet(self):
        self.care.consume('pet-1', 'feed')
        self.assertEqual(self.care.allowance_left('pet-2')['remaining'], 3)

    def test_zero_allowance_never_free(self):
        care = rc.RobotCare(sqlite3.connect(':memory:'), now=self.clock, allowance=0)
        r = care.consume('pet-1', 'clean')
        self.assertFalse(r['allowed'])
        self.assertTrue(r['requiresPayment'])

    def test_status_shape(self):
        status = self.care.status('pet-1')
        self.assertEqual(status['actions'], list(rc.CARE_ACTIONS))
        self.assertEqual(status['freeActions'], list(rc.FREE_ACTIONS))
        self.assertEqual(status['allowance']['limit'], 3)
        self.assertEqual(set(status['prices']), set(rc.CARE_ACTIONS))

    def test_overrides_replace_default_prices(self):
        care = rc.RobotCare(sqlite3.connect(':memory:'), now=self.clock, prices={'feed': 7})
        self.assertEqual(care.status('pet-1')['prices']['feed'], 7)
        self.assertEqual(care.status('pet-1')['prices']['play'], rc.DEFAULT_PRICES_FRENS['play'])

    def test_settings_callable_is_read_live(self):
        policy = {'dailyAllowance': 1, 'prices': {'feed': 5}}
        care = rc.RobotCare(sqlite3.connect(':memory:'), now=self.clock, settings=lambda: policy)
        self.assertEqual(care.status('pet-1')['allowance']['limit'], 1)
        self.assertEqual(care.status('pet-1')['prices']['feed'], 5)
        # A retune is visible on the next call, without re-creating the object.
        policy['dailyAllowance'] = 4
        policy['prices']['feed'] = 8
        self.assertEqual(care.status('pet-1')['allowance']['limit'], 4)
        self.assertEqual(care.status('pet-1')['prices']['feed'], 8)


class PaidCareUnitTests(unittest.TestCase):
    """The paid top-up: charging the credit ledger once the free allowance is gone."""

    def setUp(self):
        self.clock = FakeClock()
        self.db = sqlite3.connect(':memory:')
        self.economy = econ.Economy(self.db, now=self.clock)
        self.care = rc.RobotCare(self.db, now=self.clock, allowance=1, economy=self.economy)

    def tearDown(self):
        self.db.close()

    def test_free_use_does_not_touch_the_ledger(self):
        self.economy.grant('pet-1', 1000)
        r = self.care.consume('pet-1', 'feed')
        self.assertTrue(r['free'])
        self.assertEqual(self.economy.balance('pet-1'), 1000)
        self.assertEqual([h['reason'] for h in self.economy.history('pet-1')], ['grant'])

    def test_paid_use_charges_price_times_rate(self):
        self.care.consume('pet-1', 'feed')  # spend the one free action
        expected = rc.DEFAULT_PRICES_FRENS['feed'] * self.economy.credits_per_frens
        self.economy.grant('pet-1', expected + 5000)
        r = self.care.consume('pet-1', 'feed')
        self.assertTrue(r['allowed'])
        self.assertFalse(r['free'])
        self.assertEqual(r['priceFrens'], rc.DEFAULT_PRICES_FRENS['feed'])
        self.assertEqual(r['charged'], expected)
        self.assertEqual(r['balance'], 5000)
        self.assertEqual(self.economy.history('pet-1')[0]['reason'], 'care')

    def test_insufficient_balance_reports_shortfall_and_charges_nothing(self):
        self.care.consume('pet-1', 'feed')
        self.economy.grant('pet-1', 10)
        r = self.care.consume('pet-1', 'feed')
        self.assertFalse(r['allowed'])
        self.assertTrue(r['requiresPayment'])
        self.assertEqual(r['charged'], 0)
        self.assertEqual(r['balance'], 10)
        self.assertGreater(r['shortfall'], 0)
        self.assertEqual(self.economy.balance('pet-1'), 10)

    def test_paid_revive(self):
        self.care.consume('pet-1', 'feed')
        price = rc.DEFAULT_PRICES_FRENS['revive']
        self.economy.grant('pet-1', price * self.economy.credits_per_frens)
        r = self.care.consume('pet-1', 'revive')
        self.assertTrue(r['allowed'])
        self.assertEqual(r['charged'], price * self.economy.credits_per_frens)
        self.assertEqual(self.economy.balance('pet-1'), 0)

    def test_status_reports_rate_and_balance(self):
        self.economy.grant('pet-1', 250)
        status = self.care.status('pet-1')
        self.assertEqual(status['creditsPerFrens'], self.economy.credits_per_frens)
        self.assertEqual(status['balance'], 250)

    def test_without_economy_paid_branch_cannot_charge(self):
        care = rc.RobotCare(sqlite3.connect(':memory:'), now=self.clock, allowance=0)
        r = care.consume('pet-1', 'feed')
        self.assertFalse(r['allowed'])
        self.assertTrue(r['requiresPayment'])
        self.assertEqual(r['charged'], 0)


def build_app(*, ownership='ok', token_pet=None, limit=None, key='tok', value='pet-1',
              economy=None, settings=None, economy_db=None):
    db = sqlite3.connect(':memory:')
    app = web.Application()

    async def owner_check(pid, tid):
        if ownership == 'unlinked':
            raise rc.NotLinked('Link your wallet first')
        if ownership == 'ok':
            return '0x' + 'ab' * 20
        return None

    def default_token_pet(t):
        if t != key:
            raise ValueError('bad token')
        return value

    rc.install(
        app, db,
        token_pet=token_pet or default_token_pet,
        limit=limit or (lambda *a: None),
        settings=settings or (lambda: {'dailyAllowance': 2, 'prices': {'feed': 42}, 'gameRewardCredits': 0}),
        owner_check=owner_check,
        economy=economy,
    )
    return app, db


class RouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        app, self.db = build_app()
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.db.close()

    async def test_status_reports_allowance_and_prices(self):
        r = await self.client.post('/api/robots/care', json={'token': 'tok', 'tokenId': 1})
        self.assertEqual(r.status, 200)
        data = await r.json()
        self.assertEqual(data['tokenId'], 1)
        self.assertEqual(data['allowance']['remaining'], 2)
        self.assertEqual(data['prices']['feed'], 42)

    async def test_action_consumes_free_allowance(self):
        r = await self.client.post('/api/robots/care/action', json={'token': 'tok', 'tokenId': 1, 'action': 'feed'})
        self.assertEqual(r.status, 200)
        data = await r.json()
        self.assertTrue(data['allowed'])
        self.assertEqual(data['allowance']['remaining'], 1)

    async def test_action_beyond_allowance_quotes_price(self):
        for _ in range(2):
            await self.client.post('/api/robots/care/action', json={'token': 'tok', 'tokenId': 1, 'action': 'feed'})
        r = await self.client.post('/api/robots/care/action', json={'token': 'tok', 'tokenId': 1, 'action': 'feed'})
        data = await r.json()
        self.assertFalse(data['allowed'])
        self.assertEqual(data['priceFrens'], 42)

    async def test_unknown_action_rejected(self):
        r = await self.client.post('/api/robots/care/action', json={'token': 'tok', 'tokenId': 1, 'action': 'teleport'})
        self.assertEqual(r.status, 400)

    async def test_bad_token_rejected(self):
        r = await self.client.post('/api/robots/care', json={'token': 'nope', 'tokenId': 1})
        self.assertEqual(r.status, 400)

    async def test_bad_token_id_rejected(self):
        r = await self.client.post('/api/robots/care', json={'token': 'tok', 'tokenId': 9999})
        self.assertEqual(r.status, 400)

    async def test_missing_token_id_rejected(self):
        r = await self.client.post('/api/robots/care', json={'token': 'tok'})
        self.assertEqual(r.status, 400)

    async def test_not_owned_is_forbidden(self):
        app, _ = build_app(ownership='other')
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            r = await client.post('/api/robots/care', json={'token': 'tok', 'tokenId': 1})
            self.assertEqual(r.status, 403)
        finally:
            await client.close()

    async def test_unlinked_wallet_is_forbidden(self):
        app, _ = build_app(ownership='unlinked')
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            r = await client.post('/api/robots/care', json={'token': 'tok', 'tokenId': 1})
            self.assertEqual(r.status, 403)
        finally:
            await client.close()

    async def test_rate_limit_maps_to_400(self):
        def blocked(*_a):
            raise ValueError('Please wait before trying again')

        app, _ = build_app(limit=blocked)
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            r = await client.post('/api/robots/care/action', json={'token': 'tok', 'tokenId': 1, 'action': 'feed'})
            self.assertEqual(r.status, 400)
        finally:
            await client.close()


class PaidRouteTests(unittest.IsolatedAsyncioTestCase):
    """Paid top-up and game earn-back through the HTTP routes."""

    async def asyncSetUp(self):
        self.db = sqlite3.connect(':memory:')
        self.economy = econ.Economy(self.db)
        self.economy.grant('pet-1', 10_000)
        app, _ = build_app(
            economy=self.economy,
            settings=lambda: {'dailyAllowance': 1, 'prices': {'feed': 10}, 'gameRewardCredits': 250},
        )
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.db.close()

    async def test_second_action_charges(self):
        r = await self.client.post('/api/robots/care/action', json={'token': 'tok', 'tokenId': 1, 'action': 'feed'})
        self.assertTrue((await r.json())['free'])
        r = await self.client.post('/api/robots/care/action', json={'token': 'tok', 'tokenId': 1, 'action': 'feed'})
        data = await r.json()
        self.assertTrue(data['allowed'])
        self.assertFalse(data['free'])
        self.assertEqual(data['charged'], 10 * self.economy.credits_per_frens)

    async def test_insufficient_payment_rejected(self):
        self.economy.spend('pet-1', 10_000)  # drain the balance
        await self.client.post('/api/robots/care/action', json={'token': 'tok', 'tokenId': 1, 'action': 'feed'})
        r = await self.client.post('/api/robots/care/action', json={'token': 'tok', 'tokenId': 1, 'action': 'feed'})
        data = await r.json()
        self.assertFalse(data['allowed'])
        self.assertTrue(data['requiresPayment'])
        self.assertEqual(data['balance'], 0)

    async def test_game_reward_grants_credits(self):
        before = self.economy.balance('pet-1')
        r = await self.client.post('/api/robots/game', json={'token': 'tok', 'tokenId': 1, 'game': 'snack-catch'})
        self.assertEqual(r.status, 200)
        data = await r.json()
        self.assertEqual(data['granted'], 250)
        self.assertEqual(self.economy.balance('pet-1'), before + 250)

    async def test_game_reward_off_by_default(self):
        app, _ = build_app(economy=self.economy)  # default settings: gameRewardCredits 0
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            r = await client.post('/api/robots/game', json={'token': 'tok', 'tokenId': 1, 'game': 'snack-catch'})
            self.assertEqual((await r.json())['granted'], 0)
        finally:
            await client.close()

    async def test_game_requires_ownership(self):
        app, _ = build_app(economy=self.economy, ownership='other')
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            r = await client.post('/api/robots/game', json={'token': 'tok', 'tokenId': 1, 'game': 'snack-catch'})
            self.assertEqual(r.status, 403)
        finally:
            await client.close()

    async def test_game_requires_game_name(self):
        r = await self.client.post('/api/robots/game', json={'token': 'tok', 'tokenId': 1})
        self.assertEqual(r.status, 400)


class AppWiringTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from app import create_app

        self.tmp = tempfile.TemporaryDirectory()
        self.client = TestClient(TestServer(create_app(self.tmp.name + '/pets.db', [ORIGIN])))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.tmp.cleanup()

    async def test_care_requires_a_linked_wallet(self):
        r = await self.client.post(
            '/api/register',
            headers={'Origin': ORIGIN},
            json={'pet': {'name': 'Beep', 'shape': 'robot', 'color': '#a474f1'}},
        )
        token = (await r.json())['token']
        r = await self.client.post(
            '/api/robots/care',
            headers={'Origin': ORIGIN},
            json={'token': token, 'tokenId': 1},
        )
        self.assertEqual(r.status, 403)
        self.assertEqual((await r.json())['error'], 'Link your wallet first')


if __name__ == '__main__':
    unittest.main()
