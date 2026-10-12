import base64
import json
import os
import tempfile
import time
import unittest
from unittest import mock

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from eth_account import Account
from eth_account.messages import encode_defunct

from app import create_app

ORIGIN = 'https://tinyfrens.lol'


class TurtleConnectTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.account = Account.create()
        self.owner = self.account.address
        self.calls = 0
        self.unavailable = False
        self.malformed = False
        self.metadata = {'name': 'Hood Turtle #7', 'image': 'data:image/svg+xml;base64,' + base64.b64encode(b'<svg xmlns="http://www.w3.org/2000/svg"/>').decode()}
        uri = ('data:application/json;base64,' + base64.b64encode(json.dumps(self.metadata).encode()).decode()).encode()

        async def rpc(request):
            self.calls += 1
            if self.unavailable:
                return web.json_response({'error': {'code': -32000}}, status=503)
            body = await request.json()
            self.assertEqual(body['params'][0]['to'], '0xca28587b61eac19a87dfcfd9420870867a916675')
            if self.malformed:
                result = '0x1234'
            elif body['params'][0]['data'][:10] == '0x6352211e':
                result = '0x' + int(self.owner, 16).to_bytes(32, 'big').hex()
            else:
                result = '0x' + (32).to_bytes(32, 'big').hex() + len(uri).to_bytes(32, 'big').hex() + uri.hex()
            return web.json_response({'result': result})

        rpc_app = web.Application(); rpc_app.router.add_post('/', rpc)
        self.rpc = TestServer(rpc_app); await self.rpc.start_server()
        self.env = mock.patch.dict(os.environ, {'ROBINHOOD_RPC_URL': str(self.rpc.make_url('/'))})
        self.env.start()
        self.client = TestClient(TestServer(create_app(self.tmp.name + '/pets.db', [ORIGIN])))
        await self.client.start_server()
        self.phone = await self.register()
        self.other = await self.register()

    async def asyncTearDown(self):
        await self.client.close(); await self.rpc.close(); self.env.stop(); self.tmp.cleanup()

    async def register(self):
        response = await self.client.post('/api/register', headers={'Origin': ORIGIN},
                                          json={'pet': {'name': 'Turtle', 'shape': 'turtle', 'color': '#82eba1'}})
        self.assertEqual(response.status, 200)
        return await response.json()

    async def post(self, name, body, phone=None, agent=False):
        payload = dict(body)
        if not agent:
            payload['token'] = (phone or self.phone)['token']
        return await self.client.post('/api/turtle-connect/' + name, json=payload,
                                      headers={} if agent else {'Origin': ORIGIN})

    async def test_wallet_wide_pairing_does_not_require_a_token(self):
        response = await self.post('start', {})
        pairing = await response.json()
        response = await self.post('challenge', {'code': pairing['code'], 'address': self.account.address}, agent=True)
        self.assertEqual(response.status, 200)
        challenge = await response.json()
        signature = '0x' + self.account.sign_message(encode_defunct(text=challenge['message'])).signature.hex().removeprefix('0x')
        response = await self.post('confirm', {'code': pairing['code'], 'challengeId': challenge['challengeId'], 'signature': signature}, agent=True)
        self.assertEqual(response.status, 200)
        self.assertEqual(self.calls, 0)
        response = await self.post('accept', {'code': pairing['code']})
        data = await response.json()
        self.assertEqual(data['address'], self.account.address)
        self.assertIsNone(data['tokenId'])

    async def begin(self):
        response = await self.post('start', {})
        self.assertEqual(response.status, 200)
        pairing = await response.json()
        response = await self.post('challenge', {'code': pairing['code'], 'address': self.account.address, 'tokenId': 7}, agent=True)
        self.assertEqual(response.status, 200)
        challenge = await response.json()
        signature = '0x' + Account.sign_message(encode_defunct(text=challenge['message']), self.account.key).signature.hex().removeprefix('0x')
        return pairing, {'code': pairing['code'], 'challengeId': challenge['challengeId'], 'signature': signature}

    async def test_pairing_requires_signature_ownership_and_phone_acceptance(self):
        pairing, proof = await self.begin()
        response = await self.post('accept', {'code': pairing['code']})
        self.assertEqual(response.status, 400)
        wrong = dict(proof, signature='0x' + Account.sign_message(encode_defunct(text='other message'), self.account.key).signature.hex().removeprefix('0x'))
        response = await self.post('confirm', wrong, agent=True); self.assertEqual(response.status, 400)
        response = await self.post('confirm', proof, agent=True); self.assertEqual(response.status, 200)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertNotIn('token', await response.json())
        response = await self.post('confirm', proof, agent=True); self.assertEqual(response.status, 400)
        response = await self.post('status', {'code': pairing['code']}, phone=self.other); self.assertEqual(response.status, 400)
        response = await self.post('accept', {'code': pairing['code']}, phone=self.other); self.assertEqual(response.status, 400)
        response = await self.client.post('/api/wallet-link/status', headers={'Origin': ORIGIN}, json={'token': self.phone['token']})
        self.assertFalse((await response.json())['linked'])
        response = await self.post('accept', {'code': pairing['code']}); self.assertEqual(response.status, 200)
        self.assertEqual((await response.json())['address'], self.account.address)
        response = await self.post('accept', {'code': pairing['code']}); self.assertEqual(response.status, 400)
        response = await self.client.post('/api/featured/hood-turtle', headers={'Origin': ORIGIN}, json={'token': self.phone['token'], 'tokenId': 7})
        self.assertEqual((await response.json())['image'], self.metadata['image'])

    async def test_expiry_restart_nonce_and_no_owner_fail_closed(self):
        pairing, proof = await self.begin()
        with mock.patch('turtle_connect.time.time', return_value=pairing['expires'] + 1):
            response = await self.post('confirm', proof, agent=True); self.assertEqual(response.status, 400)
        response = await self.post('start', {}); self.assertEqual(response.status, 200)
        response = await self.post('confirm', proof, agent=True); self.assertEqual(response.status, 400)
        _, proof = await self.begin()
        self.owner = Account.create().address
        response = await self.post('confirm', proof, agent=True); self.assertEqual(response.status, 400)
        self.assertIn('does not currently own', (await response.json())['error'])

    async def test_daily_cache_transfer_unlink_and_rpc_failure(self):
        pairing, proof = await self.begin()
        self.assertEqual((await self.post('confirm', proof, agent=True)).status, 200)
        self.assertEqual((await self.post('accept', {'code': pairing['code']})).status, 200)
        async def featured():
            return await self.client.post('/api/featured/hood-turtle', headers={'Origin': ORIGIN},
                                          json={'token': self.phone['token'], 'tokenId': 7})
        response = await featured(); initial = await response.json(); calls = self.calls
        self.owner = Account.create().address
        response = await featured(); self.assertTrue((await response.json())['active']); self.assertEqual(self.calls, calls)
        with mock.patch('turtle_connect.time.time', return_value=initial['validUntil'] + 1):
            self.unavailable = True
            response = await featured(); self.assertEqual(response.status, 503)
            self.unavailable = False; self.malformed = True
            response = await featured(); self.assertEqual(response.status, 503)
            self.malformed = False
            response = await featured(); data = await response.json()
            self.assertFalse(data['active']); self.assertIsNone(data['image'])
        response = await self.client.post('/api/wallet-link/disconnect', headers={'Origin': ORIGIN}, json={'token': self.phone['token']})
        self.assertEqual(response.status, 200)
        response = await featured(); self.assertEqual(response.status, 403)

    async def test_agent_access_does_not_open_device_endpoints_or_bad_origins(self):
        response = await self.post('start', {}, agent=True); self.assertEqual(response.status, 403)
        response = await self.client.post('/api/turtle-connect/challenge', headers={'Origin': 'https://evil.example'}, json={})
        self.assertEqual(response.status, 403)
        response = await self.post('start', {}); self.assertEqual(response.status, 200)
        code = (await response.json())['code']
        for tid in [True, 1.2, 0, 2223]:
            response = await self.post('challenge', {'code': code, 'address': self.account.address, 'tokenId': tid}, agent=True)
            self.assertEqual(response.status, 400)

    async def test_public_preview_does_not_grant_display_and_disconnect_revokes_pending_pairing(self):
        response = await self.client.get('/api/hood-turtles/preview?tokenId=7')
        self.assertEqual(response.status, 200)
        data = await response.json()
        self.assertEqual(data['image'], self.metadata['image'])
        self.assertNotIn('active', data)
        self.assertNotIn('wallet', data)
        response = await self.client.post('/api/featured/hood-turtle', headers={'Origin': ORIGIN},
                                          json={'token': self.phone['token'], 'tokenId': 7})
        self.assertEqual(response.status, 403)
        pairing, proof = await self.begin()
        self.assertEqual((await self.post('confirm', proof, agent=True)).status, 200)
        response = await self.client.post('/api/wallet-link/disconnect', headers={'Origin': ORIGIN},
                                          json={'token': self.phone['token']})
        self.assertEqual(response.status, 200)
        self.assertEqual((await self.post('accept', {'code': pairing['code']})).status, 400)
