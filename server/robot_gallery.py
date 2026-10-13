"""Shared, persistent collection inventory and artwork cache. No wallet entitlements."""
import asyncio
import base64
import json
import time

from aiohttp import web
from robot_companion import CONTRACT, START_BLOCK, TRANSFER, token_id

ZERO = '0x' + '0' * 64
REFRESH_SECONDS = 600


class RobotGallery:
    def __init__(self, robots):
        self.robots, self.db = robots, robots.db
        self.lock = asyncio.Lock()
        self.db.execute('CREATE TABLE IF NOT EXISTS robot_gallery_owners(token INTEGER PRIMARY KEY, wallet TEXT)')
        self.retry_after = 0
        self.db.execute('CREATE TABLE IF NOT EXISTS robot_gallery_state(id INTEGER PRIMARY KEY, block INTEGER, checked REAL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS robot_gallery_events(block INTEGER, position INTEGER, token INTEGER, minted INTEGER, PRIMARY KEY(block,position))')
        self.db.execute('CREATE TABLE IF NOT EXISTS robot_gallery_art(token INTEGER PRIMARY KEY, metadata TEXT)')
        self.db.commit()

    async def inventory(self, force=False):
        state = self.db.execute('SELECT block,checked FROM robot_gallery_state WHERE id=1').fetchone()
        if state and not force and 0 <= time.time() - state[1] < REFRESH_SECONDS:
            return state, False
        if state and time.time() < self.retry_after:
            return state, True
        try:
            if await self.robots.rpc('eth_chainId', []) != '0x2105':
                raise RuntimeError('Gallery RPC must be Base mainnet')
            head = int(await self.robots.rpc('eth_blockNumber', []), 16)
            # Reuse current ownerOf batching; archive Transfer logs are unnecessary.
            supply_raw = await self.robots.rpc('eth_call', [{'to': CONTRACT, 'data': '0x18160ddd'}, 'latest'])
            supply = int(supply_raw, 16)
            if not 0 <= supply <= 2664:
                raise RuntimeError('Invalid robot supply')
            owners = {}
            for start in range(1, 2665, 20):
                if len(owners) >= supply:
                    break
                owners.update(await self.robots.owner_batch(range(start, min(start + 20, 2665))))
            if len(owners) != supply:
                raise RuntimeError('Gallery inventory does not match current supply')
            with self.db:
                self.db.execute('DELETE FROM robot_gallery_owners')
                self.db.executemany('INSERT INTO robot_gallery_owners VALUES(?,?)', [(int(tid), wallet) for tid, wallet in owners.items()])
                self.db.execute('DELETE FROM robot_gallery_events')
                self.db.executemany('INSERT INTO robot_gallery_events VALUES(?,?,?,1)',
                                    [(head, int(tid), int(tid)) for tid in owners])
                self.db.execute('INSERT OR REPLACE INTO robot_gallery_state VALUES(1,?,?)', (head, time.time()))
            return self.db.execute('SELECT block,checked FROM robot_gallery_state WHERE id=1').fetchone(), False
        except Exception:
            self.retry_after = time.time() + REFRESH_SECONDS
            if not state:
                raise
            return state, True

    async def page(self, after=0, force=False):
        async with self.lock:
            state, stale = await self.inventory(force)
            ids = set()
            for tid, minted in self.db.execute('SELECT token,minted FROM robot_gallery_events ORDER BY block,position'):
                if minted: ids.add(tid)
                else: ids.discard(tid)
            selected = [tid for tid in sorted(ids) if tid > after][:24]
            items = []
            for tid in selected:
                row = self.db.execute('SELECT metadata FROM robot_gallery_art WHERE token=?', (tid,)).fetchone()
                if row:
                    metadata = json.loads(row[0])
                else:
                    if stale:
                        raise RuntimeError('Artwork is not cached yet; Base is unavailable')
                    encoded = await self.robots.call('0xc87b56dd', tid, 'latest')
                    if encoded is None:
                        raise RuntimeError('Mint inventory and artwork disagree')
                    raw = bytes.fromhex(encoded[2:])
                    length = int.from_bytes(raw[32:64], 'big')
                    if int.from_bytes(raw[:32], 'big') != 32 or not 0 < length <= 100_000 or 64 + length > len(raw):
                        raise RuntimeError('Invalid gallery metadata response')
                    uri = raw[64:64 + length].decode()
                    if not uri.startswith('data:application/json;base64,'):
                        raise RuntimeError('Unexpected gallery metadata format')
                    metadata = json.loads(base64.b64decode(uri.split(',', 1)[1], validate=True))
                    if not isinstance(metadata, dict) or not str(metadata.get('image', '')).startswith('data:image/svg+xml;base64,'):
                        raise RuntimeError('Unexpected gallery artwork format')
                    with self.db:
                        self.db.execute('INSERT OR REPLACE INTO robot_gallery_art VALUES(?,?)', (tid, json.dumps(metadata)))
                owner = self.db.execute('SELECT wallet FROM robot_gallery_owners WHERE token=?', (tid,)).fetchone()
                items.append({'tokenId': tid, 'metadata': metadata, 'owner': owner[0] if owner else None})
            last = selected[-1] if selected else after
            return {'contract': CONTRACT, 'chainId': 8453, 'supply': len(ids), 'items': items,
                    'nextAfter': last if any(tid > last for tid in ids) else None,
                    'checkedAt': state[1], 'stale': stale}


def install(app, robots):
    gallery = RobotGallery(robots)
    async def get_gallery(request):
        try:
            after = int(request.query.get('after', '0'))
            if not 0 <= after <= 2664: raise ValueError('Invalid gallery cursor')
            force = request.query.get("refresh") == "1"
            data = await gallery.page(after, force)
            return web.json_response(data, headers={'Cache-Control': 'public, max-age=30' if not data['stale'] and not force else 'no-store'})
        except ValueError:
            return web.json_response({'error': 'Invalid gallery cursor'}, status=400)
        except Exception:
            return web.json_response({'error': 'Gallery refresh unavailable. Please retry shortly.'}, status=503)
    app.router.add_get('/api/robots/gallery', get_gallery)
