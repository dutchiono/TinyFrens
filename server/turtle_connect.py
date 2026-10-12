"""Phone-initiated wallet pairing and daily Hood Turtle ownership verification."""
import asyncio
import base64
import json
import os
import re
import secrets
import time

from aiohttp import ClientSession, ClientTimeout, web
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import to_checksum_address

COLLECTION = '0xca28587b61eac19a87dfcfd9420870867a916675'
CHAIN_ID = 4663
OWNERSHIP_TTL = 86400
PAIRING_TTL = 600
AGENT_PATHS = {'/api/turtle-connect/challenge', '/api/turtle-connect/confirm'}


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
                return json.loads(row[1])
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
            return result


def install(app, db, token_pet, limit, ownership):
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
        tid = turtle_id(body.get('tokenId'))
        challenge_id = secrets.token_urlsafe(32)
        message = (f'TinyFrens read-only phone pairing\nDomain: tinyfrens.lol\n'
                   f'Wallet: {address}\nCollection: {COLLECTION}\nChain ID: {CHAIN_ID}\n'
                   f'Token: {tid}\nPairing: {code}\nNonce: {challenge_id}\nExpires: {int(row[1])}\n\n'
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

    async def accept(body):
        pid = token_pet(body.get('token'))
        code, row = pairing(body)
        if row[0] != pid or not row[6]:
            raise ValueError('This device has no verified pairing to accept')
        # No await between consuming the pairing and assigning the signed address.
        with db:
            db.execute('DELETE FROM turtle_pairings WHERE code=?', (code,))
            db.execute('INSERT OR REPLACE INTO wallet_links VALUES(?,?,?)', (pid, row[3], int(time.time())))
            db.execute('DELETE FROM wallet_link_challenges WHERE pet_id=?', (pid,))
        return {'linked': True, 'address': row[3], 'tokenId': row[4]}

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

    for name, action in [('start', start), ('challenge', challenge), ('confirm', confirm), ('status', status), ('accept', accept)]:
        app.router.add_post('/api/turtle-connect/' + name, handler(action))
