import base64
import json
from pathlib import Path
import sqlite3
import unittest
from unittest.mock import AsyncMock
from extra_companions import ExtraCompanions, COLLECTIONS

BOT = '0x8d446c126d4873bfa3eb195b7f0094acc1187a75'
NUB = '0x34d9e560ee16662d19e44315a822bd51eea0133c'
OWNER = '0x1111111111111111111111111111111111111111'
OTHER = '0x2222222222222222222222222222222222222222'


class ExtraCompanionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db=sqlite3.connect(':memory:');self.extra=ExtraCompanions(self.db)
        self.owner=OWNER;self.fail=False;self.chain=8453
        art=(Path(__file__).parent/'fixtures/bots-computer-1.svg').read_bytes()
        uri='data:application/json;base64,'+base64.b64encode(json.dumps({'name':'Bots Computer #1','image':'data:image/svg+xml;base64,'+base64.b64encode(art).decode()}).encode()).decode()
        self.uri='0x'+format(32,'064x')+format(len(uri),'064x')+uri.encode().hex()
        async def rpc(collection,requests):
            if self.fail: raise RuntimeError('RPC unavailable')
            result={}
            for request in requests:
                method=request['method'];value=None
                if method=='eth_chainId':value=hex(self.chain)
                elif method=='eth_blockNumber':value=hex(1)
                elif method=='eth_getLogs':value=[{'address':NUB,'blockNumber':'0x1','logIndex':'0x0','topics':['0xtransfer','0x'+'0'*64,'0x'+OWNER[2:].zfill(64),'0x'+format(1,'064x')]}]
                else:
                    data=request['params'][0]['data'];selector=data[:10]
                    if selector=='0x18160ddd':value='0x'+format(1,'064x')
                    elif selector=='0xc87b56dd':value=self.uri
                    elif int(data[10:],16)==1:value='0x'+self.owner[2:].zfill(64)
                result[request['id']]={'result':value} if value is not None else {'error':{'code':3}}
            return result
        self.extra.rpc=AsyncMock(side_effect=rpc)

    async def asyncTearDown(self):self.db.close()

    async def test_discovery_adds_collection_to_existing_wallet_without_pairing(self):
        result=await self.extra.discover([OWNER,OTHER],BOT)
        self.assertEqual([item['tokenId'] for item in result['nfts']],[1])
        self.assertEqual(result['nfts'][0]['wallet'],OWNER)
        calls=self.extra.rpc.await_count
        await self.extra.discover([OWNER],BOT)
        self.assertEqual(self.extra.rpc.await_count,calls)
        self.assertEqual((await self.extra.discover([OTHER],BOT))['nfts'],[])

    async def test_ownership_rig_daily_cache_and_transfer_revocation(self):
        result=await self.extra.read(OWNER,1,BOT)
        self.assertTrue(result['active']);self.assertEqual(len(result['companion']['frames']),6)
        calls=self.extra.rpc.await_count
        await self.extra.read(OWNER,1,BOT)
        self.assertEqual(self.extra.rpc.await_count,calls)
        self.db.execute('UPDATE extra_companion_ownership SET checked=0');self.db.commit();self.owner=OTHER
        self.assertFalse((await self.extra.read(OWNER,1,BOT))['active'])
        self.assertIsNone(self.db.execute('SELECT * FROM extra_companion_ownership').fetchone())

    async def test_wrong_chain_unknown_collection_and_provider_error_fail_closed(self):
        self.chain=4663
        with self.assertRaisesRegex(RuntimeError,'Wrong'):await self.extra.read(OWNER,1,BOT)
        with self.assertRaises(ValueError):await self.extra.read(OWNER,1,OWNER)
        self.fail=True
        with self.assertRaises(RuntimeError):await self.extra.discover([OWNER],BOT)
        self.assertIsNone(self.db.execute('SELECT * FROM extra_companion_inventory').fetchone())

    async def test_robinhood_logs_reconstruct_nub_inventory(self):
        self.chain=4663
        result=await self.extra.discover([OWNER],NUB)
        self.assertEqual(result['nfts'][0]['originalAddress'],NUB)
        self.assertEqual(result['nfts'][0]['chainId'],4663)
