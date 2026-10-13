"""Collection-specific Robots v1 ownership, discovery and transparent walk frames."""
import asyncio
import base64
import copy
import json
import os
import re
import time
import xml.etree.ElementTree as ET

from aiohttp import ClientSession, ClientTimeout
from eth_utils import to_checksum_address

CONTRACT = '0xd745d8005a1ad8f783b97bf55e0d0e6a920ea8ff'
CHAIN_ID = 8453
START_BLOCK = 52_529_190  # Base fork rehearsal before this collection was deployed.
TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
NS = '{http://www.w3.org/2000/svg}'
TTL = 86400


def token_id(value):
    if isinstance(value, bool) or not re.fullmatch(r'[0-9]{1,4}', str(value)) or not 1 <= int(value) <= 2664:
        raise ValueError('Invalid Robots v1 token number')
    return int(value)


def companion(image):
    """Keep the deployed character groups; sample its eight-step walk for native renderers."""
    if not isinstance(image, str) or not image.startswith('data:image/svg+xml;base64,'):
        raise ValueError('Invalid Robots v1 artwork')
    raw = base64.b64decode(image.split(',', 1)[1], validate=True)
    if len(raw) > 100_000 or b'<!' in raw:
        raise ValueError('Invalid Robots v1 SVG')
    root = ET.fromstring(raw)
    if root.tag != NS + 'svg' or root.get('viewBox') != '0 0 128 128' or root.get('data-species') != '0':
        raise ValueError('Unexpected Robots v1 SVG structure')
    groups = [n for n in root if n.tag == NS + 'g' and n.get('transform') == 'translate(16 30)']
    if len(groups) != 1:
        raise ValueError('Robot character layer missing')
    character = copy.deepcopy(groups[0])
    for node in list(character):
        if node.get('class') == 'shadow':
            character.remove(node)
    for node in character.iter():
        if node.tag not in {NS + 'g', NS + 'path', NS + 'rect'} or any(
                key not in {'d', 'fill', 'opacity', 'transform', 'class', 'x', 'y', 'width', 'height'} for key in node.attrib):
            raise ValueError('Unexpected robot drawing instruction')
    classes = {n.get('class') for n in character.iter()}
    if not {'body', 'foot-a', 'foot-b', 'arm-a', 'arm-b'} <= classes:
        raise ValueError('Robot walk layers missing')
    style = ''.join(n.text or '' for n in root if n.tag == NS + 'style')
    duration = re.search(r'\.body\{animation:bob (0\.8471|1\.8824|0\.6588|1\.1294)s ', style)
    if not duration:
        raise ValueError('Robot walk timing missing')
    feet = [(-1, 0), (0, -1), (1, -2), (2, -1), (2, 0), (1, 0), (0, 0), (-1, 0)]
    arms = [(1, 0), (-1, 1), (-1, 0), (1, -1)]
    def frame(phase=None):
        svg = ET.Element(NS + 'svg', {'viewBox':'16 30 96 96', 'width':'128', 'height':'128', 'shape-rendering':'crispEdges'})
        drawing = copy.deepcopy(character)
        if phase is not None:
            for node in drawing.iter():
                cls = node.get('class')
                delta = None
                if cls == 'body': delta = (0, -1 if phase % 2 else 0)
                elif cls in {'foot-a', 'foot-b'}: delta = feet[(phase + (4 if cls == 'foot-b' else 0)) % 8]
                elif cls in {'arm-a', 'arm-b'}: delta = arms[((phase + (4 if cls == 'arm-b' else 0)) % 8) // 2]
                if delta: node.set('transform', f'translate({delta[0]} {delta[1]})')
        svg.append(drawing)
        return 'data:image/svg+xml;base64,' + base64.b64encode(ET.tostring(svg)).decode()
    return {'adapter':'tinyfrens-robots-v1', 'frames':[frame(i) for i in range(8)],
            'frameMs':round(float(duration[1]) * 1000 / 8), 'idle':frame()}


class Robots:
    def __init__(self, db):
        self.db = db
        self.lock = asyncio.Lock()
        self.inventory_lock = asyncio.Lock()
        db.execute('CREATE TABLE IF NOT EXISTS robot_ownership(wallet TEXT, token_id INTEGER, checked REAL, payload TEXT, PRIMARY KEY(wallet,token_id))')
        db.execute('CREATE TABLE IF NOT EXISTS robot_discovery(wallet TEXT PRIMARY KEY, block INTEGER, ids TEXT)')
        db.execute('CREATE TABLE IF NOT EXISTS robot_owner_inventory(id INTEGER PRIMARY KEY, checked REAL, owners TEXT)')
        db.commit()

    async def rpc(self, method, params):
        async with ClientSession(timeout=ClientTimeout(total=20), headers={'User-Agent':'TinyFrens/1.0'}) as session:
            async with session.post(os.environ.get('ROBOTS_RPC_URL', 'https://base-rpc.publicnode.com'),
                    json={'jsonrpc':'2.0','id':1,'method':method,'params':params}) as response:
                response.raise_for_status()
                data = await response.json()
        if data.get('error'):
            error = data['error']
            # ERC721A burned/unminted ID; never suppress a general RPC failure.
            if error.get('code') == 3 and error.get('data') in {'0xdf2d9b42', '0xa14c4b50'}:
                return None
            raise RuntimeError('Base RPC: ' + str(error.get('message', 'request failed')))
        if 'result' not in data:
            raise RuntimeError('Invalid Base RPC response')
        return data['result']

    async def call(self, selector, argument, block='latest'):
        return await self.rpc('eth_call', [{'to':CONTRACT, 'data':selector + format(argument, '064x')}, block])

    async def read(self, wallet, tid):
        tid = token_id(tid)
        wallet = to_checksum_address(wallet)
        async with self.lock:
            row = self.db.execute('SELECT checked,payload FROM robot_ownership WHERE wallet=? AND token_id=?', (wallet, tid)).fetchone()
            if row and row[0] <= time.time() < row[0] + TTL:
                return json.loads(row[1])
            if await self.rpc('eth_chainId', []) != '0x2105':
                raise RuntimeError('Robots v1 RPC must be Base mainnet')
            block = await self.rpc('eth_blockNumber', [])
            owner_raw = await self.call('0x6352211e', tid, block)
            if owner_raw is not None and not re.fullmatch(r'0x0{24}[0-9a-fA-F]{40}', owner_raw):
                raise RuntimeError('Invalid robot ownership response')
            owner = to_checksum_address('0x' + owner_raw[-40:]) if owner_raw else None
            active = owner == wallet
            metadata = {}
            rig = None
            if active:
                encoded = await self.call('0xc87b56dd', tid, block)
                raw = bytes.fromhex(encoded[2:])
                length = int.from_bytes(raw[32:64], 'big')
                if int.from_bytes(raw[:32], 'big') != 32 or not 0 < length <= 100_000 or 64 + length > len(raw):
                    raise RuntimeError('Invalid robot metadata response')
                uri = raw[64:64 + length].decode()
                if not uri.startswith('data:application/json;base64,'):
                    raise RuntimeError('Robot metadata is not embedded')
                metadata = json.loads(base64.b64decode(uri.split(',', 1)[1], validate=True))
                rig = companion(metadata.get('image'))
            checked = time.time()
            result = {'tokenId':tid,'wallet':wallet,'originalOwner':owner,'active':active,
                      'image':metadata.get('image'), 'name':str(metadata.get('name', f'TinyFrens Robot v1 #{tid}'))[:80],
                      'collection':'TinyFrens: Robots v1','originalAddress':CONTRACT,'chainId':CHAIN_ID,
                      'companion':rig,'checkedAt':checked,'validUntil':checked + TTL}
            self.db.execute('DELETE FROM robot_ownership WHERE wallet=? AND token_id=?', (wallet, tid))
            if active: self.db.execute('INSERT INTO robot_ownership VALUES(?,?,?,?)', (wallet, tid, checked, json.dumps(result)))
            self.db.commit()
            return result

    async def owner_batch(self, ids):
        requests = [{'jsonrpc':'2.0','id':tid,'method':'eth_call',
                     'params':[{'to':CONTRACT,'data':'0x6352211e' + format(tid,'064x')},'latest']} for tid in ids]
        async with ClientSession(timeout=ClientTimeout(total=20), headers={'User-Agent':'TinyFrens/1.0'}) as session:
            async with session.post(os.environ.get('ROBOTS_RPC_URL', 'https://base-rpc.publicnode.com'), json=requests) as response:
                response.raise_for_status()
                data = await response.json()
        if not isinstance(data, list) or len(data) != len(requests): raise RuntimeError('Invalid robot inventory batch')
        if {item.get('id') for item in data} != {item['id'] for item in requests}: raise RuntimeError('Invalid robot inventory IDs')
        owners = {}
        for item in data:
            error = item.get('error', {})
            if error.get('code') == 3 and error.get('data') in {'0xdf2d9b42', '0xa14c4b50'}: continue
            raw = item.get('result', '')
            if error or not re.fullmatch(r'0x0{24}[0-9a-fA-F]{40}', raw): raise RuntimeError('Robot inventory ownership unavailable')
            if int(raw,16): owners[str(item['id'])] = '0x' + raw[-40:]
        return owners

    async def discover(self, wallet):
        wallet = to_checksum_address(wallet)
        if await self.rpc('eth_chainId', []) != '0x2105':
            raise RuntimeError('Robots v1 RPC must be Base mainnet')
        balance = await self.call('0x70a08231', int(wallet, 16))
        if not isinstance(balance, str) or not re.fullmatch(r'0x[0-9a-fA-F]{64}', balance):
            raise RuntimeError('Invalid robot balance')
        if int(balance, 16) == 0: return {'nfts':[], 'partial':False}
        # Current ownership reads do not require archive access to old transfers.
        async with self.inventory_lock:
            row = self.db.execute('SELECT checked,owners FROM robot_owner_inventory WHERE id=1').fetchone()
            owners = json.loads(row[1]) if row else {}
            owned = [tid for tid, owner in owners.items() if owner.lower() == wallet.lower()]
            if not row or not 0 <= time.time() - row[0] < 600 or len(owned) != int(balance, 16):
                supply_raw = await self.rpc('eth_call', [{'to':CONTRACT,'data':'0x18160ddd'},'latest'])
                if not isinstance(supply_raw, str) or not re.fullmatch(r'0x[0-9a-fA-F]{64}', supply_raw):
                    raise RuntimeError('Invalid robot supply')
                supply = int(supply_raw, 16)
                if supply > 2664: raise RuntimeError('Robot supply exceeds collection limit')
                owners = {}
                for start in range(1, 2665, 20):
                    if len(owners) >= supply: break
                    owners.update(await self.owner_batch(range(start, min(start + 20, 2665))))
                if len(owners) != supply: raise RuntimeError('Robot inventory does not match current supply')
                self.db.execute('INSERT OR REPLACE INTO robot_owner_inventory VALUES(1,?,?)', (time.time(), json.dumps(owners)))
                self.db.commit()
            ids = [int(tid) for tid, owner in owners.items() if owner.lower() == wallet.lower()]
        nfts = []
        for tid in sorted(ids):
            data = await self.read(wallet, tid)
            if data['active']: nfts.append({k:data[k] for k in ['tokenId','wallet','name','collection','originalAddress','chainId','image']})
        # A positive balance must not become an empty scan if logs/indexing failed.
        if not nfts: raise RuntimeError('Robot balance exists but owned NFTs could not be resolved')
        return {'nfts':nfts,'partial':False}
