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
        self.assertEqual(eff['gameRewardCredits'], rc.DEFAULT_GAME_REWARD_CREDITS)
        self.assertEqual(set(eff['prices']), set(rc.CARE_ACTIONS))

    def test_env_overrides_default(self):
        with patch.dict(os.environ, {'ROBOT_CARE_DAILY_ALLOWANCE': '5', 'ROBOT_CARE_PRICE_FEED': '7',
                                     'ROBOT_CARE_GAME_REWARD_CREDITS': '250'}):
            eff = admin_mod.effective_settings(self.db)
        self.assertEqual(eff['dailyAllowance'], 5)
        self.assertEqual(eff['gameRewardCredits'], 250)
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
        shaped = admin_mod._shape_overrides({'dailyAllowance': 4, 'gameRewardCredits': 50,
                                             'price_feed': 9, 'ignored': 1})
        self.assertEqual(shaped, {'dailyAllowance': 4, 'gameRewardCredits': 50, 'prices': {'feed': 9}})

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

    def test_disabled_without_token_or_user(self):
        self.assertFalse(admin_mod.Admin(sqlite3.connect(':memory:'), None, seed_default_user=False).enabled)
        self.assertFalse(admin_mod.Admin(sqlite3.connect(':memory:'), '  ', seed_default_user=False).enabled)
        self.assertTrue(self.admin.enabled)

    def test_initial_user_seeded(self):
        db = sqlite3.connect(':memory:')
        admin = admin_mod.Admin(db, None, initial_user='dutch', initial_password='nottodayjunior')
        self.assertTrue(admin.enabled)
        token, user, _ = admin.authenticate('dutch', 'nottodayjunior')
        self.assertEqual(user, 'dutch')
        self.assertTrue(token)
        self.assertEqual(admin.validate_session(token), 'dutch')

    def test_authentication_invalid_password(self):
        self.assertRaises(admin_mod.Unauthorized, self.admin.authenticate, 'dutch', 'wrongpassword')

    def test_authentication_unknown_user(self):
        self.assertRaises(admin_mod.Unauthorized, self.admin.authenticate, 'unknown', 'pass')

    def test_create_user(self):
        self.admin.create_user('alice', 'superpassword123')
        token, user, _ = self.admin.authenticate('alice', 'superpassword123')
        self.assertEqual(user, 'alice')
        users = [u['username'] for u in self.admin.list_users()]
        self.assertIn('alice', users)
        self.assertIn('dutch', users)

    def test_save_persists_and_audits(self):
        eff = self.admin.save({'dailyAllowance': 7, 'gameRewardCredits': 250, 'prices': {'feed': 12}})
        self.assertEqual(eff['dailyAllowance'], 7)
        self.assertEqual(eff['gameRewardCredits'], 250)
        self.assertEqual(eff['prices']['feed'], 12)
        self.assertEqual(admin_mod.overrides_only(self.db),
                         {'dailyAllowance': 7, 'gameRewardCredits': 250, 'price_feed': 12})
        audit = self.admin.recent_audit()
        self.assertEqual(audit[0]['action'], 'settings')
        self.assertEqual(audit[0]['detail'],
                         {'dailyAllowance': 7, 'gameRewardCredits': 250, 'price_feed': 12})

    def test_save_rejects_bad_payloads(self):
        for body in ({}, {'unknown': 1}, {'prices': {'teleport': 1}}, {'prices': []},
                     {'dailyAllowance': 'x'}, {'dailyAllowance': -1}, {'dailyAllowance': True},
                     {'gameRewardCredits': -1}, {'gameRewardCredits': admin_mod.MAX_GAME_REWARD + 1}):
            self.assertRaises(admin_mod.BadRequest, self.admin.save, body)


def build_app(*, token='secret', economy_settings=None, treasury_settings=None,
              economy=None, seed_default_user=True):
    db = sqlite3.connect(':memory:')
    econ.Economy(db)   # credit_accounts / credit_ledger / deposits, as the real app creates
    rc.RobotCare(db)   # robot_care_daily
    app = web.Application()
    admin_mod.install(app, db, token=token, economy_settings=economy_settings,
                      treasury_settings=treasury_settings, economy=economy,
                      seed_default_user=seed_default_user)
    return app, db


class RouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.economy = econ.Economy(sqlite3.connect(':memory:'))
        self.app, self.db = build_app(
            economy_settings=lambda: {'enabled': True, 'mode': 'production',
                                      'chainId': 8453, 'symbol': 'FRENS'},
            treasury_settings=lambda: {'address': '0x' + 'de' * 20, 'maxCreditsPerTransfer': 50000},
            economy=self.economy,
        )
        self.client = TestClient(TestServer(self.app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.db.close()

    async def test_requires_token(self):
        self.assertEqual((await self.client.get('/api/admin/state')).status, 401)
        self.assertEqual((await self.client.get('/api/admin/state', headers={'Authorization': 'Bearer wrong'})).status, 401)

    async def test_disabled_without_config(self):
        app, db = build_app(token=None, seed_default_user=False)
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            self.assertEqual((await client.get('/api/admin/state', headers=AUTH)).status, 503)
        finally:
            await client.close()
            db.close()

    async def test_login_and_session(self):
        # Successful login
        r = await self.client.post('/api/admin/login', json={'username': 'dutch', 'password': 'nottodayjunior'})
        self.assertEqual(r.status, 200)
        data = await r.json()
        self.assertEqual(data['username'], 'dutch')
        token = data['token']
        self.assertTrue(token)

        # Authenticate using session token
        r_state = await self.client.get('/api/admin/state', headers={'Authorization': f'Bearer {token}'})
        self.assertEqual(r_state.status, 200)
        state_data = await r_state.json()
        self.assertEqual(state_data['currentUser'], 'dutch')

        # Logout
        r_logout = await self.client.post('/api/admin/logout', headers={'Authorization': f'Bearer {token}'})
        self.assertEqual(r_logout.status, 200)

        # Session is invalidated
        r_after = await self.client.get('/api/admin/state', headers={'Authorization': f'Bearer {token}'})
        self.assertEqual(r_after.status, 401)

    async def test_login_invalid_password(self):
        r = await self.client.post('/api/admin/login', json={'username': 'dutch', 'password': 'wrong'})
        self.assertEqual(r.status, 401)

    async def test_create_user_and_login(self):
        r = await self.client.post('/api/admin/users', headers=AUTH, json={'username': 'newadmin', 'password': 'securepassword123'})
        self.assertEqual(r.status, 200)
        data = await r.json()
        self.assertEqual(data['user'], 'newadmin')

        # Log in with newly created user
        r_login = await self.client.post('/api/admin/login', json={'username': 'newadmin', 'password': 'securepassword123'})
        self.assertEqual(r_login.status, 200)
        login_data = await r_login.json()
        self.assertEqual(login_data['username'], 'newadmin')

    async def test_state_reports_settings_and_economy(self):
        r = await self.client.get('/api/admin/state', headers=AUTH)
        self.assertEqual(r.status, 200)
        data = await r.json()
        self.assertEqual(data['settings']['dailyAllowance'], rc.DEFAULT_DAILY_ALLOWANCE)
        self.assertEqual(data['overrides'], {})
        self.assertEqual(set(data['actions']), set(rc.CARE_ACTIONS))
        self.assertEqual(data['economy']['treasury'], '0x' + 'de' * 20)
        self.assertEqual(data['economy']['symbol'], 'FRENS')
        self.assertIsNone(data['counts']['registeredDevices'])  # absent table is not a fake zero
        self.assertIsNone(data['counts']['syncAccounts'])
        self.assertEqual(data['audit'], [{'action': 'create_user', 'detail': {'username': 'dutch'},
                                          'created': data['audit'][0]['created']}])

    async def test_device_count_is_not_a_fren_count(self):
        self.db.execute('CREATE TABLE pets(id TEXT)')
        self.db.executemany('INSERT INTO pets VALUES(?)', [('device-a',), ('device-b',)])
        self.db.execute('CREATE TABLE device_sync_members(device TEXT, account TEXT)')
        self.db.executemany('INSERT INTO device_sync_members VALUES(?,?)', [('device-a', 'shared'), ('device-b', 'shared')])
        data = await (await self.client.get('/api/admin/state', headers=AUTH)).json()
        self.assertEqual(data['counts']['registeredDevices'], 2)
        self.assertEqual(data['counts']['syncAccounts'], 1)
        self.assertNotIn('pets', data['counts'])

    async def test_market_is_guarded_and_unsupported_config_is_explicit(self):
        self.assertEqual((await self.client.get('/api/admin/market')).status, 401)
        data = await (await self.client.get('/api/admin/market', headers=AUTH)).json()
        self.assertEqual(data['status'], 'unavailable')
        self.assertNotIn('priceUsd', data)

    async def test_update_settings_and_audit(self):
        r = await self.client.post('/api/admin/settings', headers=AUTH, json={'gameRewardCredits': 750})
        self.assertEqual(r.status, 200)
        data = await r.json()
        self.assertEqual(data['settings']['gameRewardCredits'], 750)
        self.assertEqual(data['overrides'], {'gameRewardCredits': 750})

        again = await (await self.client.get('/api/admin/state', headers=AUTH)).json()
        self.assertEqual(again['settings']['gameRewardCredits'], 750)
        self.assertEqual(again['overrides'], {'gameRewardCredits': 750})
        self.assertEqual(again['audit'][0]['action'], 'settings')
        self.assertEqual(again['audit'][0]['detail'], {'gameRewardCredits': 750})

    async def test_update_prices_and_allowance(self):
        r = await self.client.post('/api/admin/settings', headers=AUTH,
                                   json={'dailyAllowance': 12, 'prices': {'feed': 99, 'play': 88}})
        self.assertEqual(r.status, 200)
        data = await r.json()
        self.assertEqual(data['settings']['dailyAllowance'], 12)
        self.assertEqual(data['settings']['prices']['feed'], 99)
        self.assertEqual(data['settings']['prices']['play'], 88)

        again = await (await self.client.get('/api/admin/state', headers=AUTH)).json()
        self.assertEqual(again['settings']['dailyAllowance'], 12)
        self.assertEqual(again['settings']['prices']['feed'], 99)

    async def test_bad_settings_payload_rejected(self):
        r = await self.client.post('/api/admin/settings', headers=AUTH,
                                   json={'dailyAllowance': -5})
        self.assertEqual(r.status, 400)
        self.assertIn('error', await r.json())

    async def test_ledger_route(self):
        self.db.execute("INSERT INTO credit_accounts(pet_id,balance,updated_at) VALUES('pet-1', 400, 1000)")
        self.db.execute("INSERT INTO credit_ledger(pet_id,delta,balance,reason,ref_type,ref_id,created) "
                        "VALUES('pet-1', 400, 400, 'deposit', 'tx', '0x1', 1000)")
        self.db.commit()
        data = await (await self.client.get('/api/admin/ledger?limit=10', headers=AUTH)).json()
        self.assertEqual(len(data['entries']), 1)
        self.assertEqual(data['entries'][0]['petId'], 'pet-1')
        self.assertEqual(data['entries'][0]['balance'], 400)
        self.assertEqual(data['top'][0]['petId'], 'pet-1')

    async def test_ledger_rejects_bad_limit(self):
        r = await self.client.get('/api/admin/ledger?limit=0', headers=AUTH)
        self.assertEqual(r.status, 400)

    async def test_care_route_validates_day(self):
        r = await self.client.get('/api/admin/care?day=not-a-day', headers=AUTH)
        self.assertEqual(r.status, 400)

    async def test_care_route_returns_rows(self):
        self.db.execute("INSERT INTO robot_care_daily(pet_id,day,used,updated) VALUES('pet-1','2026-10-12',3,1000)")
        self.db.commit()
        r = await self.client.get('/api/admin/care', headers=AUTH)
        self.assertEqual(r.status, 200)
        data = await r.json()
        self.assertIn('rows', data)
        self.assertEqual(data['allowance'], rc.DEFAULT_DAILY_ALLOWANCE)

    async def test_admin_page_serves_html(self):
        r = await self.client.get('/admin')
        self.assertEqual(r.status, 200)
        self.assertIn('text/html', r.headers.get('Content-Type', ''))
        self.assertIn('TinyFrens admin', await r.text())


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

    async def test_admin_page_serves_html(self):
        r = await self.client.get('/admin')
        self.assertEqual(r.status, 200)
        self.assertIn('text/html', r.headers.get('Content-Type', ''))
        self.assertIn('TinyFrens admin', await r.text())


if __name__ == '__main__':
    unittest.main()
