import asyncio
import base64
import json
import sqlite3
import unittest
from unittest.mock import AsyncMock

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from robot_companion import Robots, CONTRACT, START_BLOCK, TRANSFER
from robot_gallery import RobotGallery, ZERO, install


class GalleryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = sqlite3.connect(':memory:')
        self.robots = Robots(self.db)
        self.logs = [self.event(1, True, 0)]
        self.fail = False
        self.head = START_BLOCK + 100
        self.metadata_calls = 0
        async def rpc(method, params):
            if self.fail: raise RuntimeError('RPC unavailable')
            if method == 'eth_chainId': return '0x2105'
            if method == 'eth_blockNumber': return hex(self.head)
            if method == 'eth_getLogs':
                return [event for event in self.logs if int(params[0]['fromBlock'],16) <= int(event['blockNumber'],16) <= int(params[0]['toBlock'],16)]
            if method == 'eth_call' and params[0]['data'] == '0x18160ddd':
                return hex(len(current_ids()))
            self.metadata_calls += 1
            metadata = {'name':'Robot', 'image':'data:image/svg+xml;base64,' + base64.b64encode(b'<svg/>').decode()}
            uri = 'data:application/json;base64,' + base64.b64encode(json.dumps(metadata).encode()).decode()
            return '0x' + format(32,'064x') + format(len(uri),'064x') + uri.encode().hex()
        def current_ids():
            ids = set()
            for event in self.logs:
                tid = int(event['topics'][3], 16)
                if event['topics'][1] == ZERO: ids.add(tid)
                else: ids.discard(tid)
            return ids
        async def owner_batch(ids):
            if self.fail: raise RuntimeError('RPC unavailable')
            return {str(tid): '0x' + '1' * 40 for tid in ids if tid in current_ids()}
        self.robots.owner_batch = AsyncMock(side_effect=owner_batch)
        self.robots.rpc = AsyncMock(side_effect=rpc)
        self.gallery = RobotGallery(self.robots)

    async def asyncTearDown(self): self.db.close()

    def event(self, tid, minted, position, block=START_BLOCK + 90):
        address = '0x' + '1' * 64
        return {'address':CONTRACT, 'blockNumber':hex(block), 'logIndex':hex(position),
                'topics':[TRANSFER, ZERO if minted else address, address if minted else ZERO, '0x'+format(tid,'064x')]}

    def expire(self):
        self.db.execute('UPDATE robot_gallery_state SET checked=0')
        self.db.commit()

    async def test_concurrent_visitors_and_restart_reuse_inventory_and_art(self):
        a,b = await asyncio.gather(self.gallery.page(), self.gallery.page())
        self.assertEqual(a,b)
        self.assertEqual(self.metadata_calls,1)
        calls = self.robots.rpc.await_count
        await RobotGallery(self.robots).page()
        self.assertEqual(self.robots.rpc.await_count,calls)
        self.expire()
        await self.gallery.page()
        self.assertEqual(self.metadata_calls,1)

    async def test_explicit_refresh_reads_new_mints_without_expiring_art_cache(self):
        await self.gallery.page()
        self.logs.append(self.event(2, True, 1))
        self.assertEqual((await self.gallery.page())['supply'], 1)
        page = await self.gallery.page(force=True)
        self.assertEqual(page['supply'], 2)
        self.assertEqual(self.metadata_calls, 2)

    async def test_new_mint_burn_and_reorg_update_inventory(self):
        await self.gallery.page()
        self.logs.extend([self.event(1,False,1),self.event(2,True,2)])
        self.expire()
        page=await self.gallery.page()
        self.assertEqual(page['supply'],1)
        self.assertEqual([i['tokenId'] for i in page['items']],[2])
        self.logs=self.logs[:1]  # A recent reorg removes the burn and second mint.
        self.expire()
        page=await self.gallery.page()
        self.assertEqual([i['tokenId'] for i in page['items']],[1])
        self.assertEqual(self.metadata_calls,2)

    async def test_provider_failure_serves_marked_cache_without_advancing_checkpoint(self):
        first=await self.gallery.page()
        self.expire(); self.fail=True
        second=await self.gallery.page()
        self.assertTrue(second['stale'])
        self.assertEqual(second['items'],first['items'])
        self.assertEqual(self.db.execute('SELECT block FROM robot_gallery_state').fetchone()[0],self.head)
        calls=self.robots.rpc.await_count
        await self.gallery.page()
        self.assertEqual(self.robots.rpc.await_count,calls)

    async def test_failed_first_scan_does_not_create_an_empty_inventory(self):
        self.fail=True
        with self.assertRaises(RuntimeError): await self.gallery.page()
        self.assertIsNone(self.db.execute('SELECT * FROM robot_gallery_state').fetchone())

    async def test_pagination_and_http_cache_headers(self):
        self.logs=[self.event(tid,True,tid) for tid in range(1,27)]
        page=await self.gallery.page()
        self.assertEqual(len(page['items']),24)
        self.assertEqual(page['nextAfter'],24)
        self.assertEqual([i['tokenId'] for i in (await self.gallery.page(24))['items']],[25,26])
        app=web.Application(); install(app,self.robots)
        async with TestClient(TestServer(app)) as client:
            response=await client.get('/api/robots/gallery')
            self.assertEqual(response.status,200)
            self.assertEqual(response.headers['Cache-Control'],'public, max-age=30')
            self.assertEqual((await client.get('/api/robots/gallery?after=-1')).status,400)
