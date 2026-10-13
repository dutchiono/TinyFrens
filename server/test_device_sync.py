import sqlite3
import time
import unittest
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

import device_sync
from turtle_connect import add_wallet, linked_wallets, remove_wallet


class DeviceSyncTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript('''CREATE TABLE wallet_links(pet_id TEXT,address TEXT COLLATE NOCASE,created INTEGER,PRIMARY KEY(pet_id,address));
            CREATE TABLE turtle_pairings(pet_id TEXT); CREATE TABLE wallet_link_challenges(pet_id TEXT);''')
        app = web.Application()
        def token(value):
            if value not in ('first', 'second', 'third'):
                raise ValueError('Invalid device')
            return value
        device_sync.install(app, self.db, token, lambda *args: None)
        self.client = TestClient(TestServer(app)); await self.client.start_server()
        self.item = {'chainId':8453, 'originalAddress':'0x8d446c126d4873bfa3eb195b7f0094acc1187a75', 'tokenId':50,
                     'motion':{'mode':'bubble', 'speed':45, 'size':97}}

    async def asyncTearDown(self):
        await self.client.close(); self.db.close()

    async def post(self, action, device='first', **body):
        response = await self.client.post('/api/device-sync/' + action, json={'token':device, **body})
        return response.status, await response.json()

    async def pair(self):
        _, code = await self.post('start')
        _, request = await self.post('request', 'second', code=code['code'], label='Desktop')
        status, data = await self.post('accept', code=code['code'], requestId=request['requestId'])
        self.assertEqual(status, 200)
        return code, data

    async def test_sync_requires_source_approval_preserves_secrets_and_consumes_code(self):
        add_wallet(self.db, 'first', '0x' + '1'*40)
        add_wallet(self.db, 'second', '0x' + '2'*40)
        _, state = await self.post('state')
        await self.post('state', revision=state['revision'], selection=[self.item])
        _, code = await self.post('start')
        _, request = await self.post('request', 'second', code=code['code'])
        self.assertEqual(len(linked_wallets(self.db, 'second')), 1)
        self.assertEqual((await self.post('accept', 'second', code=code['code'], requestId=request['requestId']))[0], 400)
        self.assertEqual((await self.post('status', 'third', code=code['code']))[0], 400)
        self.assertEqual((await self.post('accept', code=code['code'], requestId='wrong'))[0], 400)
        status, data = await self.post('accept', code=code['code'], requestId=request['requestId'])
        self.assertEqual(status, 200); self.assertEqual(data['devices'], 2)
        self.assertNotIn('token', data); self.assertEqual(data['selection'], [self.item])
        self.assertEqual((await self.post('state', 'second'))[1], data)
        self.assertEqual(len(linked_wallets(self.db, 'second')), 2)
        self.assertEqual((await self.post('accept', code=code['code'], requestId=request['requestId']))[0], 400)

    async def test_sync_keeps_wallet_order_consistent_across_devices(self):
        # A wallet linked to each device at different times must end up in the same
        # order on both once synced, even when the copy lands in a later second.
        # Regression: accept used a fresh per-device timestamp for the copied links,
        # so linked_wallets (ORDER BY created,address) disagreed across devices.
        self.db.execute("INSERT INTO wallet_links VALUES('first',?,100)", ('0x' + '1' * 40,))
        self.db.execute("INSERT INTO wallet_links VALUES('second',?,200)", ('0x' + '2' * 40,))
        self.db.commit()
        _, code = await self.post('start')
        _, request = await self.post('request', 'second', code=code['code'])
        with patch('device_sync.time.time', return_value=300):
            status, data = await self.post('accept', code=code['code'], requestId=request['requestId'])
        self.assertEqual(status, 200)
        self.assertEqual((await self.post('state', 'second'))[1]['addresses'], data['addresses'])
        self.assertEqual(linked_wallets(self.db, 'first'), linked_wallets(self.db, 'second'))

    async def test_wallet_changes_selection_versions_and_unsync(self):
        await self.pair()
        address = '0x' + '3'*40
        add_wallet(self.db, 'second', address)
        self.assertEqual(linked_wallets(self.db, 'first'), [address])
        remove_wallet(self.db, 'first', address)
        self.assertEqual(linked_wallets(self.db, 'second'), [])
        _, state = await self.post('state')
        status, changed = await self.post('state', 'second', revision=state['revision'], selection=[self.item])
        self.assertEqual(status, 200)
        self.assertEqual((await self.post('state'))[1]['selection'], [self.item])
        status, conflict = await self.post('state', revision=state['revision'], selection=[])
        self.assertEqual(status, 409); self.assertEqual(conflict['revision'], changed['revision'])
        await self.post('leave', 'second')
        add_wallet(self.db, 'second', address)
        self.assertEqual(linked_wallets(self.db, 'first'), [])
        _, solo = await self.post('state', 'second')
        await self.post('state', 'second', revision=solo['revision'], selection=[])
        self.assertEqual((await self.post('state'))[1]['selection'], [self.item])

    async def test_expiry_restart_unknown_device_and_invalid_selection(self):
        _, code = await self.post('start')
        with patch('device_sync.time.time', return_value=code['expires']+1):
            self.assertEqual((await self.post('request', 'second', code=code['code']))[0], 400)
        await self.post('start')
        self.assertEqual((await self.post('request', 'second', code=code['code']))[0], 400)
        self.assertEqual((await self.post('state', 'unknown'))[0], 400)
        for items in ([{**self.item,'chainId':1}], [self.item]*2, [{**self.item,'motion':{'size':10000}}], [self.item]*6):
            self.assertEqual((await self.post('state', revision=0, selection=items))[0], 400)
