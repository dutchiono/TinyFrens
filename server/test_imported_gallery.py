import json
import sqlite3
import unittest

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from imported_gallery import COLLECTIONS, imported_page, install


class ImportedGalleryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript('''
            CREATE TABLE device_sync_accounts(account TEXT, revision INTEGER, selection TEXT);
            CREATE TABLE device_sync_members(device TEXT, account TEXT);
            CREATE TABLE wallet_links(pet_id TEXT, address TEXT, created INTEGER);
            CREATE TABLE turtle_ownership(wallet TEXT, token_id INTEGER, checked REAL, payload TEXT);
            CREATE TABLE extra_companion_ownership(wallet TEXT, collection TEXT, token INTEGER, checked REAL, payload TEXT);
        ''')
        self.collection = next(c for c in COLLECTIONS if c['id'] == 'nubs')
        self.wallet = '0x' + '1' * 40
        self.db.execute('INSERT INTO device_sync_accounts VALUES(?,0,?)', ('a', '[]'))
        self.db.execute('INSERT INTO device_sync_members VALUES(?,?)', ('device', 'a'))
        self.db.execute('INSERT INTO wallet_links VALUES(?,?,0)', ('device', self.wallet))
        app = web.Application(); install(app, self.db)
        self.client = TestClient(TestServer(app)); await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close(); self.db.close()

    def cache(self, tid, collection=None, wallet=None):
        c = collection or self.collection
        wallet = wallet or self.wallet
        data = dict(active=True, tokenId=tid, chainId=c['chainId'], originalAddress=c['contract'],
                    originalOwner=wallet, name=f"{c['name']} #{tid}", image='data:image/png;base64,AAAA', checkedAt=100)
        if c['id'] == 'hood-turtles':
            self.db.execute('INSERT INTO turtle_ownership VALUES(?,?,?,?)', (wallet, tid, 100, json.dumps(data)))
        else:
            self.db.execute('INSERT INTO extra_companion_ownership VALUES(?,?,?,?,?)', (wallet, c['contract'], tid, 100, json.dumps(data)))

    def select(self, ids, collection=None):
        c = collection or self.collection
        self.db.execute('UPDATE device_sync_accounts SET selection=?',
            (json.dumps([dict(tokenId=tid, chainId=c['chainId'], originalAddress=c['contract']) for tid in ids]),))

    async def test_only_selected_verified_imports_and_no_private_account_fields(self):
        self.cache(1); self.cache(2)
        self.cache(3, wallet='0x' + '2' * 40)
        self.select([1, 3, 4])
        response = await self.client.get('/api/gallery/imported?collection=nubs')
        self.assertEqual(response.status, 200)
        data = await response.json()
        self.assertEqual([i['tokenId'] for i in data['items']], [1])
        self.assertNotIn('account', str(data)); self.assertNotIn('device', str(data))
        self.select([])
        self.assertEqual(imported_page(self.db, self.collection)['items'], [])

    async def test_collection_and_chain_boundaries_and_wallet_unlink(self):
        self.cache(1); self.select([1])
        hood = next(c for c in COLLECTIONS if c['id'] == 'hood-turtles')
        self.assertEqual(imported_page(self.db, hood)['items'], [])
        self.db.execute('UPDATE device_sync_accounts SET selection=?', (json.dumps([dict(tokenId=1,chainId=8453,originalAddress=self.collection['contract'])]),))
        self.assertEqual(imported_page(self.db, self.collection)['items'], [])
        self.select([1]); self.db.execute('DELETE FROM wallet_links')
        self.assertEqual(imported_page(self.db, self.collection)['items'], [])

    async def test_deduplication_pagination_and_hood_imports(self):
        for tid in range(1, 27): self.cache(tid)
        self.select(list(range(1,27)))
        self.db.execute('INSERT INTO device_sync_members VALUES(?,?)', ('second-device', 'a'))
        self.db.execute('INSERT INTO wallet_links VALUES(?,?,0)', ('second-device', self.wallet))
        first = imported_page(self.db, self.collection)
        self.assertEqual(len(first['items']), 24); self.assertEqual(first['nextAfter'], 24)
        second = imported_page(self.db, self.collection, 24)
        self.assertEqual([i['tokenId'] for i in second['items']], [25,26]); self.assertIsNone(second['nextAfter'])
        hood = next(c for c in COLLECTIONS if c['id'] == 'hood-turtles')
        self.cache(1, hood); self.select([1], hood)
        self.assertEqual(len(imported_page(self.db, hood)['items']), 1)

    async def test_release_first_and_unknown_collections_rejected(self):
        data = await (await self.client.get('/api/gallery/collections')).json()
        self.assertTrue(data['collections'][0]['release'])
        for query in ['collection=unknown', 'collection=robots', 'collection=nubs&after=-1']:
            self.assertEqual((await self.client.get('/api/gallery/imported?' + query)).status, 400)
