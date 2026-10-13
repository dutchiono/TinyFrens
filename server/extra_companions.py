"""Explicit collection adapters; pairing remains wallet-wide."""
import asyncio
import base64
import json
import os
import re
import time
from aiohttp import ClientSession, ClientTimeout
from eth_utils import to_checksum_address
import bots_computer_art
import nub_art

COLLECTIONS = {
    '0x34d9e560ee16662d19e44315a822bd51eea0133c': (4663, 3000, 'The Nubs', nub_art),
    '0x8d446c126d4873bfa3eb195b7f0094acc1187a75': (8453, 10000, 'Bots Computers', bots_computer_art),
}


class ExtraCompanions:
    def __init__(self, db):
        self.db = db
        self.locks = {address: asyncio.Lock() for address in COLLECTIONS}
        db.execute('CREATE TABLE IF NOT EXISTS extra_companion_ownership(wallet TEXT,collection TEXT,token INTEGER,checked REAL,payload TEXT,PRIMARY KEY(wallet,collection,token))')
        db.execute('CREATE TABLE IF NOT EXISTS extra_companion_inventory(collection TEXT PRIMARY KEY,checked REAL,owners TEXT)')
        db.commit()

    def config(self, collection):
        if collection not in COLLECTIONS: raise ValueError('Unsupported companion collection')
        return COLLECTIONS[collection]

    async def rpc(self, collection, requests):
        chain, _, _, _ = self.config(collection)
        url = os.environ.get('ROBINHOOD_RPC_URL', 'https://rpc.mainnet.chain.robinhood.com') if chain == 4663 else os.environ.get('ROBOTS_RPC_URL', 'https://base-rpc.publicnode.com')
        async with ClientSession(timeout=ClientTimeout(total=30), headers={'User-Agent':'TinyFrens/1.0'}) as session:
            async with session.post(url, json=requests) as response:
                response.raise_for_status()
                data = await response.json(content_type=None)
        if not isinstance(data, list) or len(data) != len(requests): raise RuntimeError('Invalid collection RPC batch')
        return {item['id']:item for item in data}

    async def discover(self, wallets, collection):
        chain, maximum, name, _ = self.config(collection)
        async with self.locks[collection]:
            row = self.db.execute('SELECT checked,owners FROM extra_companion_inventory WHERE collection=?', (collection,)).fetchone()
            if row and 0 <= time.time() - row[0] < 600:
                owners = json.loads(row[1])
            else:
                check = await self.rpc(collection, [{'jsonrpc':'2.0','id':0,'method':'eth_chainId','params':[]}])
                if check[0].get('result') != hex(chain): raise RuntimeError('Wrong collection RPC chain')
                owners = {}
                if chain == 4663:
                    head_result = await self.rpc(collection, [{'jsonrpc':'2.0','id':0,'method':'eth_blockNumber','params':[]}])
                    head = int(head_result[0]['result'],16)
                    if head > 200_000_000: raise RuntimeError('Collection discovery range exceeds budget')
                    transfer = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
                    for start in range(0,head+1,10_000_000):
                        result = await self.rpc(collection,[{'jsonrpc':'2.0','id':0,'method':'eth_getLogs','params':[{'address':collection,'fromBlock':hex(start),'toBlock':hex(min(head,start+9_999_999)),'topics':[transfer]}]}])
                        logs=result[0].get('result')
                        if not isinstance(logs,list): raise RuntimeError('Collection transfer history unavailable')
                        for log in sorted(logs,key=lambda event:(int(event['blockNumber'],16),int(event['logIndex'],16))):
                            topics=log.get('topics',[])
                            if log.get('removed') or len(topics)!=4 or log.get('address','').lower()!=collection: continue
                            tid=int(topics[3],16)
                            if 1<=tid<=maximum:
                                owner='0x'+topics[2][-40:].lower()
                                if int(owner,16): owners[str(tid)]=owner
                                else: owners.pop(str(tid),None)
                else:
                    supply_result=await self.rpc(collection,[{'jsonrpc':'2.0','id':0,'method':'eth_call','params':[{'to':collection,'data':'0x18160ddd'},'latest']}])
                    supply=int(supply_result[0]['result'],16)
                    if supply > maximum: raise RuntimeError('Collection exceeds discovery budget')
                    # Sequential IDs; continue past burned IDs until every extant token is found.
                    for start in range(1,maximum+1,20):
                        if len(owners)>=supply: break
                        requests=[{'jsonrpc':'2.0','id':tid,'method':'eth_call','params':[{'to':collection,'data':'0x6352211e'+format(tid,'064x')},'latest']} for tid in range(start,min(start+20,maximum+1))]
                        results=await self.rpc(collection,requests)
                        for request in requests:
                            tid=request['id'];result=results.get(tid,{});raw=result.get('result','')
                            if re.fullmatch(r'0x0{24}[0-9a-fA-F]{40}',raw): owners[str(tid)]='0x'+raw[-40:].lower()
                            elif result.get('error',{}).get('code')!=3: raise RuntimeError('Collection ownership scan unavailable')
                    if len(owners)!=supply: raise RuntimeError('Collection inventory and supply disagree')
                with self.db: self.db.execute('INSERT OR REPLACE INTO extra_companion_inventory VALUES(?,?,?)',(collection,time.time(),json.dumps(owners)))
        linked={wallet.lower():wallet for wallet in wallets}
        return {'nfts':[{'tokenId':int(tid),'wallet':linked[owner],'collection':name,'name':f'{name} #{tid}','chainId':chain,'originalAddress':collection} for tid,owner in owners.items() if owner in linked], 'partial':False}

    async def read(self, wallet, tid, collection):
        chain, maximum, name, adapter = self.config(collection)
        if isinstance(tid,bool) or not str(tid).isdigit() or not 1 <= int(tid) <= maximum: raise ValueError('Invalid companion token')
        tid=int(tid);wallet=to_checksum_address(wallet)
        row=self.db.execute('SELECT checked,payload FROM extra_companion_ownership WHERE wallet=? AND collection=? AND token=?',(wallet,collection,tid)).fetchone()
        if row and 0 <= time.time()-row[0] < 86400: return adapter.with_companion(json.loads(row[1]))
        result=await self.rpc(collection,[{'jsonrpc':'2.0','id':0,'method':'eth_chainId','params':[]},
            {'jsonrpc':'2.0','id':1,'method':'eth_call','params':[{'to':collection,'data':'0x6352211e'+format(tid,'064x')},'latest']}])
        if result[0].get('result') != hex(chain): raise RuntimeError('Wrong companion chain')
        raw=result[1].get('result','')
        if not re.fullmatch(r'0x0{24}[0-9a-fA-F]{40}',raw): raise RuntimeError('Ownership verification unavailable')
        owner=to_checksum_address('0x'+raw[-40:]);active=owner==wallet;metadata={}
        if active:
            result=await self.rpc(collection,[{'jsonrpc':'2.0','id':0,'method':'eth_call','params':[{'to':collection,'data':'0xc87b56dd'+format(tid,'064x')},'latest']}])
            raw=bytes.fromhex(result[0]['result'][2:]);length=int.from_bytes(raw[32:64],'big')
            if int.from_bytes(raw[:32],'big')!=32 or not 0 < length <= 100000 or 64+length>len(raw): raise RuntimeError('Invalid companion metadata')
            uri=raw[64:64+length].decode()
            if uri.startswith('data:application/json;base64,'): metadata=json.loads(base64.b64decode(uri.split(',',1)[1],validate=True))
            elif collection=='0x34d9e560ee16662d19e44315a822bd51eea0133c' and uri==f'https://thenubs.xyz/meta/{tid}':
                async with ClientSession(timeout=ClientTimeout(total=20)) as session:
                    async with session.get(uri) as response:
                        response.raise_for_status();metadata=await response.json()
                    image=metadata.get('image')
                    if image!=f'https://thenubs.xyz/art/{tid}.png': raise RuntimeError('Unexpected Nub artwork location')
                    async with session.get(image) as response:
                        response.raise_for_status();art=await response.content.read(5_000_001)
                    if len(art)>5_000_000: raise RuntimeError('Nub artwork too large')
                    metadata['image']='data:image/png;base64,'+base64.b64encode(art).decode()
            else: raise RuntimeError('Unsupported companion metadata location')
        checked=time.time()
        data={'tokenId':tid,'wallet':wallet,'originalOwner':owner,'active':active,'name':metadata.get('name',f'{name} #{tid}'),'collection':name,'originalAddress':collection,'chainId':chain,'image':metadata.get('image'),'checkedAt':checked,'validUntil':checked+86400}
        with self.db:
            self.db.execute('DELETE FROM extra_companion_ownership WHERE wallet=? AND collection=? AND token=?',(wallet,collection,tid))
            if active:self.db.execute('INSERT INTO extra_companion_ownership VALUES(?,?,?,?,?)',(wallet,collection,tid,checked,json.dumps(data)))
        return adapter.with_companion(data)
