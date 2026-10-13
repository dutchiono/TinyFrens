"""Phone-initiated wallet pairing and daily Hood Turtle ownership verification."""
import asyncio
import base64
import json
import os
import re
import secrets
import time
from urllib.parse import urlencode

from aiohttp import ClientSession, ClientTimeout, web
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import to_checksum_address
from hood_turtle_art import with_companion

COLLECTION = '0xca28587b61eac19a87dfcfd9420870867a916675'
CHAIN_ID = 4663
OWNERSHIP_TTL = 86400
TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
PAIRING_TTL = 600
AGENT_PATHS = {'/api/turtle-connect/challenge', '/api/turtle-connect/confirm'}


def migrate_wallet_links(db):
    """Preserve the old single link while changing the key to device + address."""
    columns = db.execute('PRAGMA table_info(wallet_links)').fetchall()
    if any(row[1] == 'address' and row[5] for row in columns):
        return
    with db:
        db.execute('CREATE TABLE wallet_links_next(pet_id TEXT, address TEXT COLLATE NOCASE NOT NULL, '
                   'created INTEGER NOT NULL, PRIMARY KEY(pet_id,address))')
        db.execute('INSERT INTO wallet_links_next SELECT pet_id,address,created FROM wallet_links')
        db.execute('DROP TABLE wallet_links')
        db.execute('ALTER TABLE wallet_links_next RENAME TO wallet_links')


def linked_wallets(db, pid):
    return [row[0] for row in db.execute('SELECT address FROM wallet_links WHERE pet_id=? ORDER BY created,address', (pid,))]


def wallet_devices(db, pid):
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='device_sync_members'").fetchone():
        return [pid]
    row = db.execute('SELECT account FROM device_sync_members WHERE device=?', (pid,)).fetchone()
    return [r[0] for r in db.execute('SELECT device FROM device_sync_members WHERE account=?', (row[0],))] if row else [pid]


def add_wallet(db, pid, address):
    addresses = linked_wallets(db, pid)
    if address.lower() not in [a.lower() for a in addresses] and len(addresses) >= 10:
        raise ValueError('Up to 10 wallets can be linked. Remove one first.')
    for device in wallet_devices(db, pid):
        db.execute('INSERT OR IGNORE INTO wallet_links VALUES(?,?,?)', (device, to_checksum_address(address), int(time.time())))


def remove_wallet(db, pid, address=None):
    for device in wallet_devices(db, pid):
        if address is None:
            db.execute('DELETE FROM wallet_links WHERE pet_id=?', (device,))
        else:
            db.execute('DELETE FROM wallet_links WHERE pet_id=? AND address=? COLLATE NOCASE', (device, to_checksum_address(address)))
        db.execute('DELETE FROM turtle_pairings WHERE pet_id=?', (device,))
        db.execute('DELETE FROM wallet_link_challenges WHERE pet_id=?', (device,))
        if db.execute("SELECT 1 FROM sqlite_master WHERE name='device_sync_codes'").fetchone():
            db.execute('DELETE FROM device_sync_codes WHERE device=? OR requester=?', (device, device))


async def rpc_candidates(address):
    """Indexer-independent discovery: incoming Transfer logs, then ownerOf verification.

    Scan the entire chain in bounded ranges; never treat a failed range as empty.
    """
    rpc = os.environ.get('ROBINHOOD_RPC_URL', 'https://rpc.mainnet.chain.robinhood.com')
    async with ClientSession(timeout=ClientTimeout(total=20)) as session:
        async def call(method, params):
            async with session.post(rpc, json={'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}) as response:
                response.raise_for_status()
                body = await response.json(content_type=None)
            if body.get('error') or 'result' not in body:
                raise RuntimeError('On-chain NFT discovery unavailable')
            return body['result']
        raw = await call('eth_call', [{'to': COLLECTION, 'data': '0x70a08231' + address[2:].lower().zfill(64)}, 'latest'])
        if not isinstance(raw, str) or not re.fullmatch(r'0x[0-9a-fA-F]{64}', raw):
            raise RuntimeError('Invalid collection balance')
        balance = int(raw, 16)
        if balance == 0:
            return set(), False
        head = int(await call('eth_blockNumber', []), 16)
        if head > 200_000_000:
            raise RuntimeError('NFT discovery range exceeds configured budget')
        candidates = set()
        for start in range(0, head + 1, 10_000_000):
            logs = await call('eth_getLogs', [{'address': COLLECTION, 'fromBlock': hex(start),
                'toBlock': hex(min(head, start + 9_999_999)),
                'topics': [TRANSFER_TOPIC, None, '0x' + address[2:].lower().zfill(64)]}])
            if not isinstance(logs, list):
                raise RuntimeError('Invalid collection transfer logs')
            for log in logs:
                topics = log.get('topics', [])
                if (log.get('removed') or len(topics) != 4 or topics[0].lower() != TRANSFER_TOPIC
                        or str(log.get('address', '')).lower() != COLLECTION
                        or topics[2].lower() != '0x' + address[2:].lower().zfill(64)):
                    continue
                candidates.add(turtle_id(int(topics[3], 16)))
        if not candidates:
            raise RuntimeError('Collection balance exists but transfer history is missing')
        return candidates, len(candidates) > 50


async def discover_wallets(addresses, ownership):
    """Discover all linked wallets; cache only successful ownership verification."""
    semaphore = asyncio.Semaphore(5)
    async def discover(address):
        root = os.environ.get('ROBINHOOD_BLOCKSCOUT_API_URL', 'https://robinhoodchain.blockscout.com/api/v2').rstrip('/')
        candidates, partial, params = set(), False, {'type': 'ERC-721'}
        async def indexer_candidates():
            nonlocal partial, params
            async with ClientSession(timeout=ClientTimeout(total=15)) as session:
                for page in range(5):
                    async with session.get(root + '/addresses/' + address + '/nft?' + urlencode(params)) as response:
                        response.raise_for_status()
                        data = await response.json(content_type=None)
                    if not isinstance(data.get('items'), list):
                        raise ValueError('NFT indexer returned invalid data')
                    for item in data['items']:
                        if str((item.get('token') or {}).get('address_hash', '')).lower() == COLLECTION:
                            try:
                                candidates.add(turtle_id(item.get('id')))
                            except ValueError:
                                continue
                    next_page = data.get('next_page_params')
                    if not next_page:
                        break
                    if page == 4:
                        partial = True
                    params = {'type': 'ERC-721', **next_page}
        try:
            await indexer_candidates()
            if not candidates:
                candidates, partial = await rpc_candidates(address)
        except Exception:
            candidates, partial = await rpc_candidates(address)
        async def verify(tid):
            cached = ownership.db.execute('SELECT checked,payload FROM turtle_ownership WHERE wallet=? AND token_id=?', (address, tid)).fetchone()
            if cached and cached[0] <= time.time() < cached[0] + OWNERSHIP_TTL:
                result = json.loads(cached[1])
                active, name = result['active'], result['name']
            else:
                rpc = os.environ.get('ROBINHOOD_RPC_URL', 'https://rpc.mainnet.chain.robinhood.com')
                async with semaphore, ClientSession(timeout=ClientTimeout(total=12)) as session:
                    payload = {'jsonrpc': '2.0', 'id': 1, 'method': 'eth_call',
                               'params': [{'to': COLLECTION, 'data': '0x6352211e' + format(tid, '064x')}, 'latest']}
                    async with session.post(rpc, json=payload) as response:
                        response.raise_for_status()
                        result = await response.json(content_type=None)
                raw = result.get('result', '')
                # Incoming history can include NFTs that were later burned.
                if result.get('error', {}).get('code') == 3:
                    return None
                if result.get('error') or not re.fullmatch(r'0x0{24}[0-9a-fA-F]{40}', raw):
                    raise RuntimeError('On-chain ownership check unavailable')
                active = raw[-40:].lower() == address[2:].lower()
                name = f'Hood Turtle #{tid}'
            if not active:
                return None
            return {'tokenId': tid, 'name': name, 'wallet': address,
                    'collection': 'Hood Turtles', 'originalAddress': COLLECTION, 'chainId': CHAIN_ID}
        nfts = await asyncio.gather(*(verify(tid) for tid in sorted(candidates)[:50]))
        return {'nfts': [nft for nft in nfts if nft], 'partial': partial or len(candidates) > 50}
    results = await asyncio.gather(*(discover(address) for address in addresses), return_exceptions=True)
    successes = [result for result in results if isinstance(result, dict)]
    if not successes:
        raise RuntimeError('NFT discovery is temporarily unavailable')
    nfts = {}
    for result in successes:
        for nft in result['nfts']:
            nfts.setdefault((nft['chainId'], nft['originalAddress'], nft['tokenId']), nft)
    return {'nfts': list(nfts.values()), 'partial': len(successes) != len(results) or any(r['partial'] for r in successes)}


def turtle_id(value):
    if isinstance(value, bool) or not re.fullmatch(r'[0-9]{1,4}', str(value)):
        raise ValueError('Enter a Hood Turtle token number from 1 to 2222')
    value = int(value)
    if not 1 <= value <= 2222:
        raise ValueError('Enter a Hood Turtle token number from 1 to 2222')
    return value


class TurtleOwnership:
    def __init__(self, db):
        self.db = db
        self.lock = asyncio.Lock()
        db.execute('''CREATE TABLE IF NOT EXISTS turtle_ownership(
            wallet TEXT, token_id INTEGER, checked REAL, payload TEXT,
            PRIMARY KEY(wallet,token_id))''')
        db.commit()

    async def read(self, wallet, token_id, force=False):
        token_id = turtle_id(token_id)
        wallet = to_checksum_address(wallet) if wallet is not None else None
        async with self.lock:
            row = self.db.execute('SELECT checked,payload FROM turtle_ownership WHERE wallet=? AND token_id=?',
                                  (wallet, token_id)).fetchone()
            if not force and row and row[0] <= time.time() < row[0] + OWNERSHIP_TTL:
                return with_companion(json.loads(row[1]))
            rpc = os.environ.get('ROBINHOOD_RPC_URL', 'https://rpc.mainnet.chain.robinhood.com')
            async with ClientSession(timeout=ClientTimeout(total=15)) as session:
                async def call(selector):
                    payload = {'jsonrpc': '2.0', 'id': 1, 'method': 'eth_call',
                               'params': [{'to': COLLECTION, 'data': selector + format(token_id, '064x')}, 'latest']}
                    async with session.post(rpc, json=payload) as response:
                        response.raise_for_status()
                        result = await response.json(content_type=None)
                    raw = result.get('result', '')
                    if result.get('error') or not re.fullmatch(r'0x[0-9a-fA-F]+', raw):
                        raise RuntimeError('Robinhood Chain could not verify the turtle')
                    return bytes.fromhex(raw[2:])

                owner_raw = await call('0x6352211e')
                if len(owner_raw) != 32 or any(owner_raw[:12]) or not any(owner_raw):
                    raise RuntimeError('Invalid ownership response')
                owner = to_checksum_address('0x' + owner_raw[-20:].hex())
                active = wallet is None or owner == wallet
                metadata = {}
                if active:
                    raw = await call('0xc87b56dd')
                    offset = int.from_bytes(raw[:32], 'big')
                    length = int.from_bytes(raw[offset:offset + 32], 'big')
                    if offset != 32 or not length or offset + 32 + length > len(raw):
                        raise RuntimeError('Invalid turtle metadata response')
                    uri = raw[offset + 32:offset + 32 + length].decode('utf-8')
                    if uri.startswith('data:application/json;base64,'):
                        metadata = json.loads(base64.b64decode(uri.split(',', 1)[1], validate=True))
                    if not isinstance(metadata, dict):
                        raise RuntimeError('Invalid turtle metadata')
            checked = time.time()
            result = {'tokenId': token_id, 'wallet': wallet, 'originalOwner': owner,
                      'active': active, 'image': metadata.get('image') if active else None,
                      'name': str(metadata.get('name', f'Hood Turtle #{token_id}'))[:80],
                      'originalAddress': COLLECTION, 'chainId': CHAIN_ID,
                      'checkedAt': checked, 'validUntil': checked + OWNERSHIP_TTL}
            # Do not cache absence: a newly purchased turtle should work immediately.
            self.db.execute('DELETE FROM turtle_ownership WHERE wallet=? AND token_id=?', (wallet, token_id))
            if active and wallet is not None:
                self.db.execute('INSERT INTO turtle_ownership VALUES(?,?,?,?)',
                                (wallet, token_id, checked, json.dumps(result)))
            self.db.commit()
            return with_companion(result)


def install(app, db, token_pet, limit, ownership):
    migrate_wallet_links(db)
    db.execute('''CREATE TABLE IF NOT EXISTS turtle_pairings(
        code TEXT PRIMARY KEY, pet_id TEXT UNIQUE, expires REAL, challenge_id TEXT,
        address TEXT, token_id INTEGER, message TEXT, verified INTEGER DEFAULT 0)''')
    db.commit()

    def pairing(body):
        code = str(body.get('code', '')).replace('-', '').upper()
        row = db.execute('SELECT pet_id,expires,challenge_id,address,token_id,message,verified '
                         'FROM turtle_pairings WHERE code=?', (code,)).fetchone()
        if not row or row[1] <= time.time():
            raise ValueError('Pairing expired or not found. Start again on your phone.')
        return code, row

    async def start(body):
        pid = token_pet(body.get('token'))
        limit(('turtle-pair-start', pid), 10, 3600)
        db.execute('DELETE FROM turtle_pairings WHERE expires<=? OR pet_id=?', (time.time(), pid))
        while True:
            code = ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(12))
            if not db.execute('SELECT 1 FROM turtle_pairings WHERE code=?', (code,)).fetchone():
                break
        expires = time.time() + PAIRING_TTL
        db.execute('INSERT INTO turtle_pairings(code,pet_id,expires) VALUES(?,?,?)', (code, pid, expires))
        db.commit()
        return {'code': code, 'expires': expires}

    async def challenge(body):
        code, row = pairing(body)
        if row[6] or row[2]:
            raise ValueError('Pairing already has a wallet request. Start again on your phone.')
        address = str(body.get('address', ''))
        if not re.fullmatch(r'0x[0-9a-fA-F]{40}', address):
            raise ValueError('Valid Ethereum wallet address required')
        address = to_checksum_address(address)
        tid = turtle_id(body['tokenId']) if body.get('tokenId') is not None else None
        challenge_id = secrets.token_urlsafe(32)
        scope = str(tid) if tid is not None else 'All supported collections'
        message = (f'TinyFrens read-only phone pairing\nDomain: tinyfrens.lol\n'
                   f'Wallet: {address}\nCollection: {COLLECTION}\nChain ID: {CHAIN_ID}\n'
                   f'Token: {scope}\nPairing: {code}\nNonce: {challenge_id}\nExpires: {int(row[1])}\n\n'
                   'Connect this wallet to the waiting TinyFrens device only after it accepts. '
                   'This does not authorize transactions, transfers, approvals, or spending.')
        db.execute('UPDATE turtle_pairings SET challenge_id=?,address=?,token_id=?,message=? WHERE code=?',
                   (challenge_id, address, tid, message, code))
        db.commit()
        return {'challengeId': challenge_id, 'message': message, 'expires': row[1]}

    async def confirm(body):
        code, row = pairing(body)
        if row[6] or not row[2] or body.get('challengeId') != row[2]:
            raise ValueError('Wallet request is missing or already used')
        signature = body.get('signature', '')
        if not isinstance(signature, str) or not re.fullmatch(r'0x[0-9a-fA-F]{130}', signature):
            raise ValueError('Valid personal_sign signature required')
        try:
            signer = Account.recover_message(encode_defunct(text=row[5]), signature=signature)
        except Exception:
            raise ValueError('Signature could not be verified') from None
        if signer.lower() != row[3].lower():
            raise ValueError('Signature does not match the selected wallet')
        if row[4] is not None:
            data = await ownership.read(row[3], row[4], force=True)
            if not data['active']:
                raise ValueError('This wallet does not currently own that Hood Turtle')
        changed = db.execute('UPDATE turtle_pairings SET verified=1 WHERE code=? AND challenge_id=? '
                             'AND verified=0 AND expires>?', (code, row[2], time.time())).rowcount
        db.commit()
        if not changed:
            raise ValueError('Pairing expired or already used')
        return {'verified': True, 'wallet': row[3], 'tokenId': row[4],
                'next': 'Return to the waiting phone and accept the wallet and turtle.'}

    async def status(body):
        pid = token_pet(body.get('token'))
        _, row = pairing(body)
        if row[0] != pid:
            raise ValueError('Pairing belongs to a different device')
        return {'verified': bool(row[6]), 'wallet': row[3] if row[6] else None,
                'tokenId': row[4] if row[6] else None, 'expires': row[1]}

    async def from_device(body):
        source = token_pet(body.get('token'))
        code, row = pairing(body)
        if row[0] == source or row[6] or row[2]:
            raise ValueError('Use a fresh code from the other device')
        address = str(body.get('address', ''))
        if address.lower() not in [a.lower() for a in linked_wallets(db, source)]:
            raise ValueError('This wallet is not linked to the approving device')
        with db:
            db.execute('UPDATE turtle_pairings SET address=?,verified=1 WHERE code=?',
                       (to_checksum_address(address), code))
        return {'verified': True, 'wallet': to_checksum_address(address)}

    async def accept(body):
        pid = token_pet(body.get('token'))
        code, row = pairing(body)
        if row[0] != pid or not row[6]:
            raise ValueError('This device has no verified pairing to accept')
        # No await between consuming the pairing and assigning the signed address.
        with db:
            add_wallet(db, pid, row[3])
            db.execute('DELETE FROM turtle_pairings WHERE code=?', (code,))
            db.execute('DELETE FROM wallet_link_challenges WHERE pet_id=?', (pid,))
        return {'linked': True, 'address': row[3], 'addresses': linked_wallets(db, pid), 'tokenId': row[4]}

    def handler(action):
        async def handle(request):
            try:
                ip = request.headers.get('X-Forwarded-For', request.remote or '?') if os.environ.get('TRUST_PROXY') == 'true' else request.remote or '?'
                limit(('turtle-connect', action.__name__, ip), 120 if action == status else 20, 60)
                body = await request.json()
                if not isinstance(body, dict):
                    raise ValueError('JSON object required')
                result = await action(body)
                return web.json_response(result, headers={'Cache-Control': 'no-store'})
            except (ValueError, TypeError, KeyError) as exc:
                return web.json_response({'error': str(exc)}, status=400, headers={'Cache-Control': 'no-store'})
            except Exception:
                return web.json_response({'error': 'Turtle verification unavailable. Please try again.'}, status=503,
                                         headers={'Cache-Control': 'no-store'})
        return handle

    for name, action in [('start', start), ('challenge', challenge), ('confirm', confirm), ('status', status), ('accept', accept), ('from-device', from_device)]:
        app.router.add_post('/api/turtle-connect/' + name, handler(action))
