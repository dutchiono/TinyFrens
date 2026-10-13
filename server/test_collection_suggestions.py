import os
import sys
import tempfile
import unittest
from aiohttp.test_utils import TestClient, TestServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app import create_app


class CollectionSuggestionsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = self.tmp.name + '/suggestions.db'
        self.client = TestClient(TestServer(create_app(self.path, ['https://tinyfrens.lol'])))
        await self.client.start_server()
        response = await self.client.post('/api/register', json={'pet': {'name': 'Test', 'shape': 'turtle', 'color': '#a474f1'}}, headers={'Origin':'https://tinyfrens.lol'})
        self.token = (await response.json())['token']

    async def asyncTearDown(self):
        await self.client.close()
        self.tmp.cleanup()

    async def post(self, **values):
        return await self.client.post('/api/collections/suggestions', json={'token':self.token, **values}, headers={'Origin':'https://tinyfrens.lol'})

    async def test_empty_then_persistent_deduplicated_suggestion(self):
        self.assertEqual((await (await self.client.get('/api/collections/suggestions', headers={'Origin':'https://tinyfrens.lol'})).json())['collections'], [])
        address = '0x' + 'aB' * 20
        response = await self.post(chainId=8453, address=address, name='A collection')
        self.assertEqual(response.status, 201)
        first = await response.json()
        response = await self.post(chainId=8453, address=address.lower(), name='Different name')
        self.assertTrue((await response.json())['existing'])
        response = await self.post(chainId=1, address=address, name='Same address, different network')
        self.assertEqual(response.status, 201)
        await self.client.close()
        self.client = TestClient(TestServer(create_app(self.path, ['https://tinyfrens.lol'])))
        await self.client.start_server()
        items = (await (await self.client.get('/api/collections/suggestions', headers={'Origin':'https://tinyfrens.lol'})).json())['collections']
        self.assertEqual(len(items), 2)
        self.assertIn(first['collection'], items)
        self.assertNotIn('token', str(items))

    async def test_invalid_address_network_and_credential_rejected(self):
        for values in [dict(chainId=1,address='0x123'),dict(chainId=1,address='0x'+'0'*40),dict(chainId=True,address='0x'+'a'*40),dict(chainId=1,address='0x'+'a'*40,token='invalid')]:
            self.assertEqual((await self.post(**values)).status, 400)
        self.assertEqual((await (await self.client.get('/api/collections/suggestions', headers={'Origin':'https://tinyfrens.lol'})).json())['collections'], [])

    async def test_vote_flow_deducts_deposited_frens_and_updates_rankings(self):
        # 1. Suggest two collections
        col1_res = await self.post(chainId=8453, address='0x' + '11' * 20, name='First Collection')
        col2_res = await self.post(chainId=8453, address='0x' + '22' * 20, name='Second Collection')
        cid1 = (await col1_res.json())['collection']['id']
        cid2 = (await col2_res.json())['collection']['id']

        # 2. Grant credits to pet account directly in db to simulate confirmed deposit
        import sqlite3
        conn = sqlite3.connect(self.path)
        pid = conn.execute('SELECT id FROM pets LIMIT 1').fetchone()[0]
        conn.execute('INSERT INTO credit_accounts(pet_id, balance, updated_at) VALUES(?, 5000, 100)', (pid,))
        conn.commit()
        conn.close()

        # Check vote status endpoint
        status_res = await self.client.post('/api/vote/status', json={'token': self.token}, headers={'Origin':'https://tinyfrens.lol'})
        self.assertEqual(status_res.status, 200)
        self.assertEqual((await status_res.json())['balance'], 5000)

        # 3. Vote on collection 2 with 20 FRENS (2000 credits)
        vote_res = await self.client.post('/api/collections/vote',
            json={'token': self.token, 'collectionId': cid2, 'amount': '20'},
            headers={'Origin':'https://tinyfrens.lol'}
        )
        self.assertEqual(vote_res.status, 200)
        vote_data = await vote_res.json()
        self.assertTrue(vote_data['success'])
        self.assertEqual(vote_data['creditsBurned'], 2000)
        self.assertEqual(vote_data['balance'], 3000)

        # 4. Check listing: Collection 2 should now be at the TOP with 2000 credits
        listing = (await (await self.client.get('/api/collections/suggestions', headers={'Origin':'https://tinyfrens.lol'})).json())['collections']
        self.assertEqual(listing[0]['id'], cid2)
        self.assertEqual(listing[0]['credits'], 2000)
        self.assertEqual(listing[0]['votes'], 1)
        self.assertEqual(listing[0]['frens'], 20)

        # Verify no pet_id or private account details are leaked in the listing
        listing_str = str(listing)
        self.assertNotIn(pid, listing_str)
        self.assertNotIn(self.token, listing_str)

    async def test_voting_prevents_overvoting_and_invalid_inputs(self):
        col_res = await self.post(chainId=8453, address='0x' + '33' * 20, name='Target Collection')
        cid = (await col_res.json())['collection']['id']

        # User has 0 balance: attempting to vote fails
        fail_res = await self.client.post('/api/collections/vote',
            json={'token': self.token, 'collectionId': cid, 'amount': '10'},
            headers={'Origin':'https://tinyfrens.lol'}
        )
        self.assertEqual(fail_res.status, 400)
        self.assertIn('Insufficient', (await fail_res.json())['error'])

        # Grant 100 credits (1 FRENS)
        import sqlite3
        conn = sqlite3.connect(self.path)
        pid = conn.execute('SELECT id FROM pets LIMIT 1').fetchone()[0]
        conn.execute('INSERT INTO credit_accounts(pet_id, balance, updated_at) VALUES(?, 100, 100)', (pid,))
        conn.commit()
        conn.close()

        # Attempt to overvote (e.g. 5 FRENS when only 1 FRENS available)
        over_res = await self.client.post('/api/collections/vote',
            json={'token': self.token, 'collectionId': cid, 'amount': '5'},
            headers={'Origin':'https://tinyfrens.lol'}
        )
        self.assertEqual(over_res.status, 400)
        self.assertIn('Insufficient', (await over_res.json())['error'])

        # Attempt negative amount, zero, strings, NaN, invalid collection
        for bad in ['-1', '0', '-0.5', 'abc', '', '0.0000000000000000001']:
            r = await self.client.post('/api/collections/vote',
                json={'token': self.token, 'collectionId': cid, 'amount': bad},
                headers={'Origin':'https://tinyfrens.lol'}
            )
            self.assertEqual(r.status, 400)

        # Invalid collection ID
        r = await self.client.post('/api/collections/vote',
            json={'token': self.token, 'collectionId': 99999, 'amount': '1'},
            headers={'Origin':'https://tinyfrens.lol'}
        )
        self.assertEqual(r.status, 400)

        # Bad token / unauthenticated
        r = await self.client.post('/api/collections/vote',
            json={'token': 'bad-token', 'collectionId': cid, 'amount': '1'},
            headers={'Origin':'https://tinyfrens.lol'}
        )
        self.assertEqual(r.status, 400)
