import tempfile
import unittest
from aiohttp.test_utils import TestClient, TestServer
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
