import json
import os
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import admin as admin_mod
import economy as econ
import robot_care as rc

ORIGIN = 'https://tinyfrens.lol'
AUTH = {'Authorization': 'Bearer secret'}


class SettingsUnitTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        admin_mod.Admin(self.db, 'secret')  # creates the schema

    def tearDown(self):
        self.db.close()

    def test_defaults_when_empty(self):
        eff = admin_mod.effective_settings(self.db)
        self.assertEqual(eff['dailyAllowance'], rc.DEFAULT_DAILY_ALLOWANCE)
        self.assertEqual(set(eff['prices']), set(rc.CARE_ACTIONS))

    def test_env_overrides_default(self):
        with patch.dict(os.environ, {'ROBOT_CARE_DAILY_ALLOWANCE': '5', 'ROBOT_CARE_PRICE_FEED': '7'}):
            eff = admin_mod.effective_settings(self.db)
        self.assertEqual(eff['dailyAllowance'], 5)
        self.assertEqual(eff['prices']['feed'], 7)

    def test_admin_overrides_beat_env(self):
        self.db.execute("INSERT INTO app_settings VALUES('dailyAllowance','3',0)")
        self.db.execute("INSERT INTO app_settings VALUES('price_feed','11',0)")
        self.db.commit()
        with patch.dict(os.environ, {'ROBOT_CARE_DAILY_ALLOWANCE': '5', 'ROBOT_CARE_PRICE_FEED': '7'}):
            eff = admin_mod.effective_settings(self.db)
        self.assertEqual(eff['dailyAllowance'], 3)
        self.assertEqual(eff['prices']['feed'], 11)

    def test_shape_overrides(self):
        shaped = admin_mod._shape_overrides({'dailyAllowance': 4, 'price_feed': 9, 'ignored': 1})
        self.assertEqual(shaped, {'dailyAllowance': 4, 'prices': {'feed': 9}})

    def test_clamp_int_rejects_bad_values(self):
        for bad in (True, 'x', None, -1, admin_mod.MAX_ALLOWANCE + 1):
            self.assertRaises(admin_mod.BadRequest, admin_mod._clamp_int, bad, 0, admin_mod.MAX_ALLOWANCE)

    def test_unknown_keys_are_skipped(self):
        self.db.execute("INSERT INTO app_settings VALUES('nonsense','1',0)")
        self.db.execute("INSERT INTO app_settings VALUES('price_feed','9',0)")
        self.db.commit()
        self.assertEqual(admin_mod.overrides_only(self.db), {'price_feed': 9})


class AdminStoreTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.admin = admin_mod.Admin(self.db, 'secret')

    def tearDown(self):
        self.db.close()

    def test_disabled_without_token(self):
        self.assertFalse(admin_mod.Admin(sqlite3.connect(':memory:'), None).enabled)
        self.assertFalse(admin_mod.Admin(sqlite3.connect(':memory:'), '  ').enabled)
        self.assertTrue(self.admin.enabled)

    def test_save_persists_and_audits(self):
        eff = self.admin.save({'dailyAllowance': 7, 'prices': {'feed': 12}})
        self.assertEqual(eff['dailyAllowance'], 7)
        self.assertEqual(eff['prices']['feed'], 12)
        self.assertEqual(admin_mod.overrides_only(self.db), {'dailyAllowance': 7, 'price_feed': 12})
        audit = self.admin.recent_audit()
        self.assertEqual(audit[0]['action'], 'settings')
        self.assertEqual(audit[0]['detail'], {'dailyAllowance': 7, 'price_feed': 12})

    def test_save_rejects_bad_payloads(self):
        for body in ({}, {'unknown': 1}, {'prices': {'teleport': 1}}, {'prices': []},
                     {'dailyAllowance': 'x'}, {'dailyAllowance': -1}, {'dailyAllowance': True}):
            self.assertRaises(admin_mod.BadRequest, self.admin.save, body)


def build_app(*, token='secret', economy_settings=None):
    db = sqlite3.connect(':memory:')
    econ.Economy(db)   # credit_accounts / credit_ledger / deposits, as the real app creates
    rc.RobotCare(db)   # robot_care_daily
    app = web.Application()
    admin_mod.install(app, db, token=token, economy_settings=economy_settings)
    return app, db


class RouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.app, self.db = build_app(economy_settings=lambda: {'enabled': True, 'mode': 'production',
                                                                'chainId': 8453, 'frensSymbol': 'FRENS'})
        self.client = TestClient(TestServer(self.app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.db.close()

    async def test_requires_token(self):
        self.assertEqual((await self.client.get('/api/admin/state')).status, 401)
        self.assertEqual((await self.client.get('/api/admin/state', headers={'Authorization': 'Bearer wrong'})).status, 401)

    async def test_disabled_without_config(self):
        app, db = build_app(token=None)
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            self.assertEqual((await client.get('/api/admin/state', headers=AUTH)).status, 503)
        finally:
            await client.close()
            db.close()

    async def test_state_reports_settings_and_economy(self):
        r = await self.client.get('/api/admin/state', headers=AUTH)
        self.assertEqual(r.status, 200)
        data = await r.json()
        self.assertEqual(data['settings']['dailyAllowance'], rc.DEFAULT_DAILY_ALLOWANCE)
        self.assertEqual(data['actions'], list(rc.CARE_ACTIONS))
        self.assertTrue(data['economy']['enabled'])
        self.assertEqual(data['economy']['chainId'], 8453)
        self.assertEqual(data['counts']['pets'], 0)

    async def test_update_settings_round_trips(self):
        r = await self.client.post('/api/admin/settings', headers=AUTH,
                                   json={'dailyAllowance': 9, 'prices': {'play': 250}})
        self.assertEqual(r.status, 200)
        data = await r.json()
        self.assertEqual(data['settings']['dailyAllowance'], 9)
        self.assertEqual(data['settings']['prices']['play'], 250)
        self.assertEqual(data['overrides'], {'dailyAllowance': 9, 'prices': {'play': 250}})
        # Visible on the next read.
        again = await (await self.client.get('/api/admin/state', headers=AUTH)).json()
        self.assertEqual(again['settings']['dailyAllowance'], 9)

    async def test_update_rejects_bad_action(self):
        r = await self.client.post('/api/admin/settings', headers=AUTH,
                                   json={'prices': {'teleport': 1}})
        self.assertEqual(r.status, 400)

    async def test_ledger_shapes_rows(self):
        self.db.execute("INSERT INTO credit_accounts VALUES('pet-1', 500, 1000)")
        self.db.execute("INSERT INTO credit_ledger(pet_id,delta,balance,reason,ref_type,ref_id,created) VALUES('pet-1',500,500,'deposit','tx','0xabc',1000)")
        self.db.commit()
        data = await (await self.client.get('/api/admin/ledger?limit=10', headers=AUTH)).json()
        self.assertEqual(data['entries'][0]['petId'], 'pet-1')
        self.assertEqual(data['entries'][0]['delta'], 500)
        self.assertEqual(data['top'][0]['balance'], 500)

    async def test_ledger_limit_validated(self):
        r = await self.client.get('/api/admin/ledger?limit=0', headers=AUTH)
        self.assertEqual(r.status, 400)

    async def test_care_usage_day_validated(self):
        r = await self.client.get('/api/admin/care?day=not-a-day', headers=AUTH)
        self.assertEqual(r.status, 400)
        r = await self.client.get('/api/admin/care', headers=AUTH)
        self.assertEqual(r.status, 200)
        self.assertEqual((await r.json())['rows'], [])


class AppWiringTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env = patch.dict(os.environ, {'ADMIN_TOKEN': 's3cret'})
        self.env.start()
        from app import create_app

        self.tmp = tempfile.TemporaryDirectory()
        self.client = TestClient(TestServer(create_app(self.tmp.name + '/pets.db', [ORIGIN])))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.tmp.cleanup()
        self.env.stop()

    async def test_admin_state_uses_env_token(self):
        r = await self.client.get('/api/admin/state', headers={'Authorization': 'Bearer s3cret'})
        self.assertEqual(r.status, 200)
        self.assertEqual((await r.json())['settings']['dailyAllowance'], rc.DEFAULT_DAILY_ALLOWANCE)

    async def test_admin_requires_token(self):
        r = await self.client.get('/api/admin/state')
        self.assertEqual(r.status, 401)

    async def test_admin_page_redirects(self):
        r = await self.client.get('/admin', allow_redirects=False)
        self.assertEqual(r.status, 302)
        self.assertEqual(r.headers['Location'], '/web/admin.html')


if __name__ == '__main__':
    unittest.main()
