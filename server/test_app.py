import asyncio, os, tempfile, unittest
from unittest import mock
from aiohttp.test_utils import TestClient, TestServer
from app import create_app

ORIGIN='https://tinyfrens.lol'
class RelayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.db=self.tmp.name+'/pets.db'
        self.client=TestClient(TestServer(create_app(self.db,[ORIGIN])))
        await self.client.start_server();self.sockets=[]
    async def asyncTearDown(self):
        for ws in self.sockets: await ws.close()
        await self.client.close();self.tmp.cleanup()
    async def register(self,name):
        r=await self.client.post('/api/register',headers={'Origin':ORIGIN},json={'pet':{'name':name,'shape':'robot','color':'#a474f1'}})
        self.assertEqual(r.status,200);return await r.json()
    async def connect(self,identity):
        ws=await self.client.ws_connect('/ws',headers={'Origin':ORIGIN});self.sockets.append(ws)
        await ws.send_json({'type':'auth','token':identity['token']});await self.event(ws,'state');return ws
    async def event(self,ws,typ):
        for _ in range(20):
            data=await asyncio.wait_for(ws.receive_json(),2)
            if data['type']==typ:return data
        self.fail('Missing '+typ)
    async def friends(self,a,b,wa,wb):
        await wa.send_json({'type':'friend-request','code':b['code']})
        state=await self.event(wb,'state');self.assertEqual(state['requests'][0]['id'],a['id'])
        await wb.send_json({'type':'friend-answer','id':a['id'],'accept':True})
        state=await self.event(wb,'state');self.assertEqual(state['friends'][0]['id'],a['id']);await self.event(wa,'state')
    async def test_consent_live_profile_actions_and_goodbye(self):
        a=await self.register('Beep');b=await self.register('Boop');c=await self.register('Stranger')
        wa=await self.connect(a);wb=await self.connect(b);wc=await self.connect(c)
        await wa.send_json({'type':'visit-request','id':b['id']});await self.event(wa,'error')
        await self.friends(a,b,wa,wb)
        await wa.send_json({'type':'visit-request','id':b['id']});invite=await self.event(wb,'visit-request')
        await wc.send_json({'type':'visit-answer','id':invite['id'],'accept':True});await self.event(wc,'error')
        await wb.send_json({'type':'visit-answer','id':invite['id'],'accept':True})
        host=await self.event(wb,'visit-start');await self.event(wa,'visit-start');self.assertEqual(host['pet']['name'],'Beep')
        await wc.send_json({'type':'visit-end','id':invite['id']});await self.event(wc,'error')
        await wa.send_json({'type':'profile','pet':{'name':'New Beep','shape':'blob','color':'#123456'}})
        updated=await self.event(wb,'visit-profile');self.assertEqual(updated['pet']['shape'],'blob')
        await wb.send_json({'type':'visit-action','id':invite['id'],'action':'dance'})
        self.assertEqual((await self.event(wa,'visit-action'))['action'],'dance');await self.event(wb,'visit-action')
        await wb.send_json({'type':'visit-end','id':invite['id']});await self.event(wa,'visit-ended');await self.event(wb,'visit-ended')
    async def test_decline_disconnect_and_remove(self):
        a=await self.register('A');b=await self.register('B');wa=await self.connect(a);wb=await self.connect(b)
        await self.friends(a,b,wa,wb)
        await wa.send_json({'type':'visit-request','id':b['id']});v=await self.event(wb,'visit-request')
        await wb.send_json({'type':'visit-answer','id':v['id'],'accept':False});await self.event(wa,'notice')
        await wa.send_json({'type':'visit-request','id':b['id']});v=await self.event(wb,'visit-request')
        await wb.send_json({'type':'visit-answer','id':v['id'],'accept':True});await self.event(wa,'visit-start');await self.event(wb,'visit-start')
        await wa.close();await self.event(wb,'visit-ended');await self.event(wb,'state')
        await wb.send_json({'type':'friend-remove','id':a['id']});self.assertEqual((await self.event(wb,'state'))['friends'],[])
    async def test_origin_auth_and_invalid_profile(self):
        r=await self.client.post('/api/register',headers={'Origin':'https://bad.example'},json={});self.assertEqual(r.status,403)
        r=await self.client.post('/api/register',headers={'Origin':ORIGIN},json={'pet':{'name':'A','shape':'unsafe','color':'no'}});self.assertEqual(r.status,400)
        ws=await self.client.ws_connect('/ws',headers={'Origin':ORIGIN});await ws.send_json({'type':'auth','token':'invalid'});await ws.receive();self.assertEqual(ws.close_code,4003)
    async def test_chat_requires_configured_model_key(self):
        saved={k:os.environ.pop(k,None) for k in ('GEMINI_API_KEY','GOOGLE_API_KEY')}
        try:
            r=await self.client.post('/api/chat',headers={'Origin':ORIGIN},json={'message':'hi','pet':{'name':'Beep','shape':'robot','color':'#a474f1'}})
            self.assertEqual(r.status,503)
            self.assertEqual((await r.json())['error'],'Pet chat is not connected yet')
        finally:
            for key,value in saved.items():
                if value is not None: os.environ[key]=value
    async def test_bankr_requires_configured_api_key(self):
        old=os.environ.pop('BANKR_API_KEY',None)
        old_partner=os.environ.pop('BANKR_PARTNER_KEY',None)
        try:
            r=await self.client.get('/api/bankr/status',headers={'Origin':ORIGIN})
            self.assertEqual(r.status,200)
            self.assertFalse((await r.json())['connected'])
            r=await self.client.post('/api/bankr/monitor',headers={'Origin':ORIGIN},json={'wallet':'0x1234','question':'how is it','pet':{'name':'Beep','shape':'robot','color':'#a474f1'}})
            self.assertEqual(r.status,503)
            self.assertEqual((await r.json())['error'],'Bankr is not connected yet')
            a=await self.register('Walletless')
            r=await self.client.post('/api/bankr/wallet',headers={'Origin':ORIGIN},json={'token':a['token'],'pet':{'name':'Walletless','shape':'robot','color':'#a474f1'}})
            self.assertEqual(r.status,200)
            data=await r.json()
            self.assertEqual(data['mode'],'fren-vault')
            self.assertTrue(data['evmAddress'].startswith('0x'))
        finally:
            if old is not None: os.environ['BANKR_API_KEY']=old
            if old_partner is not None: os.environ['BANKR_PARTNER_KEY']=old_partner
    async def test_bankr_transform_stores_nft_traits_without_bankr_call(self):
        a=await self.register('NFT Pet')
        nft={'name':'TinyFren #42','tokenId':'42','chain':'base','collection':{'name':'TinyFrens','address':'0x1234567890abcdef1234567890abcdef12345678'}}
        r=await self.client.post('/api/bankr/transform',headers={'Origin':ORIGIN},json={'token':a['token'],'nft':nft})
        self.assertEqual(r.status,200)
        data=await r.json()
        self.assertEqual(data['pet']['name'],'TinyFren #42')
        self.assertIn(data['pet']['shape'],['cat','blob','robot','bunny','dog','bear','frog','turtle'])
        self.assertRegex(data['pet']['color'],r'^#[0-9a-f]{6}$')
        ws=await self.client.ws_connect('/ws',headers={'Origin':ORIGIN});self.sockets.append(ws)
        await ws.send_json({'type':'auth','token':a['token']})
        state=await self.event(ws,'state')
        self.assertEqual(state['self']['pet']['name'],'TinyFren #42')
    async def test_party_rooms_share_live_pet_profiles(self):
        a=await self.register('Party A');b=await self.register('Party B')
        wa=await self.connect(a);wb=await self.connect(b)
        await wa.send_json({'type':'party-join','room':'public','pet':{'name':'Party A','shape':'cat','color':'#a474f1'}})
        state=await self.event(wa,'party-state');self.assertEqual(state['room'],'public');self.assertEqual(len(state['members']),1)
        await wb.send_json({'type':'party-join','room':'public','pet':{'name':'Party B','shape':'robot','color':'#7edbc4'}})
        state_a=await self.event(wa,'party-state');state_b=await self.event(wb,'party-state')
        self.assertEqual(len(state_a['members']),2);self.assertEqual(len(state_b['members']),2)
        await wa.send_json({'type':'profile','pet':{'name':'Party A2','shape':'bunny','color':'#ff99aa'}})
        updated=await self.event(wa,'party-state')
        self.assertIn('Party A2',[m['pet']['name'] for m in updated['members']])
        await self.event(wb,'party-state')
        await wb.send_json({'type':'party-join','room':'private','code':'MILADY','pet':{'name':'Party B','shape':'robot','color':'#7edbc4'}})
        private=await self.event(wb,'party-state');self.assertEqual(private['room'],'private');self.assertEqual(private['code'],'MILADY');self.assertEqual(len(private['members']),1)
        public=await self.event(wa,'party-state');self.assertEqual(len(public['members']),1)
        await wb.send_json({'type':'party-leave'})
        left=await self.event(wb,'party-state');self.assertEqual(left['room'],'none');self.assertEqual(left['members'],[])
    async def test_device_identity_survives_restart(self):
        a=await self.register('Permanent');await self.client.close()
        self.client=TestClient(TestServer(create_app(self.db,[ORIGIN])));await self.client.start_server()
        ws=await self.connect(a);await ws.send_json({'type':'profile','pet':{'name':'Renamed','shape':'cat','color':'#abcdef'}})
        await ws.close();ws=await self.connect(a)
        # Code lookup remains owned by the same stored credential after rename/restart.
        await ws.close();ws=await self.client.ws_connect('/ws',headers={'Origin':ORIGIN});self.sockets.append(ws)
        await ws.send_json({'type':'auth','token':a['token']});state=await self.event(ws,'state')
        self.assertEqual(state['self']['code'],a['code']);self.assertEqual(state['self']['pet']['name'],'Renamed')
    async def test_farcaster_manifest_returns_json_and_cors(self):
        r=await self.client.get('/.well-known/farcaster.json')
        self.assertEqual(r.status,200)
        self.assertEqual(r.headers.get('Access-Control-Allow-Origin'),'*')
        data=await r.json()
        self.assertIn('frame',data)
        self.assertEqual(data['frame']['name'],'TinyFrens')
        self.assertEqual(data['frame']['version'],'1')
    async def test_farcaster_snap_endpoints_and_content_negotiation(self):
        r=await self.client.get('/api/snap')
        self.assertEqual(r.status,200)
        self.assertIn('application/vnd.farcaster.snap+json',r.headers.get('Content-Type',''))
        data=await r.json()
        self.assertEqual(data['version'],'2.0')
        self.assertEqual(data['ui']['root'],'page')
        self.assertIn('btn-pet',data['ui']['elements'])

        # Interactive POST with action
        r2=await self.client.post('/api/snap/interact?action=pet')
        self.assertEqual(r2.status,200)
        data2=await r2.json()
        self.assertEqual(data2['version'],'2.0')
        self.assertIn('confetti',data2.get('effects',[]))

        # Content negotiation on /snap
        r3=await self.client.get('/snap',headers={'Accept':'application/vnd.farcaster.snap+json'})
        self.assertEqual(r3.status,200)
        data3=await r3.json()
        self.assertEqual(data3['version'],'2.0')
    async def test_economy_status_off_by_default(self):
        saved={k:os.environ.get(k) for k in ('ECONOMY_MODE','FRENS_TOKEN','CHAIN_ID')}
        for key in saved: os.environ.pop(key,None)
        try:
            r=await self.client.get('/api/economy/status',headers={'Origin':ORIGIN})
            self.assertEqual(r.status,200)
            data=await r.json()
            self.assertFalse(data['enabled'])
            self.assertIsNone(data['mode'])
            self.assertEqual(data['productionToken'].lower(),'0x1a96226727a1d0a46334b3a4b3878b32b7659ba3')
        finally:
            for key,value in saved.items():
                if value is None: os.environ.pop(key,None)
                else: os.environ[key]=value
    async def test_economy_status_testnet_when_configured(self):
        saved={k:os.environ.get(k) for k in ('ECONOMY_MODE','FRENS_TOKEN','CHAIN_ID')}
        os.environ['ECONOMY_MODE']='testnet'
        os.environ['FRENS_TOKEN']='0x'+'ab'*20
        os.environ['CHAIN_ID']='84532'
        try:
            r=await self.client.get('/api/economy/status',headers={'Origin':ORIGIN})
            data=await r.json()
            self.assertTrue(data['enabled'])
            self.assertEqual(data['mode'],'testnet')
            self.assertEqual(data['chainId'],84532)
        finally:
            for key,value in saved.items():
                if value is None: os.environ.pop(key,None)
                else: os.environ[key]=value
    async def test_economy_status_production_token_never_enables_server(self):
        saved=os.environ.get('ECONOMY_MODE')
        os.environ['ECONOMY_MODE']='production'
        try:
            r=await self.client.get('/api/economy/status',headers={'Origin':ORIGIN})
            data=await r.json()
            self.assertFalse(data['enabled'])
            self.assertEqual(data['mode'],'production')
            self.assertEqual(data['frensToken'].lower(),'0x1a96226727a1d0a46334b3a4b3878b32b7659ba3')
            self.assertIn('testnet',data.get('note','').lower())
        finally:
            if saved is None: os.environ.pop('ECONOMY_MODE',None)
            else: os.environ['ECONOMY_MODE']=saved
    async def test_farcaster_webhook_and_notify_status(self):
        r_hook=await self.client.post('/api/farcaster/webhook',json={'event':'frame_added'})
        self.assertEqual(r_hook.status,200)
        self.assertTrue((await r_hook.json()).get('received'))

        # Notify without NEYNAR_API_KEY returns 503
        saved_key=os.environ.pop('NEYNAR_API_KEY',None)
        try:
            r_notify=await self.client.post('/api/farcaster/notify',json={'title':'Hungry!','body':'Feed your fren'})
            self.assertEqual(r_notify.status,503)
        finally:
            if saved_key is not None: os.environ['NEYNAR_API_KEY']=saved_key
    async def test_farcaster_cast_endpoint_validation(self):
        saved_key=os.environ.pop('NEYNAR_API_KEY',None)
        saved_signer=os.environ.pop('FARCASTER_SIGNER_UUID',None)
        try:
            # Without API key -> 503
            r=await self.client.post('/api/farcaster/cast',json={'text':'gm'})
            self.assertEqual(r.status,503)

            # With API key but without signer -> 503
            os.environ['NEYNAR_API_KEY']='test-key'
            r=await self.client.post('/api/farcaster/cast',json={'text':'gm'})
            self.assertEqual(r.status,503)

            # With both, empty text -> 400
            os.environ['FARCASTER_SIGNER_UUID']='test-uuid'
            r=await self.client.post('/api/farcaster/cast',json={'text':''})
            self.assertEqual(r.status,400)
        finally:
            if saved_key is not None: os.environ['NEYNAR_API_KEY']=saved_key
            else: os.environ.pop('NEYNAR_API_KEY',None)
            if saved_signer is not None: os.environ['FARCASTER_SIGNER_UUID']=saved_signer
            else: os.environ.pop('FARCASTER_SIGNER_UUID',None)

import hashlib as _hashlib, hmac as _hmac, json as _json, time as _time
from urllib.parse import quote as _quote
import telegram_integration as tg
import discord_integration as dc


def sign_init_data(bot_token, fields):
    """Build a validly-signed Telegram initData string for tests."""
    pairs = sorted(f'{k}={v}' for k, v in fields.items())
    data_check = '\n'.join(pairs)
    secret = _hmac.new(b'WebAppData', bot_token.encode(), _hashlib.sha256).digest()
    digest = _hmac.new(secret, data_check.encode(), _hashlib.sha256).hexdigest()
    encoded = '&'.join(_quote(k) + '=' + _quote(str(v)) for k, v in fields.items())
    return encoded + '&hash=' + digest


class IntegrationUnitTests(unittest.TestCase):
    def test_validate_init_data_accepts_valid_signature(self):
        token = '123:TEST'
        init = sign_init_data(token, {'auth_date': str(int(_time.time())), 'query_id': 'AAH', 'user': _json.dumps({'id': 42, 'first_name': 'Ada'}, separators=(',', ':'))})
        data = tg.validate_init_data(init, token)
        self.assertEqual(data['user']['id'], 42)
        self.assertEqual(data['user']['first_name'], 'Ada')

    def test_validate_init_data_rejects_tampering_and_expiry(self):
        token = '123:TEST'
        init = sign_init_data(token, {'auth_date': str(int(_time.time())), 'user': _json.dumps({'id': 1})})
        self.assertRaises(ValueError, tg.validate_init_data, init + 'x', token)  # broken hash
        old = sign_init_data(token, {'auth_date': '1', 'user': _json.dumps({'id': 1})})
        self.assertRaises(ValueError, tg.validate_init_data, old, token, 3600)  # expired
        self.assertRaises(ValueError, tg.validate_init_data, '', token)  # empty
        self.assertRaises(ValueError, tg.validate_init_data, init, '')  # no bot configured

    def test_user_profile_is_deterministic_and_safe(self):
        p1 = tg.user_profile({'id': 42, 'first_name': 'Ada'})
        p2 = tg.user_profile({'id': 42, 'first_name': 'Ada'})
        self.assertEqual(p1, p2)
        self.assertIn(p1['shape'], tg.SHAPES)
        self.assertRegex(p1['color'], r'^#[0-9a-f]{6}$')
        long = tg.user_profile({'id': 7, 'first_name': 'X' * 50})
        self.assertEqual(len(long['name']), 20)

    def test_classify_and_room_ids(self):
        self.assertEqual(tg.classify({'message': {'text': '/start', 'chat': {'id': 5}}})[0], 'start')
        self.assertEqual(tg.classify({'my_chat_member': {'new_chat_member': {'status': 'member'}, 'chat': {'id': 9}}})[0], 'added')
        self.assertEqual(tg.party_room_id({'id': -100123}), 'tg:-100123')
        self.assertEqual(dc.channel_room_id('999'), 'dc:999')

    def test_discord_verify_missing_key_returns_none(self):
        self.assertIn(dc.verify_interaction('', '', b'', ''), (True, False, None))
        self.assertIs(dc.verify_interaction('', '', b'', None), False)


class TelegramDiscordRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.db = self.tmp.name + '/pets.db'
        self.client = TestClient(TestServer(create_app(self.db, [ORIGIN])))
        await self.client.start_server(); self.sockets = []
        self.token = '999:TESTTOKEN'
        self.saved = {k: os.environ.get(k) for k in ('TELEGRAM_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_PUBLIC_KEY')}
    async def asyncTearDown(self):
        for ws in self.sockets:
            try: await ws.close()
            except Exception: pass
        await self.client.close(); self.tmp.cleanup()
        for k, v in self.saved.items():
            if v is None: os.environ.pop(k, None)
            else: os.environ[k] = v

    def _init(self, tg_id=42, name='Ada'):
        user = {'id': tg_id, 'first_name': name}
        return sign_init_data(self.token, {'auth_date': str(int(_time.time())), 'query_id': 'AAH', 'user': _json.dumps(user, separators=(',', ':'))})

    async def register(self, name):
        r = await self.client.post('/api/register', headers={'Origin': ORIGIN}, json={'pet': {'name': name, 'shape': 'robot', 'color': '#a474f1'}})
        self.assertEqual(r.status, 200); return await r.json()
    async def connect(self, identity):
        ws = await self.client.ws_connect('/ws', headers={'Origin': ORIGIN}); self.sockets.append(ws)
        await ws.send_json({'type': 'auth', 'token': identity['token']}); await self.event(ws, 'state'); return ws
    async def event(self, ws, typ):
        for _ in range(20):
            data = await asyncio.wait_for(ws.receive_json(), 2)
            if data['type'] == typ: return data
        self.fail('Missing ' + typ)

    async def test_telegram_auth_unconfigured_returns_503(self):
        os.environ.pop('TELEGRAM_BOT_TOKEN', None)
        r = await self.client.post('/api/telegram/auth', json={'initData': 'anything'})
        self.assertEqual(r.status, 503)

    async def test_telegram_auth_valid_and_stable_identity(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        init = self._init()
        r = await self.client.post('/api/telegram/auth', json={'initData': init})
        self.assertEqual(r.status, 200)
        data = await r.json()
        self.assertRegex(data['id'], r'^[a-f0-9]{32}$')
        self.assertRegex(data['code'], r'^[A-Z2-9]{8}$')
        ws = await self.client.ws_connect('/ws', headers={'Origin': ORIGIN}); self.sockets.append(ws)
        await ws.send_json({'type': 'auth', 'token': data['token']})
        state = await self.event(ws, 'state')
        self.assertEqual(state['self']['pet']['name'], 'Ada')
        r2 = await self.client.post('/api/telegram/auth', json={'initData': init})
        data2 = await r2.json()
        self.assertEqual(data2['id'], data['id'])  # stable identity per Telegram user

    async def test_telegram_auth_rejects_bad_signature(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        r = await self.client.post('/api/telegram/auth', json={'initData': self._init() + 'tampered'})
        self.assertEqual(r.status, 400)

    async def test_telegram_webhook_unconfigured_returns_503(self):
        os.environ.pop('TELEGRAM_BOT_TOKEN', None)
        r = await self.client.post('/api/telegram/webhook', json={'message': {'text': '/start', 'chat': {'id': 1}}})
        self.assertEqual(r.status, 503)

    async def test_discord_token_unconfigured_returns_503(self):
        os.environ.pop('DISCORD_CLIENT_ID', None); os.environ.pop('DISCORD_CLIENT_SECRET', None)
        r = await self.client.post('/api/discord/token', json={'code': 'abc'})
        self.assertEqual(r.status, 503)

    async def test_discord_interactions_ping_requires_config(self):
        os.environ.pop('DISCORD_PUBLIC_KEY', None)
        r = await self.client.post('/api/discord/interactions', data=b'{}', headers={'X-Signature-Ed25519': 'x', 'X-Signature-Timestamp': '1'})
        self.assertEqual(r.status, 503)

    async def test_party_chat_room_shares_members(self):
        a = await self.register('Room A'); b = await self.register('Room B')
        wa = await self.connect(a); wb = await self.connect(b)
        await wa.send_json({'type': 'party-join', 'room': 'chat', 'platform': 'telegram', 'chatId': '-100123', 'pet': {'name': 'Room A', 'shape': 'cat', 'color': '#a474f1'}})
        state = await self.event(wa, 'party-state')
        self.assertEqual(state['room'], 'chat'); self.assertEqual(state['platform'], 'telegram'); self.assertEqual(state['code'], '-100123')
        await wb.send_json({'type': 'party-join', 'room': 'chat', 'platform': 'telegram', 'chatId': '-100123', 'pet': {'name': 'Room B', 'shape': 'blob', 'color': '#123456'}})
        sa = await self.event(wa, 'party-state')
        self.assertEqual(len(sa['members']), 2)
        await wb.send_json({'type': 'party-join', 'room': 'chat', 'platform': 'weird', 'chatId': '1', 'pet': {'name': 'x', 'shape': 'cat', 'color': '#123456'}})
        await self.event(wb, 'error')

    async def test_party_action_broadcast_and_full_traits(self):
        a = await self.register('Plaza A'); b = await self.register('Plaza B')
        wa = await self.connect(a); wb = await self.connect(b)
        await wa.send_json({'type': 'party-join', 'room': 'public', 'pet': {'name': 'Plaza A', 'shape': 'bunny', 'color': '#ffd700', 'expression': 'shades', 'accessory': 'crown', 'tokenId': 42}})
        sa = await self.event(wa, 'party-state')
        self.assertEqual(sa['members'][0]['pet']['expression'], 'shades')
        self.assertEqual(sa['members'][0]['pet']['accessory'], 'crown')
        self.assertEqual(sa['members'][0]['pet']['tokenId'], 42)
        await wb.send_json({'type': 'party-join', 'room': 'public', 'pet': {'name': 'Plaza B', 'shape': 'frog', 'color': '#2ecc71'}})
        await self.event(wa, 'party-state')
        await self.event(wb, 'party-state')
        await wa.send_json({'type': 'party-action', 'action': 'berry', 'text': 'Enjoy a berry!'})
        act_b = await self.event(wb, 'party-action')
        self.assertEqual(act_b['action'], 'berry')
        self.assertEqual(act_b['pet']['name'], 'Plaza A')

    async def test_snap_nft_recognition(self):
        r = await self.client.get('/api/snap?nft=42', headers={'Accept': 'application/vnd.farcaster.snap+json'})
        self.assertEqual(r.status, 200)
        data = await r.json()
        self.assertIn('TinyFren #42', data['ui']['elements']['header']['props']['content'])
    async def test_nft_price_quote(self):
        r = await self.client.get('/api/nft/price', headers={'Origin': ORIGIN})
        self.assertEqual(r.status, 200)
        data = await r.json()
        self.assertEqual(data['targetUsd'], 1.0)
        self.assertGreater(data['priceUsd'], 0)
        self.assertGreater(data['frensRequired'], 0)
        self.assertGreater(data['creditsRequired'], 0)

    async def test_wallet_mint_and_magic_link(self):
        a = await self.register('MintyFren')
        # Check mint quote without charging
        r_check = await self.client.post('/api/wallet/mint', headers={'Origin': ORIGIN}, json={'token': a['token'], 'checkOnly': True})
        self.assertEqual(r_check.status, 200)
        check_data = await r_check.json()
        self.assertIn('frensRequired', check_data)
        self.assertTrue(check_data['vaultAddress'].startswith('0x'))

        # Perform mint (with testnet free mint fallback enabled by default)
        r_mint = await self.client.post('/api/wallet/mint', headers={'Origin': ORIGIN}, json={'token': a['token']})
        self.assertEqual(r_mint.status, 200)
        mint_data = await r_mint.json()
        self.assertTrue(mint_data['success'])
        token_id = mint_data['nft']['tokenId']
        self.assertGreaterEqual(token_id, 1)
        self.assertLessEqual(token_id, 888)
        self.assertEqual(mint_data['pet']['tokenId'], token_id)

        # Check that bankr_nfts returns the minted NFT
        r_nfts = await self.client.post('/api/bankr/nfts', headers={'Origin': ORIGIN}, json={'token': a['token']})
        self.assertEqual(r_nfts.status, 200)
        nfts_data = await r_nfts.json()
        self.assertEqual(len(nfts_data['nfts']), 1)
        self.assertEqual(nfts_data['nfts'][0]['tokenId'], token_id)

        # Generate magic link
        r_link = await self.client.post('/api/wallet/magic-link', headers={'Origin': ORIGIN}, json={'token': a['token']})
        self.assertEqual(r_link.status, 200)
        link_data = await r_link.json()
        self.assertTrue(link_data['code'])
        self.assertIn('#restore=' + link_data['code'], link_data['restoreUrl'])

        # Restore from magic link
        r_restore = await self.client.post('/api/wallet/restore', headers={'Origin': ORIGIN}, json={'code': link_data['code']})
        self.assertEqual(r_restore.status, 200)
        restore_data = await r_restore.json()
        self.assertTrue(restore_data['success'])
        self.assertEqual(restore_data['pet']['name'], 'MintyFren')
        self.assertEqual(restore_data['pet']['tokenId'], token_id)
        self.assertTrue(restore_data['vaultAddress'].startswith('0x'))

    async def test_push_subscribe_and_offline_friend_request(self):
        import app as app_module
        env = {'VAPID_PRIVATE_KEY': 'test-key', 'VAPID_SUBJECT': 'mailto:test@example.com', 'VAPID_PUBLIC_KEY': 'test-public'}
        with mock.patch.dict(os.environ, env):
            self.assertTrue(app_module.push_configured())
            a = await self.register('Pushy'); b = await self.register('Quiet')
            sub = {'endpoint': 'https://push.example/sub', 'keys': {'p256dh': 'p256', 'auth': 'auth'}}
            r = await self.client.post('/api/push/subscribe', headers={'Origin': ORIGIN}, json={'token': b['token'], 'subscription': sub})
            self.assertEqual(r.status, 200)
            r = await self.client.post('/api/push/subscribe', headers={'Origin': ORIGIN}, json={'token': 'bogus', 'subscription': sub})
            self.assertEqual(r.status, 400)
            r = await self.client.post('/api/push/subscribe', headers={'Origin': ORIGIN}, json={'token': b['token'], 'subscription': {'endpoint': 'http://insecure.example', 'keys': {'p256dh': 'p', 'auth': 'a'}}})
            self.assertEqual(r.status, 400)
            r = await self.client.get('/api/push/public-key', headers={'Origin': ORIGIN})
            self.assertEqual(r.status, 200)
            self.assertEqual((await r.json())['key'], 'test-public')
            sent = []
            original = app_module.deliver_push
            app_module.deliver_push = lambda path, rows, payload: sent.append((rows, payload))
            try:
                wa = await self.connect(a)
                await wa.send_json({'type': 'friend-request', 'code': b['code']})
                await self.event(wa, 'notice')
                for _ in range(100):
                    if sent: break
                    await asyncio.sleep(0.05)
            finally:
                app_module.deliver_push = original
            self.assertEqual(len(sent), 1)
            self.assertEqual(sent[0][0], [('https://push.example/sub', 'p256', 'auth')])
            self.assertEqual(sent[0][1]['title'], 'New friend request')
            self.assertIn('Pushy', sent[0][1]['body'])
            r = await self.client.post('/api/push/unsubscribe', headers={'Origin': ORIGIN}, json={'token': b['token'], 'endpoint': 'https://push.example/sub'})
            self.assertEqual(r.status, 200)
            r = await self.client.post('/api/push/unsubscribe', headers={'Origin': ORIGIN}, json={'token': a['token'], 'endpoint': 'https://push.example/sub'})
            self.assertEqual(r.status, 200)  # a different pet cannot remove someone else's row

if __name__=='__main__': unittest.main()

