"""Shared, persistent collection inventory and artwork cache. No wallet entitlements."""
import asyncio
import base64
import json
import time

from aiohttp import web
from robot_companion import CONTRACT, START_BLOCK, TRANSFER, token_id

ZERO = '0x' + '0' * 64
REFRESH_SECONDS = 60


class RobotGallery:
    def __init__(self, robots):
        self.robots, self.db = robots, robots.db
        self.lock = asyncio.Lock()
        self.retry_after = 0
        self.db.execute('CREATE TABLE IF NOT EXISTS robot_gallery_state(id INTEGER PRIMARY KEY, block INTEGER, checked REAL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS robot_gallery_events(block INTEGER, position INTEGER, token INTEGER, minted INTEGER, PRIMARY KEY(block,position))')
        self.db.execute('CREATE TABLE IF NOT EXISTS robot_gallery_art(token INTEGER PRIMARY KEY, metadata TEXT)')
        self.db.commit()

    async def inventory(self):
        state = self.db.execute('SELECT block,checked FROM robot_gallery_state WHERE id=1').fetchone()
        if state and 0 <= time.time() - state[1] < REFRESH_SECONDS:
            return state, False
        if state and time.time() < self.retry_after:
            return state, True
        try:
            if await self.robots.rpc('eth_chainId', []) != '0x2105':
                raise RuntimeError('Gallery RPC must be Base mainnet')
            head = int(await self.robots.rpc('eth_blockNumber', []), 16)
            # Replay the recent window so a short reorg cannot strand mint/burn entries.
            start = max(START_BLOCK, state[0] - 64) if state and state[0] <= head else START_BLOCK
            if head - start > 2_000_000:
                raise RuntimeError('Gallery needs an inventory checkpoint')
            events = []
            for block in range(start, head + 1, 2000):
                logs = await self.robots.rpc('eth_getLogs', [{'address': CONTRACT, 'fromBlock': hex(block),
                    'toBlock': hex(min(head, block + 1999)), 'topics': [TRANSFER]}])
                if not isinstance(logs, list):
                    raise RuntimeError('Invalid gallery transfer history')
                for log in logs:
                    topics = log.get('topics', [])
                    if (log.get('removed') or log.get('address', '').lower() != CONTRACT or len(topics) != 4
                            or topics[0].lower() != TRANSFER):
                        continue
                    if topics[1].lower() == ZERO or topics[2].lower() == ZERO:
                        events.append((int(log['blockNumber'], 16), int(log['logIndex'], 16),
                                       token_id(int(topics[3], 16)), int(topics[1].lower() == ZERO)))
            # Do not advance the checkpoint or mutate inventory until every range succeeded.
            with self.db:
                self.db.execute('DELETE FROM robot_gallery_events WHERE block>=?', (start,))
                self.db.executemany('INSERT OR REPLACE INTO robot_gallery_events VALUES(?,?,?,?)', events)
                self.db.execute('INSERT OR REPLACE INTO robot_gallery_state VALUES(1,?,?)', (head, time.time()))
            return self.db.execute('SELECT block,checked FROM robot_gallery_state WHERE id=1').fetchone(), False
        except Exception:
            self.retry_after = time.time() + REFRESH_SECONDS
            if not state:
                raise
            return state, True

    async def page(self, after=0):
        async with self.lock:
            state, stale = await self.inventory()
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
                    encoded = await self.robots.call('0xc87b56dd', tid, hex(state[0]))
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
                items.append({'tokenId': tid, 'metadata': metadata})
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
            data = await gallery.page(after)
            return web.json_response(data, headers={'Cache-Control': 'public, max-age=30' if not data['stale'] else 'no-cache'})
        except ValueError:
            return web.json_response({'error': 'Invalid gallery cursor'}, status=400)
        except Exception:
            return web.json_response({'error': 'Gallery refresh unavailable. Please retry shortly.'}, status=503)
    app.router.add_get('/api/robots/gallery', get_gallery)
