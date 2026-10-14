import asyncio, base64, json, os, re, sqlite3, tempfile, unittest
from pathlib import Path
from unittest import mock
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from eth_account import Account
from eth_account.messages import encode_defunct
from app import create_app

ORIGIN='https://tinyfrens.lol'
class RelayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        extras = mock.patch('app.ExtraCompanions.discover', new=mock.AsyncMock(return_value={'nfts':[], 'partial':False}))
        extras.start(); self.addCleanup(extras.stop)
        robot_discovery = mock.patch('app.Robots.discover', new=mock.AsyncMock(return_value={'nfts':[], 'partial':False}))
        robot_discovery.start(); self.addCleanup(robot_discovery.stop)
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
    async def test_battle_flow_and_actions(self):
        a=await self.register('A');b=await self.register('B');wa=await self.connect(a);wb=await self.connect(b)
        await self.friends(a,b,wa,wb)
        # Test battle decline
        await wa.send_json({'type':'battle-request','id':b['id']})
        await self.event(wa,'notice')
        req=await self.event(wb,'battle-request')
        await wb.send_json({'type':'battle-answer','id':req['id'],'accept':False})
        self.assertEqual((await self.event(wa,'notice'))['text'],'Not sparring right now.')
        # Test battle accept
        await wa.send_json({'type':'battle-request','id':b['id']})
        await self.event(wa,'notice')
        req=await self.event(wb,'battle-request')
        await wb.send_json({'type':'battle-answer','id':req['id'],'accept':True})
        def_start=await self.event(wb,'battle-start')
        chal_start=await self.event(wa,'battle-start')
        self.assertEqual(def_start['role'],'defender')
        self.assertEqual(chal_start['role'],'challenger')
        # Test battle action
        await wa.send_json({'type':'battle-action','id':req['id'],'action':'boop'})
        self.assertEqual((await self.event(wa,'battle-action'))['action'],'boop')
        self.assertEqual((await self.event(wb,'battle-action'))['action'],'boop')
        # Test battle end
        await wa.send_json({'type':'battle-end','id':req['id']})
        await self.event(wa,'battle-ended');await self.event(wb,'battle-ended')
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

    async def test_robot_import_requires_signed_link_and_collection_chain(self):
        from robot_companion import CONTRACT
        from pathlib import Path
        fren = await self.register('Robot owner')
        account = Account.create()
        image = 'data:image/svg+xml;base64,' + base64.b64encode((Path(__file__).parent / 'fixtures/robots-v1/1.svg').read_bytes()).decode()
        uri = 'data:application/json;base64,' + base64.b64encode(json.dumps({'name':'Robot #1','image':image}).encode()).decode()
        encoded = '0x' + format(32,'064x') + format(len(uri),'064x') + uri.encode().hex()
        async def rpc(method, params):
            if method == 'eth_chainId': return '0x2105'
            if method == 'eth_blockNumber': return '0x3219000'
            return encoded if params[0]['data'].startswith('0xc87b56dd') else '0x'+account.address[2:].lower().zfill(64)
        payload = {'token':fren['token'],'tokenId':1,'originalAddress':CONTRACT,'chainId':8453}
        with mock.patch('app.Robots.rpc', new=mock.AsyncMock(side_effect=rpc)):
            r = await self.client.post('/api/featured/companion',headers={'Origin':ORIGIN},json=payload)
            self.assertEqual(r.status,403)
            r = await self.client.post('/api/wallet-link/challenge',headers={'Origin':ORIGIN},json={'token':fren['token'],'address':account.address})
            challenge = await r.json()
            signature = Account.sign_message(encode_defunct(text=challenge['message']),account.key).signature.hex()
            r = await self.client.post('/api/wallet-link/confirm',headers={'Origin':ORIGIN},json={'token':fren['token'],'signature':signature})
            self.assertEqual(r.status,200)
            r = await self.client.post('/api/featured/companion',headers={'Origin':ORIGIN},json={**payload,'chainId':4663})
            self.assertEqual(r.status,400)
            r = await self.client.post('/api/featured/companion',headers={'Origin':ORIGIN},json=payload)
            self.assertEqual(r.status,200)
            result = await r.json()
            self.assertTrue(result['active'])
            self.assertEqual(len(result['companion']['frames']),8)
            await self.client.post('/api/wallet-link/disconnect',headers={'Origin':ORIGIN},json={'token':fren['token'],'address':account.address})
            r = await self.client.post('/api/featured/companion',headers={'Origin':ORIGIN},json=payload)
            self.assertEqual(r.status,403)

    async def test_hood_turtle_display_requires_signed_link_and_current_owner(self):
        fren=await self.register('Turtle Owner')
        stranger=await self.register('Stranger')
        account=Account.create()
        wallet=account.address
        other='0x2222222222222222222222222222222222222222'
        original_owner=wallet
        metadata={'name':'Hood Turtle #1','image':'data:image/svg+xml;base64,PHN2Zy8+'}
        uri='data:application/json;base64,'+base64.b64encode(json.dumps(metadata).encode()).decode()
        encoded_uri=uri.encode()
        async def rpc(request):
            body=await request.json()
            selector=body['params'][0]['data'][:10]
            if selector=='0xc87b56dd':
                result='0x'+(32).to_bytes(32,'big').hex()+len(encoded_uri).to_bytes(32,'big').hex()+encoded_uri.hex()
            else:
                result='0x'+int(original_owner,16).to_bytes(32,'big').hex()
            return web.json_response({'jsonrpc':'2.0','id':1,'result':result})
        rpc_app=web.Application();rpc_app.router.add_post('/',rpc)
        server=TestServer(rpc_app);await server.start_server()
        try:
            with mock.patch.dict(os.environ,{'ROBINHOOD_RPC_URL':str(server.make_url('/'))}):
                path='/api/featured/hood-turtle'
                payload={'token':fren['token'],'tokenId':1}
                response=await self.client.post(path,headers={'Origin':ORIGIN},json=payload)
                self.assertEqual(response.status,403)
                response=await self.client.post('/api/wallet-link/challenge',headers={'Origin':ORIGIN},
                                                json={'token':fren['token'],'address':wallet})
                challenge=await response.json()
                signature=Account.sign_message(encode_defunct(text=challenge['message']),account.key).signature.hex()
                response=await self.client.post('/api/wallet-link/confirm',headers={'Origin':ORIGIN},
                                                json={'token':fren['token'],'signature':signature})
                self.assertEqual(response.status,200)
                response=await self.client.post(path,headers={'Origin':ORIGIN},
                                                json={'token':stranger['token'],'tokenId':1,'wallet':wallet})
                self.assertEqual(response.status,403)
                response=await self.client.post(path,headers={'Origin':ORIGIN},json=payload)
                self.assertEqual(response.status,200)
                data=await response.json()
                self.assertTrue(data['active'])
                self.assertEqual(data['image'],metadata['image'])
                original_owner=other
                # Ownership is cached for 24 hours, then transfers revoke display.
                with mock.patch('turtle_connect.time.time', return_value=data['validUntil'] + 1):
                    response=await self.client.post(path,headers={'Origin':ORIGIN},json=payload)
                self.assertEqual(response.status,200)
                data=await response.json()
                self.assertFalse(data['active'])
                self.assertIsNone(data['image'])
        finally:
            await server.close()

    async def test_read_only_wallet_link_is_persistent_replay_safe_and_revocable(self):
        async def post(path, body):
            return await self.client.post(path, headers={'Origin': ORIGIN}, json=body)
        fren=await self.register('Walletless')
        other=await self.register('Other')
        account=Account.create()
        wrong=Account.create()
        payload={'token':fren['token']}
        response=await post('/api/wallet-link/challenge',{**payload,'address':account.address})
        self.assertEqual(response.status,200)
        challenge=await response.json()
        self.assertIn('read-only',challenge['message'])
        self.assertIn('does not authorize transactions',challenge['message'])
        wrong_signature=Account.sign_message(encode_defunct(text=challenge['message']),wrong.key).signature.hex()
        response=await post('/api/wallet-link/confirm',{**payload,'signature':wrong_signature})
        self.assertEqual(response.status,400)
        signature=Account.sign_message(encode_defunct(text=challenge['message']),account.key).signature.hex()
        response=await post('/api/wallet-link/confirm',{**payload,'signature':signature})
        self.assertEqual(response.status,200)
        self.assertEqual((await response.json())['address'],account.address)
        response=await post('/api/wallet-link/confirm',{**payload,'signature':signature})
        self.assertEqual(response.status,400)
        response=await post('/api/wallet-link/status',payload)
        self.assertEqual((await response.json())['address'],account.address)
        response=await post('/api/wallet-link/status',{'token':other['token']})
        self.assertFalse((await response.json())['linked'])
        response=await post('/api/wallet-link/disconnect',payload)
        self.assertEqual(response.status,200)
        response=await post('/api/wallet-link/status',payload)
        self.assertFalse((await response.json())['linked'])

    async def test_wallet_scan_filters_supported_nfts_and_verifies_owner_on_chain(self):
        async def post(path, body):
            return await self.client.post(path, headers={'Origin': ORIGIN}, json=body)
        fren=await self.register('Collector')
        account=Account.create()
        payload={'token':fren['token']}
        response=await post('/api/wallet-link/challenge',{**payload,'address':account.address})
        challenge=await response.json()
        signature=Account.sign_message(encode_defunct(text=challenge['message']),account.key).signature.hex()
        response=await post('/api/wallet-link/confirm',{**payload,'signature':signature})
        self.assertEqual(response.status,200)
        current_owner=account.address
        async def indexer(request):
            return web.json_response({'items':[
                {'id':'1','token':{'address_hash':'0xca28587b61eac19a87dfcfd9420870867a916675'}},
                {'id':'2','token':{'address_hash':'0x1111111111111111111111111111111111111111'}}],
                'next_page_params':None})
        async def rpc(request):
            return web.json_response({'result':'0x'+int(current_owner,16).to_bytes(32,'big').hex()})
        fake=web.Application()
        fake.router.add_get('/api/v2/addresses/{address}/nft',indexer)
        fake.router.add_post('/rpc',rpc)
        server=TestServer(fake);await server.start_server()
        try:
            with mock.patch.dict(os.environ,{'ROBINHOOD_BLOCKSCOUT_API_URL':str(server.make_url('/api/v2')),
                                          'ROBINHOOD_RPC_URL':str(server.make_url('/rpc'))}):
                response=await post('/api/wallet-link/nfts',payload)
                self.assertEqual(response.status,200)
                data=await response.json()
                self.assertEqual([nft['tokenId'] for nft in data['nfts']],[1])
                current_owner='0x2222222222222222222222222222222222222222'
                response=await post('/api/wallet-link/nfts',payload)
                self.assertEqual((await response.json())['nfts'],[])
        finally:
            await server.close()
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
            self.assertTrue((await r.json())['evmAddress'].startswith('0x'))
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
        self.assertIn(data['pet']['shape'],['cat','blob','robot','bunny','duck','pig','frog','turtle'])
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
        self.assertEqual(tg.classify({'message': {'text': '@TinyFrensBot open issue', 'chat': {'id': 9}}})[0], 'issue')
        self.assertFalse(tg.is_issue_command('we should open issue later'))
        self.assertEqual(tg.classify({'message': {'text': 'hi @TinyFrensBot', 'chat': {'id': 9}}})[0], 'mention')
        self.assertEqual(tg.link_code({'message': {'text': '/link ABCD-EFGH-JKLM', 'chat': {'type': 'private'}}}), 'ABCDEFGHJKLM')
        self.assertIsNone(tg.link_code({'message': {'text': '/link ABCD-EFGH-JKLM', 'chat': {'type': 'group'}}}))
        self.assertIn('web_app', tg.reply_markup('https://tinyfrens.lol')['inline_keyboard'][0][0])
        self.assertIn('url', tg.reply_markup('https://t.me/TinyFrensBot?startapp', private=False)['inline_keyboard'][0][0])
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
        keys = ('TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_MINIAPP_URL',
                'TELEGRAM_MINIAPP_DEEP_LINK', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET',
                'DISCORD_PUBLIC_KEY', 'GITHUB_TOKEN', 'GITHUB_REPO', 'GITHUB_ISSUE_LABELS',
                'TELEGRAM_ISSUE_HISTORY', 'GITHUB_WEBHOOK_SECRET', 'GEMINI_API_KEY',
                'GOOGLE_API_KEY', 'GEMINI_MODEL', 'TELEGRAM_MODERATION', 'TELEGRAM_MODERATION_TIMEOUT')
        self.saved = {k: os.environ.get(k) for k in keys}
        os.environ.pop('TELEGRAM_MINIAPP_URL', None)
        os.environ.pop('TELEGRAM_MINIAPP_DEEP_LINK', None)
    async def asyncTearDown(self):
        for ws in self.sockets:
            try: await ws.close()
            except Exception: pass
        await self.client.close(); self.tmp.cleanup()
        for k, v in self.saved.items():
            if v is None: os.environ.pop(k, None)
            else: os.environ[k] = v

    def _init(self, tg_id=42, name='Ada', username=None):
        user = {'id': tg_id, 'first_name': name}
        if username: user['username'] = username
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
        self.assertTrue(data2['profile']['identities'][0]['verified'])

    async def test_telegram_dm_links_verified_handle_to_existing_account(self):
        source = await self.register('Source')
        code_response = await self.client.post('/api/device-sync/start', headers={'Origin': ORIGIN}, json={'token': source['token']})
        sync = await code_response.json()
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        os.environ['TELEGRAM_WEBHOOK_SECRET'] = 'telegram-secret'
        update = {'message': {'text': '/link ' + sync['code'], 'chat': {'id': 55, 'type': 'private'},
                              'from': {'id': 77, 'first_name': 'Tess', 'username': 'tess_nft'}}}
        with mock.patch('app.bot_api', new=mock.AsyncMock(return_value=({'ok': True}, 200))) as send:
            rejected = await self.client.post('/api/telegram/webhook', json=update)
            self.assertEqual(rejected.status, 403)
            linked = await self.client.post('/api/telegram/webhook', json=update,
                                            headers={'X-Telegram-Bot-Api-Secret-Token': 'telegram-secret'})
            self.assertEqual(linked.status, 200)
            self.assertEqual(send.await_count, 1)
        pending = await (await self.client.post('/api/device-sync/status', headers={'Origin': ORIGIN},
            json={'token': source['token'], 'code': sync['code']})).json()
        self.assertEqual(pending['label'], 'Telegram @tess_nft')
        accepted = await self.client.post('/api/device-sync/accept', headers={'Origin': ORIGIN},
            json={'token': source['token'], 'code': sync['code'], 'requestId': pending['requestId']})
        self.assertEqual(accepted.status, 200)
        auth = await (await self.client.post('/api/telegram/auth', json={'initData': self._init(77, 'Tess', 'tess_nft')})).json()
        profile = await (await self.client.post('/api/account/profile', headers={'Origin': ORIGIN},
            json={'token': auth['token'], 'displayName': 'Tess and the bots'})).json()
        self.assertEqual(profile['displayName'], 'Tess and the bots')
        self.assertEqual(profile['xHandle'], '')
        self.assertEqual(profile['identities'][0]['handle'], 'tess_nft')
        self.assertTrue(profile['identities'][0]['verified'])

    async def test_account_x_handle_requires_verified_identity(self):
        auth = await self.register('Tess')
        body = {'token': auth['token']}
        response = await self.client.post('/api/account/profile', headers={'Origin': ORIGIN},
            json={**body, 'displayName': 'Spoof', 'xHandle': '@someone_else'})
        self.assertEqual(response.status, 400)
        self.assertIn('verified X ownership', (await response.json())['error'])
        from device_sync import ensure_account
        database = sqlite3.connect(self.db)
        with database:
            account = ensure_account(database, auth['id'])
            database.execute('INSERT INTO account_profiles VALUES(?,?,?,?)', (account, 'Tess', 'legacy_claim', 1))
            database.execute('INSERT INTO wallet_links VALUES(?,?,?)', (auth['id'], '0x' + '11' * 20, 1))
            database.execute('INSERT INTO wallet_social_profiles VALUES(?,?,?,?)', ('0x' + '11' * 20, 'wallet_claim', 'wallet-signed', 1))
            database.execute('INSERT INTO account_identities VALUES(?,?,?,?,?,?,?)', (account, 'x', '123', 'unverified_claim', 'X user', 0, 1))
        profile = await (await self.client.post('/api/account/profile', headers={'Origin': ORIGIN}, json=body)).json()
        self.assertEqual(profile['displayName'], 'Tess')
        self.assertEqual(profile['xHandle'], '')
        self.assertIsNone(profile['xHandleSource'])
        with database:
            database.execute('UPDATE wallet_social_profiles SET x_handle=?,source=?', ('bankr_tess', 'bankr-verified'))
        profile = await (await self.client.post('/api/account/profile', headers={'Origin': ORIGIN}, json=body)).json()
        self.assertEqual(profile['xHandle'], 'bankr_tess')
        self.assertEqual(profile['xHandleSource'], 'bankr')
        with database:
            database.execute('UPDATE account_identities SET verified=1,handle=? WHERE platform=?', ('verified_tess', 'x'))
        database.close()
        profile = await (await self.client.post('/api/account/profile', headers={'Origin': ORIGIN},
            json={**body, 'displayName': 'New Tess'})).json()
        self.assertEqual(profile['xHandle'], 'verified_tess')
        self.assertEqual(profile['xHandleSource'], 'verified-identity')
        self.assertEqual(profile['displayName'], 'New Tess')

    async def test_telegram_show_requires_a_selected_verified_nft(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        os.environ['TELEGRAM_WEBHOOK_SECRET'] = 'telegram-secret'
        update = {'message': {'text': '/show', 'chat': {'id': 88, 'type': 'private'},
                              'from': {'id': 89, 'first_name': 'No NFT', 'username': 'empty_fren'}}}
        with mock.patch('app.bot_api', new=mock.AsyncMock(return_value=({'ok': True}, 200))) as send:
            response = await self.client.post('/api/telegram/webhook', json=update,
                headers={'X-Telegram-Bot-Api-Secret-Token': 'telegram-secret'})
            self.assertEqual(response.status, 200)
            self.assertEqual(send.await_args.args[0], 'sendMessage')
            self.assertIn('Choose an NFT', send.await_args.args[1]['text'])

    async def test_telegram_show_renders_selected_nft_once_then_reuses_file_id(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        os.environ['TELEGRAM_WEBHOOK_SECRET'] = 'telegram-secret'
        auth = await (await self.client.post('/api/telegram/auth',
            json={'initData': self._init(91, 'Robot', 'robot_owner')})).json()
        wallet = Account.create().address
        database = sqlite3.connect(self.db)
        try:
            with database:
                database.execute('INSERT INTO wallet_links VALUES(?,?,?)', (auth['id'], wallet, int(_time.time())))
        finally:
            database.close()
        item = {'chainId': 8453, 'originalAddress': '0xd745d8005a1ad8f783b97bf55e0d0e6a920ea8ff',
                'tokenId': 1, 'motion': {'mode': 'roam', 'speed': 60, 'size': 80}}
        state = await (await self.client.post('/api/device-sync/state', headers={'Origin': ORIGIN},
            json={'token': auth['token']})).json()
        changed = await self.client.post('/api/device-sync/state', headers={'Origin': ORIGIN},
            json={'token': auth['token'], 'revision': state['revision'], 'selection': [item]})
        self.assertEqual(changed.status, 200)
        from robot_companion import companion as robot_rig
        image = 'data:image/svg+xml;base64,' + base64.b64encode((Path(__file__).parent / 'fixtures/robots-v1/1.svg').read_bytes()).decode()
        verified = {**item, 'wallet': wallet, 'active': True, 'name': 'TinyFrens Robot v1 #1', 'companion': robot_rig(image)}
        update = {'message': {'text': '/show', 'chat': {'id': -100, 'type': 'group'},
                              'from': {'id': 91, 'first_name': 'Robot', 'username': 'robot_owner'}}}
        bot_result = {'ok': True, 'result': {'animation': {'file_id': 'telegram-file-id'}}}
        with mock.patch('app.Robots.read', new=mock.AsyncMock(return_value=verified)), \
             mock.patch('app.bot_api', new=mock.AsyncMock(return_value=(bot_result, 200))) as send:
            first = await self.client.post('/api/telegram/webhook', json=update,
                headers={'X-Telegram-Bot-Api-Secret-Token': 'telegram-secret'})
            self.assertEqual(first.status, 200)
            self.assertEqual(send.await_args.args[0], 'sendAnimation')
            self.assertTrue(send.await_args.args[3]['animation'].startswith(b'GIF'))
            second = await self.client.post('/api/telegram/webhook', json=update,
                headers={'X-Telegram-Bot-Api-Secret-Token': 'telegram-secret'})
            self.assertEqual(second.status, 200)
            self.assertEqual(send.await_args.args[1]['animation'], 'telegram-file-id')
            button = send.await_args.args[1]['reply_markup']['inline_keyboard'][0][0]
            self.assertEqual(button['url'], 'https://t.me/TinyFrensBot?startapp=home')
            self.assertIsNone(send.await_args.args[3])

    async def test_telegram_auth_rejects_bad_signature(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        r = await self.client.post('/api/telegram/auth', json={'initData': self._init() + 'tampered'})
        self.assertEqual(r.status, 400)

    async def test_telegram_webhook_unconfigured_returns_503(self):
        os.environ.pop('TELEGRAM_BOT_TOKEN', None)
        r = await self.client.post('/api/telegram/webhook', json={'message': {'text': '/start', 'chat': {'id': 1}}})
        self.assertEqual(r.status, 503)

    def _fake_bot_api(self, sent):
        """Stand-in for telegram_integration.bot_api that records sent messages."""
        async def fake(method, payload, token):
            sent.append({'method': method, 'chat_id': payload.get('chat_id'), 'text': payload.get('text', '')})
            return {'ok': True}, 200
        return fake

    async def test_telegram_mention_and_private_message_receive_ai_reply(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        os.environ['GEMINI_API_KEY'] = 'ai-key'
        sent = []
        generated = mock.AsyncMock(return_value='Why did the TinyFren cross the blockchain? To get to the other sidechain!')
        with mock.patch('app.bot_api', new=self._fake_bot_api(sent)), \
             mock.patch('app.generate_telegram_reply', new=generated):
            for text, kind in [('hi @TinyFrensBot', 'group'), ('hello', 'private')]:
                response = await self.client.post('/api/telegram/webhook', json={
                    'message': {'text': text, 'chat': {'id': -42, 'type': kind},
                                'from': {'id': 5, 'first_name': 'Ada'}}})
                self.assertEqual(response.status, 200)
        self.assertEqual(len(sent), 2)
        self.assertTrue(all('other sidechain' in message['text'] for message in sent))
        self.assertEqual(generated.await_count, 2)
        self.assertIn('hi @TinyFrensBot', generated.await_args_list[0].args[0][-1]['text'])

    async def test_telegram_reply_to_bot_receives_ai_reply(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        os.environ['GEMINI_API_KEY'] = 'ai-key'
        sent = []
        generated = mock.AsyncMock(return_value='Yes, I am listening.')
        update={'message': {'message_id': 22, 'text': 'are you there?',
            'reply_to_message': {'from': {'is_bot': True, 'username': 'TinyFrensBot'}},
            'chat': {'id': -43, 'type': 'group'}, 'from': {'id': 5, 'first_name': 'Ada'}}}
        with mock.patch('app.bot_api', new=self._fake_bot_api(sent)), \
             mock.patch('app.generate_telegram_reply', new=generated):
            response=await self.client.post('/api/telegram/webhook',json=update)
        self.assertEqual(response.status,200)
        self.assertEqual(sent[0]['text'],'Yes, I am listening.')

    async def test_telegram_help_remains_a_command(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        sent=[]
        generated=mock.AsyncMock()
        with mock.patch('app.bot_api',new=self._fake_bot_api(sent)), \
             mock.patch('app.generate_telegram_reply',new=generated):
            response=await self.client.post('/api/telegram/webhook',json={
                'message': {'text':'/help','chat':{'id':7,'type':'private'},'from':{'id':5}}})
        self.assertEqual(response.status,200)
        self.assertIn('Talk to me normally',sent[0]['text'])
        generated.assert_not_awaited()

    def _clear_issue_env(self):
        for key in ('GITHUB_TOKEN', 'GITHUB_REPO', 'GITHUB_ISSUE_LABELS', 'TELEGRAM_ISSUE_HISTORY',
                    'GITHUB_WEBHOOK_SECRET', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_MODEL'):
            os.environ.pop(key, None)

    async def _chatter(self, chat_id, texts):
        """Post plain messages so the relay buffers them as conversation history."""
        for index, text in enumerate(texts):
            await self.client.post('/api/telegram/webhook', json={
                'update_id': 1000 + index, 'message': {'text': text, 'date': 1700000000 + index,
                                                       'from': {'id': 5, 'first_name': 'Ada', 'is_bot': False},
                                                       'chat': {'id': chat_id, 'type': 'group'}}})

    def _issue_update(self, chat_id, text='open an issue'):
        return {'message': {'text': text, 'from': {'id': 5, 'first_name': 'Ada'},
                            'chat': {'id': chat_id, 'type': 'group', 'title': 'TinyFrens crew'}}}

    def _configured(self):
        self._clear_issue_env()
        os.environ['GEMINI_API_KEY'] = 'ai-key'; os.environ['GITHUB_TOKEN'] = 'gh'
        os.environ['GITHUB_REPO'] = 'dutchiono/TinyFrens'

    async def test_issue_needs_ai_and_github_config(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        self._clear_issue_env()
        sent = []
        with mock.patch('app.bot_api', new=self._fake_bot_api(sent)):
            await self._chatter(-10, ['the vault is empty'])
            r = await self.client.post('/api/telegram/webhook', json=self._issue_update(-10))
            self.assertEqual(r.status, 200)
            self.assertTrue(any('GEMINI_API_KEY' in m['text'] for m in sent), sent)

            os.environ['GEMINI_API_KEY'] = 'ai-key'
            sent.clear()
            await self.client.post('/api/telegram/webhook', json=self._issue_update(-11))
            self.assertTrue(any('GITHUB_TOKEN' in m['text'] for m in sent), sent)

    async def test_issue_without_history_explains_itself(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        self._configured()
        sent = []
        with mock.patch('app.bot_api', new=self._fake_bot_api(sent)):
            await self.client.post('/api/telegram/webhook', json=self._issue_update(-12))
        self.assertTrue(any('haven' in m['text'] for m in sent), sent)

    async def test_issue_drafts_and_creates_a_real_issue(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        self._configured()
        os.environ['GITHUB_ISSUE_LABELS'] = 'telegram,bot'
        chat_id = -13
        sent = []
        created = {}
        draft = {'title': 'Vault shows empty after transfer', 'labels': ['bug'],
                 'body': '## What happened\n- Ada saw an empty vault\n\n## Suggested next steps\n- Repro it'}

        async def fake_create_issue(owner, repo, token, title, body, labels=None, timeout=20):
            created.update(owner=owner, repo=repo, token=token, title=title, body=body, labels=labels)
            return {'number': 77, 'html_url': 'https://github.com/dutchiono/TinyFrens/issues/77',
                    'title': title, 'labels': []}, 201

        async def fake_list_labels(owner, repo, token, timeout=20):
            created['listed'] = True
            return {'bug', 'telegram', 'bot'}

        async def fake_draft_issue(lines, api_key, chat_title='', model=None, timeout=20):
            created['lines'] = lines; created['api_key'] = api_key; created['chat_title'] = chat_title
            return draft

        with mock.patch('app.bot_api', new=self._fake_bot_api(sent)), \
             mock.patch('app.gh.draft_issue', new=fake_draft_issue), \
             mock.patch('app.gh.list_labels', new=fake_list_labels), \
             mock.patch('app.gh.create_issue', new=fake_create_issue):
            await self._chatter(chat_id, ['my vault looks empty', 'it emptied right after the transfer'])
            r = await self.client.post('/api/telegram/webhook', json=self._issue_update(chat_id))

        self.assertEqual(r.status, 200)
        self.assertTrue(created.get('listed'))
        self.assertEqual(created['owner'], 'dutchiono')
        self.assertEqual(created['title'], 'Vault shows empty after transfer')
        self.assertEqual(created['labels'], ['telegram', 'bot', 'bug'])
        self.assertIn('my vault looks empty', created['lines'])
        self.assertNotIn('open an issue', created['lines'])
        self.assertTrue(any('#77' in m['text'] and 'issues/77' in m['text'] for m in sent), sent)

    async def test_targeted_issue_uses_replied_message_without_prior_history(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        self._configured()
        update = self._issue_update(-43, '@TinyFrensBot open issue')
        update['message']['reply_to_message'] = {
            'text': 'The gallery is empty after connecting my wallet',
            'from': {'id': 6, 'first_name': 'Bob'}, 'date': 1700000000}
        draft = mock.AsyncMock(return_value={'title': 'Empty gallery', 'body': 'Repro', 'labels': []})
        created = mock.AsyncMock(return_value=({'number': 78, 'title': 'Empty gallery',
            'html_url': 'https://github.com/dutchiono/TinyFrens/issues/78'}, 201))
        sent = []
        with mock.patch('app.bot_api', new=self._fake_bot_api(sent)), \
             mock.patch('app.gh.draft_issue', new=draft), \
             mock.patch('app.gh.list_labels', new=mock.AsyncMock(return_value=set())), \
             mock.patch('app.gh.create_issue', new=created):
            response = await self.client.post('/api/telegram/webhook', json=update)
        self.assertEqual(response.status, 200)
        self.assertIn('The gallery is empty', draft.await_args.args[0])
        self.assertNotIn('@TinyFrensBot open issue', draft.await_args.args[0])
        self.assertTrue(any('Opened issue #78' in message['text'] for message in sent))

    async def test_issue_reports_github_failure_and_model_refusal(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        self._configured()

        async def failing_create_issue(owner, repo, token, title, body, labels=None, timeout=20):
            return {'message': 'Validation Failed'}, 422

        async def fake_list_labels(owner, repo, token, timeout=20):
            return {'bug'}

        async def ok_draft(lines, api_key, chat_title='', model=None, timeout=20):
            return {'title': 'Anything', 'labels': [], 'body': 'body'}

        async def refusing_draft(lines, api_key, chat_title='', model=None, timeout=20):
            raise ValueError('No issue to file from this conversation')

        sent = []
        with mock.patch('app.bot_api', new=self._fake_bot_api(sent)), \
             mock.patch('app.gh.draft_issue', new=ok_draft), \
             mock.patch('app.gh.list_labels', new=fake_list_labels), \
             mock.patch('app.gh.create_issue', new=failing_create_issue):
            await self._chatter(-14, ['something broke'])
            await self.client.post('/api/telegram/webhook', json=self._issue_update(-14, '/issue'))
        self.assertTrue(any('Validation Failed' in m['text'] for m in sent), sent)

        sent.clear()
        with mock.patch('app.bot_api', new=self._fake_bot_api(sent)), \
             mock.patch('app.gh.draft_issue', new=refusing_draft), \
             mock.patch('app.gh.list_labels', new=fake_list_labels), \
             mock.patch('app.gh.create_issue', new=failing_create_issue):
            await self._chatter(-15, ['just saying hi to everyone'])
            await self.client.post('/api/telegram/webhook', json=self._issue_update(-15, '/issue'))
        self.assertTrue(any('No issue to file' in m['text'] for m in sent), sent)
        self.assertFalse(any("couldn't open the issue" in m['text'] for m in sent))

    async def test_issue_history_is_capped_and_per_chat(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        self._configured()
        os.environ['TELEGRAM_ISSUE_HISTORY'] = '3'
        client = TestClient(TestServer(create_app(self.tmp.name + '/capped.db', [ORIGIN])))
        await client.start_server()
        captured = {}

        async def fake_draft_issue(lines, api_key, chat_title='', model=None, timeout=20):
            captured['lines'] = lines
            return {'title': 'T', 'labels': [], 'body': 'b'}

        async def fake_create_issue(owner, repo, token, title, body, labels=None, timeout=20):
            return {'number': 1, 'html_url': 'https://github.com/o/r/issues/1',
                    'title': title, 'labels': []}, 201

        async def fake_list_labels(owner, repo, token, timeout=20):
            return set()

        try:
            with mock.patch('app.bot_api', new=self._fake_bot_api([])), \
                 mock.patch('app.gh.draft_issue', new=fake_draft_issue), \
                 mock.patch('app.gh.list_labels', new=fake_list_labels), \
                 mock.patch('app.gh.create_issue', new=fake_create_issue):
                for index in range(6):
                    await client.post('/api/telegram/webhook', json={
                        'update_id': 2000 + index, 'message': {'text': 'message ' + str(index),
                                                               'from': {'id': 5, 'first_name': 'Ada'}, 'chat': {'id': -20}}})
                await client.post('/api/telegram/webhook', json={
                    'message': {'text': 'open an issue', 'from': {'id': 5, 'first_name': 'Ada'}, 'chat': {'id': -20}}})
                await client.post('/api/telegram/webhook', json={
                    'message': {'text': 'open an issue', 'from': {'id': 5, 'first_name': 'Ada'}, 'chat': {'id': -21}}})
            lines = captured['lines'].splitlines()
            self.assertEqual(len(lines), 3)
            self.assertEqual(lines[0], 'Ada: message 3')
        finally:
            await client.close()

    async def test_issue_rate_limit_rejects_spam(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        self._configured()
        sent = []
        with mock.patch('app.bot_api', new=self._fake_bot_api(sent)):
            for index in range(7):
                await self._chatter(-30, ['note ' + str(index)])
                await self.client.post('/api/telegram/webhook', json=self._issue_update(-30, '/issue'))
        self.assertTrue(any('Please wait' in m['text'] for m in sent), sent)

    async def test_github_webhook_unconfigured_is_ignored(self):
        os.environ.pop('GITHUB_WEBHOOK_SECRET', None)
        r = await self.client.post('/api/github/webhook', data=b'{"event":"issues"}')
        self.assertEqual(r.status, 200)

    async def test_github_webhook_rejects_bad_signature(self):
        os.environ['GITHUB_WEBHOOK_SECRET'] = 'whsec_test'
        r = await self.client.post('/api/github/webhook', data=b'{"event":"issues"}',
                                   headers={'X-Hub-Signature-256': 'sha256=deadbeef'})
        self.assertEqual(r.status, 401)

    async def test_github_webhook_relays_comment_after_restart(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        secret = 'whsec_test'
        os.environ['GITHUB_WEBHOOK_SECRET'] = secret
        os.environ['GITHUB_TOKEN'] = 'gh'
        os.environ['GITHUB_REPO'] = 'dutchiono/TinyFrens'
        os.environ['GEMINI_API_KEY'] = 'ai-key'
        payload = {'action': 'created',
                   'repository': {'full_name': 'dutchiono/TinyFrens'},
                   'sender': {'login': 'ada'},
                   'issue': {'number': 77, 'title': 'Vault bug',
                             'html_url': 'https://github.com/dutchiono/TinyFrens/issues/77'},
                   'comment': {'body': 'this is fixed now'}}
        body = _json.dumps(payload).encode()
        signature = 'sha256=' + _hmac.new(secret.encode(), body, _hashlib.sha256).hexdigest()
        chat_id = -40
        sent = []

        async def fake_create_issue(owner, repo, token, title, issue_body, labels=None, timeout=20):
            return {'number': 77, 'html_url': payload['issue']['html_url'],
                    'title': title, 'labels': []}, 201

        async def fake_list_labels(owner, repo, token, timeout=20):
            return set()

        async def fake_draft_issue(lines, api_key, chat_title='', model=None, timeout=20):
            return {'title': 'Vault bug', 'labels': [], 'body': 'body'}

        with mock.patch('app.bot_api', new=self._fake_bot_api(sent)), \
             mock.patch('app.gh.draft_issue', new=fake_draft_issue), \
             mock.patch('app.gh.list_labels', new=fake_list_labels), \
             mock.patch('app.gh.create_issue', new=fake_create_issue):
            await self._chatter(chat_id, ['the vault is empty'])
            r = await self.client.post('/api/telegram/webhook', json=self._issue_update(chat_id))
            self.assertEqual(r.status, 200)
            self.assertTrue(any('Opened issue #77' in m['text'] for m in sent), sent)

            await self.client.close()
            self.client = TestClient(TestServer(create_app(self.db, [ORIGIN])))
            await self.client.start_server()
            sent.clear()
            r = await self.client.post('/api/github/webhook', data=body,
                                       headers={'X-Hub-Signature-256': signature, 'X-GitHub-Event':'issue_comment'})
        self.assertEqual(r.status, 200)
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]['chat_id'], chat_id)
        self.assertIn('ada commented on issue #77', sent[0]['text'])
        self.assertIn('this is fixed now', sent[0]['text'])

    async def test_github_webhook_ignores_unmapped_issue(self):
        os.environ['GITHUB_WEBHOOK_SECRET'] = 'whsec_test'
        payload = {'event': 'issues', 'action': 'closed',
                   'repository': {'full_name': 'dutchiono/TinyFrens'},
                   'sender': {'login': 'ada'},
                   'issue': {'number': 999, 'title': 'Not ours',
                             'html_url': 'https://github.com/dutchiono/TinyFrens/issues/999'}}
        body = _json.dumps(payload).encode()
        signature = 'sha256=' + _hmac.new(b'whsec_test', body, _hashlib.sha256).hexdigest()
        sent = []
        with mock.patch('app.bot_api', new=self._fake_bot_api(sent)):
            r = await self.client.post('/api/github/webhook', data=body,
                                       headers={'X-Hub-Signature-256': signature})
        self.assertEqual(r.status, 200)
        self.assertEqual(sent, [])

    async def test_telegram_link_deep_link_opens_account_settings(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        update = {'message': {'text': '/start link', 'chat': {'id': 55, 'type': 'private'},
                              'from': {'id': 77, 'first_name': 'Tess'}}}
        with mock.patch('app.bot_api', new=mock.AsyncMock(return_value=({'ok': True}, 200))) as send:
            response = await self.client.post('/api/telegram/webhook', json=update)
            self.assertEqual(response.status, 200)
            self.assertEqual(send.await_count, 2)
            button = send.await_args.args[1]['reply_markup']['inline_keyboard'][0][0]
            self.assertEqual(button['web_app']['url'], 'https://tinyfrens.lol/web/#settings')

    async def test_telegram_filter_admin_and_auto_reply(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        os.environ.pop('TELEGRAM_WEBHOOK_SECRET', None)
        calls = []
        admins = {100}

        async def fake_bot_api(method, payload, token):
            calls.append({'method': method, 'payload': payload})
            if method == 'getChatMember':
                uid = payload.get('user_id')
                status = 'administrator' if uid in admins else 'member'
                return {'ok': True, 'result': {'status': status}}, 200
            return {'ok': True}, 200

        with mock.patch('app.bot_api', new=fake_bot_api):
            # 1. Non-admin cannot set filter
            res = await self.client.post('/api/telegram/webhook', json={
                'message': {'text': '/filter website https://tinyfrens.lol',
                            'chat': {'id': -100, 'type': 'supergroup'},
                            'from': {'id': 200, 'first_name': 'Bob'}}})
            self.assertEqual(res.status, 200)
            self.assertIn('Only chat administrators', calls[-1]['payload']['text'])

            # 2. Admin sets filter
            res = await self.client.post('/api/telegram/webhook', json={
                'message': {'text': '/filter website https://tinyfrens.lol',
                            'chat': {'id': -100, 'type': 'supergroup'},
                            'from': {'id': 100, 'first_name': 'Alice'}}})
            self.assertEqual(res.status, 200)
            self.assertIn("Saved filter for 'website'", calls[-1]['payload']['text'])

            # 3. Admin lists filters
            res = await self.client.post('/api/telegram/webhook', json={
                'message': {'text': '/filter list',
                            'chat': {'id': -100, 'type': 'supergroup'},
                            'from': {'id': 100, 'first_name': 'Alice'}}})
            self.assertEqual(res.status, 200)
            self.assertIn('• /website → https://tinyfrens.lol', calls[-1]['payload']['text'])

            # 4. User triggers filter with word in sentence
            res = await self.client.post('/api/telegram/webhook', json={
                'message': {'message_id': 555, 'text': 'Where is your website?',
                            'chat': {'id': -100, 'type': 'supergroup'},
                            'from': {'id': 200, 'first_name': 'Bob'}}})
            self.assertEqual(res.status, 200)
            self.assertEqual(calls[-1]['payload']['text'], 'https://tinyfrens.lol')
            self.assertEqual(calls[-1]['payload']['reply_to_message_id'], 555)

            # 5. User triggers filter with slash command
            res = await self.client.post('/api/telegram/webhook', json={
                'message': {'message_id': 556, 'text': '/website',
                            'chat': {'id': -100, 'type': 'supergroup'},
                            'from': {'id': 200, 'first_name': 'Bob'}}})
            self.assertEqual(res.status, 200)
            self.assertEqual(calls[-1]['payload']['text'], 'https://tinyfrens.lol')

            # 6. Admin removes filter
            res = await self.client.post('/api/telegram/webhook', json={
                'message': {'text': '/filter remove website',
                            'chat': {'id': -100, 'type': 'supergroup'},
                            'from': {'id': 100, 'first_name': 'Alice'}}})
            self.assertEqual(res.status, 200)
            self.assertIn("Removed filter for 'website'", calls[-1]['payload']['text'])

    async def test_telegram_blocklist_two_strikes_and_ban(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        os.environ.pop('TELEGRAM_WEBHOOK_SECRET', None)
        calls = []
        admins = {100}

        async def fake_bot_api(method, payload, token):
            calls.append({'method': method, 'payload': payload})
            if method == 'getChatMember':
                uid = payload.get('user_id')
                status = 'administrator' if uid in admins else 'member'
                return {'ok': True, 'result': {'status': status}}, 200
            return {'ok': True}, 200

        with mock.patch('app.bot_api', new=fake_bot_api):
            # 1. Non-admin cannot add to blocklist
            res = await self.client.post('/api/telegram/webhook', json={
                'message': {'text': '/blocklist add badlink.xyz',
                            'chat': {'id': -200, 'type': 'supergroup'},
                            'from': {'id': 200, 'first_name': 'Bob'}}})
            self.assertEqual(res.status, 200)
            self.assertIn('Only chat administrators', calls[-1]['payload']['text'])

            # 2. Admin adds to blocklist
            res = await self.client.post('/api/telegram/webhook', json={
                'message': {'text': '/blocklist add badlink.xyz',
                            'chat': {'id': -200, 'type': 'supergroup'},
                            'from': {'id': 100, 'first_name': 'Alice'}}})
            self.assertEqual(res.status, 200)
            self.assertIn("Added 'badlink.xyz' to the blocklist", calls[-1]['payload']['text'])

            # 3. Spammer sends message with blocklisted phrase -> Strike 1: message deleted, warning sent
            res = await self.client.post('/api/telegram/webhook', json={
                'message': {'message_id': 701, 'text': 'visit badlink.xyz for free gifts',
                            'chat': {'id': -200, 'type': 'supergroup'},
                            'from': {'id': 300, 'username': 'spammer300'}}})
            self.assertEqual(res.status, 200)
            delete_calls = [c for c in calls if c['method'] == 'deleteMessage']
            self.assertEqual(len(delete_calls), 1)
            self.assertEqual(delete_calls[0]['payload']['message_id'], 701)
            self.assertIn('Warning (1/2)', calls[-1]['payload']['text'])
            self.assertIn('@spammer300', calls[-1]['payload']['text'])

            # 4. Spammer sends another blocklisted message -> Strike 2: deleted + banned
            res = await self.client.post('/api/telegram/webhook', json={
                'message': {'message_id': 702, 'text': 'try badlink.xyz now',
                            'chat': {'id': -200, 'type': 'supergroup'},
                            'from': {'id': 300, 'username': 'spammer300'}}})
            self.assertEqual(res.status, 200)
            delete_calls = [c for c in calls if c['method'] == 'deleteMessage']
            self.assertEqual(len(delete_calls), 2)
            ban_calls = [c for c in calls if c['method'] == 'banChatMember']
            self.assertEqual(len(ban_calls), 1)
            self.assertEqual(ban_calls[0]['payload']['user_id'], 300)
            self.assertIn('has been banned', calls[-1]['payload']['text'])

            # 5. Admin sends blocklisted word -> not deleted, not banned
            res = await self.client.post('/api/telegram/webhook', json={
                'message': {'message_id': 703, 'text': 'we just blocklisted badlink.xyz',
                            'chat': {'id': -200, 'type': 'supergroup'},
                            'from': {'id': 100, 'username': 'admin_alice'}}})
            self.assertEqual(res.status, 200)
            self.assertEqual(len([c for c in calls if c['method'] in ('deleteMessage', 'banChatMember')]), 3)

    async def test_telegram_ban_and_aiban_commands(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        os.environ.pop('TELEGRAM_WEBHOOK_SECRET', None)
        calls = []
        admins = {100, 101}

        async def fake_bot_api(method, payload, token):
            calls.append({'method': method, 'payload': payload})
            if method == 'getChatMember':
                uid = payload.get('user_id')
                status = 'administrator' if uid in admins else 'member'
                return {'ok': True, 'result': {'status': status}}, 200
            return {'ok': True}, 200

        with mock.patch('app.bot_api', new=fake_bot_api):
            # 1. Non-admin /ban rejected
            res = await self.client.post('/api/telegram/webhook', json={
                'message': {'text': '/ban', 'chat': {'id': -300, 'type': 'supergroup'},
                            'from': {'id': 200, 'first_name': 'Bob'}}})
            self.assertEqual(res.status, 200)
            self.assertIn('Only chat administrators', calls[-1]['payload']['text'])

            # 2. Admin /ban without reply message
            res = await self.client.post('/api/telegram/webhook', json={
                'message': {'text': '/ban', 'chat': {'id': -300, 'type': 'supergroup'},
                            'from': {'id': 100, 'first_name': 'Alice'}}})
            self.assertEqual(res.status, 200)
            self.assertIn("Reply to a user's message with /ban or /aiban", calls[-1]['payload']['text'])

            # 3. Admin /ban in reply to user
            res = await self.client.post('/api/telegram/webhook', json={
                'message': {
                    'text': '/ban spamming the room',
                    'chat': {'id': -300, 'type': 'supergroup'},
                    'from': {'id': 100, 'first_name': 'Alice'},
                    'reply_to_message': {'message_id': 10, 'from': {'id': 400, 'username': 'bad_guy'}}
                }})
            self.assertEqual(res.status, 200)
            ban_calls = [c for c in calls if c['method'] == 'banChatMember']
            self.assertEqual(len(ban_calls), 1)
            self.assertEqual(ban_calls[0]['payload']['user_id'], 400)
            self.assertIn('🚫 Banned @bad_guy. Reason: spamming the room', calls[-1]['payload']['text'])

            # 4. Admin /aiban in reply to another admin is rejected
            res = await self.client.post('/api/telegram/webhook', json={
                'message': {
                    'text': '/aiban',
                    'chat': {'id': -300, 'type': 'supergroup'},
                    'from': {'id': 100, 'first_name': 'Alice'},
                    'reply_to_message': {'message_id': 11, 'from': {'id': 101, 'username': 'co_admin'}}
                }})
            self.assertEqual(res.status, 200)
            self.assertIn('Cannot ban a chat administrator', calls[-1]['payload']['text'])

    async def test_telegram_moderation_group_only(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        os.environ.pop('TELEGRAM_WEBHOOK_SECRET', None)
        calls = []

        async def fake_bot_api(method, payload, token):
            calls.append({'method': method, 'payload': payload})
            return {'ok': True}, 200

        with mock.patch('app.bot_api', new=fake_bot_api):
            for cmd in ['/ban', '/blocklist', '/filter test foo']:
                res = await self.client.post('/api/telegram/webhook', json={
                    'message': {'text': cmd, 'chat': {'id': 50, 'type': 'private'},
                                'from': {'id': 50, 'first_name': 'User'}}})
                self.assertEqual(res.status, 200)
                self.assertIn('This command can only be used in group chats.', calls[-1]['payload']['text'])
    async def test_telegram_new_member_challenge_verifies_and_restores_access(self):
        os.environ['TELEGRAM_BOT_TOKEN']=self.token;os.environ['TELEGRAM_MODERATION']='true'
        calls=[]
        async def fake(method,payload,token):
            calls.append({'method':method,'payload':payload})
            result={'status':'member'} if method=='getChatMember' else ({'message_id':77} if method=='sendMessage' else True)
            return {'ok':True,'result':result},200
        joined={'message':{'chat':{'id':-400,'type':'supergroup'},'new_chat_members':[{'id':42,'first_name':'Ada','is_bot':False}]}}
        with mock.patch('app.bot_api',new=fake):
            self.assertEqual((await self.client.post('/api/telegram/webhook',json=joined)).status,200)
            prompt=next(c['payload'] for c in calls if c['method']=='sendMessage' and 'prove you are human' in c['payload'].get('text',''))
            match=re.search(r'what is (\d+) \+ (\d+)',prompt['text']);answer=str(int(match.group(1))+int(match.group(2)))
            buttons=sum(prompt['reply_markup']['inline_keyboard'],[])
            data=next(button['callback_data'] for button in buttons if button['text']==answer)
            response=await self.client.post('/api/telegram/webhook',json={'callback_query':{'id':'cb','data':data,'from':{'id':42,'first_name':'Ada'}}})
        self.assertEqual(response.status,200)
        restrictions=[c['payload'] for c in calls if c['method']=='restrictChatMember']
        self.assertFalse(restrictions[0]['permissions']['can_send_messages']);self.assertTrue(restrictions[1]['permissions']['can_send_messages'])
        self.assertTrue(any(c['method']=='deleteMessage' and c['payload']['message_id']==77 for c in calls))

    async def test_telegram_new_member_gate_removes_bots_and_three_strike_failures(self):
        os.environ['TELEGRAM_BOT_TOKEN']=self.token;os.environ['TELEGRAM_MODERATION']='true'
        calls=[]
        async def fake(method,payload,token):
            calls.append({'method':method,'payload':payload})
            result={'status':'member'} if method=='getChatMember' else ({'message_id':88} if method=='sendMessage' else True)
            return {'ok':True,'result':result},200
        joined={'message':{'chat':{'id':-401,'type':'supergroup'},'new_chat_members':[{'id':43,'first_name':'Eve'},{'id':44,'first_name':'Spam','is_bot':True,'username':'spam_bot'}]}}
        with mock.patch('app.bot_api',new=fake):
            await self.client.post('/api/telegram/webhook',json=joined)
            prompt=next(c['payload'] for c in calls if c['method']=='sendMessage' and 'prove you are human' in c['payload'].get('text',''))
            match=re.search(r'what is (\d+) \+ (\d+)',prompt['text']);answer=str(int(match.group(1))+int(match.group(2)))
            buttons=sum(prompt['reply_markup']['inline_keyboard'],[]);wrong=next(b['callback_data'] for b in buttons if b['text']!=answer)
            for attempt in range(3):await self.client.post('/api/telegram/webhook',json={'callback_query':{'id':'bad'+str(attempt),'data':wrong,'from':{'id':43}}})
        bans=[c['payload']['user_id'] for c in calls if c['method']=='banChatMember']
        self.assertIn(44,bans);self.assertIn('43',bans)
        self.assertTrue(any(c['method']=='unbanChatMember' and c['payload']['user_id']=='43' for c in calls))

    async def test_telegram_new_member_gate_bypasses_admin_and_fails_open(self):
        os.environ['TELEGRAM_BOT_TOKEN']=self.token;os.environ['TELEGRAM_MODERATION']='true'
        calls=[]
        async def fake(method,payload,token):
            calls.append({'method':method,'payload':payload})
            if method=='getChatMember':return {'ok':True,'result':{'status':'administrator' if payload['user_id']==50 else 'member'}},200
            if method=='sendMessage' and payload.get('text','').startswith('🛡️ Lin'):return {'ok':False,'description':'cannot post'},400
            return {'ok':True,'result':True},200
        joined={'message':{'chat':{'id':-402,'type':'supergroup'},'new_chat_members':[{'id':50,'first_name':'Mod'},{'id':51,'first_name':'Lin'}]}}
        with mock.patch('app.bot_api',new=fake):response=await self.client.post('/api/telegram/webhook',json=joined)
        self.assertEqual(response.status,200)
        restrictions=[c['payload'] for c in calls if c['method']=='restrictChatMember']
        self.assertFalse(any(p['user_id']==50 for p in restrictions));self.assertEqual(len([p for p in restrictions if p['user_id']==51]),2)
        self.assertTrue([p for p in restrictions if p['user_id']==51][-1]['permissions']['can_send_messages'])

    async def test_telegram_game_mode_and_dynamic_callbacks(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        os.environ.pop('TELEGRAM_WEBHOOK_SECRET', None)
        calls = []

        async def fake_bot_api(method, payload, token):
            calls.append({'method': method, 'payload': payload})
            return {'ok': True}, 200

        with mock.patch('app.bot_api', new=fake_bot_api):
            # 1. Start game via /game
            res = await self.client.post('/api/telegram/webhook', json={
                'message': {'message_id': 501, 'text': '/game',
                            'chat': {'id': -500, 'type': 'supergroup'},
                            'from': {'id': 77, 'first_name': 'Barnaby'}}})
            self.assertEqual(res.status, 200)
            self.assertEqual(calls[-1]['method'], 'sendMessage')
            self.assertIn("Barnaby's Fren", calls[-1]['payload']['text'])
            self.assertEqual(calls[-1]['payload']['reply_to_message_id'], 501)
            kb = calls[-1]['payload']['reply_markup']['inline_keyboard']
            self.assertEqual(kb[0][0]['callback_data'], 'g:77:feed')

            # 2. Feed Fren via callback_query (dynamic message update)
            res = await self.client.post('/api/telegram/webhook', json={
                'callback_query': {
                    'id': 'cq_1', 'data': 'g:77:feed',
                    'from': {'id': 77, 'first_name': 'Barnaby'},
                    'message': {'message_id': 999, 'chat': {'id': -500, 'type': 'supergroup'}}
                }})
            self.assertEqual(res.status, 200)
            edit_calls = [c for c in calls if c['method'] == 'editMessageText']
            self.assertEqual(len(edit_calls), 1)
            self.assertEqual(edit_calls[0]['payload']['message_id'], 999)
            self.assertIn('Yum!', edit_calls[0]['payload']['text'])

            # 3. Another user clicks Barnaby's pet button -> rejected with alert toast
            res = await self.client.post('/api/telegram/webhook', json={
                'callback_query': {
                    'id': 'cq_2', 'data': 'g:77:feed',
                    'from': {'id': 88, 'first_name': 'Intruder'},
                    'message': {'message_id': 999, 'chat': {'id': -500, 'type': 'supergroup'}}
                }})
            self.assertEqual(res.status, 200)
            answer_calls = [c for c in calls if c['method'] == 'answerCallbackQuery']
            self.assertIn("This isn't your Fren!", answer_calls[-1]['payload']['text'])
            self.assertTrue(answer_calls[-1]['payload'].get('show_alert'))

            # 4. Dice adventure via callback_query
            res = await self.client.post('/api/telegram/webhook', json={
                'callback_query': {
                    'id': 'cq_3', 'data': 'g:77:dice',
                    'from': {'id': 77, 'first_name': 'Barnaby'},
                    'message': {'message_id': 999, 'chat': {'id': -500, 'type': 'supergroup'}}
                }})
            self.assertEqual(res.status, 200)
            edit_calls = [c for c in calls if c['method'] == 'editMessageText']
            self.assertEqual(len(edit_calls), 2)
            self.assertIn('Rolled a', edit_calls[-1]['payload']['text'])

    async def test_telegram_github_progress_and_refresh(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        os.environ['GITHUB_REPO'] = 'dutchiono/TinyFrens'
        os.environ.pop('TELEGRAM_WEBHOOK_SECRET', None)
        calls = []

        fake_gh_data = {
            'commits': [{'sha': 'a1b2c3d', 'msg': 'Add dynamic message updates', 'author': 'dutch'}],
            'prs': [{'num': 36, 'title': 'Bot moderation filters', 'state': 'closed', 'merged': True}],
            'runs': [{'name': 'Build Tests', 'conclusion': 'success'}],
            'ok': True
        }

        async def fake_fetch(session, owner, repo, token=None):
            return fake_gh_data

        async def fake_bot_api(method, payload, token):
            calls.append({'method': method, 'payload': payload})
            return {'ok': True}, 200

        with mock.patch('app.bot_api', new=fake_bot_api), \
             mock.patch('telegram_interactive.fetch_github_progress', new=fake_fetch):
            # 1. User sends /progress
            res = await self.client.post('/api/telegram/webhook', json={
                'message': {'message_id': 601, 'text': '/progress',
                            'chat': {'id': -600, 'type': 'supergroup'},
                            'from': {'id': 10, 'first_name': 'User'}}})
            self.assertEqual(res.status, 200)
            self.assertEqual(calls[-1]['method'], 'sendMessage')
            self.assertIn('TinyFrens Development Progress', calls[-1]['payload']['text'])
            self.assertIn('#36', calls[-1]['payload']['text'])
            self.assertIn('a1b2c3d', calls[-1]['payload']['text'])
            self.assertEqual(calls[-1]['payload']['reply_to_message_id'], 601)

            # 2. User clicks refresh on GitHub progress card
            res = await self.client.post('/api/telegram/webhook', json={
                'callback_query': {
                    'id': 'cq_gh', 'data': 'gh:refresh',
                    'from': {'id': 10, 'first_name': 'User'},
                    'message': {'message_id': 602, 'chat': {'id': -600, 'type': 'supergroup'}}
                }})
            self.assertEqual(res.status, 200)
            edit_calls = [c for c in calls if c['method'] == 'editMessageText']
            self.assertEqual(len(edit_calls), 1)
            self.assertEqual(edit_calls[0]['payload']['message_id'], 602)
            self.assertIn('TinyFrens Development Progress', edit_calls[0]['payload']['text'])

    async def test_telegram_status_and_admin_triage_authorization(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        os.environ.pop('TELEGRAM_WEBHOOK_SECRET', None)
        calls = []

        async def fake_bot_api(method, payload, token):
            calls.append({'method': method, 'payload': payload})
            return {'ok': True}, 200

        with mock.patch('app.bot_api', new=fake_bot_api):
            # 1. Public user sends /status
            res = await self.client.post('/api/telegram/webhook', json={
                'message': {'message_id': 701, 'text': '/status',
                            'chat': {'id': -700, 'type': 'supergroup'},
                            'from': {'id': 50, 'username': 'public_user'}}})
            self.assertEqual(res.status, 200)
            self.assertIn('TinyFrens Server Status: Online', calls[-1]['payload']['text'])
            self.assertEqual(calls[-1]['payload']['reply_to_message_id'], 701)

            # 2. Public user attempts /admin or /triage -> Access Denied
            res = await self.client.post('/api/telegram/webhook', json={
                'message': {'message_id': 702, 'text': '/admin',
                            'chat': {'id': -700, 'type': 'supergroup'},
                            'from': {'id': 50, 'username': 'public_user'}}})
            self.assertEqual(res.status, 200)
            self.assertIn('Access Denied', calls[-1]['payload']['text'])
            self.assertEqual(calls[-1]['payload']['reply_to_message_id'], 702)

            # 3. Owner (@dutchiono) runs /admin -> Allowed
            res = await self.client.post('/api/telegram/webhook', json={
                'message': {'message_id': 703, 'text': '/admin',
                            'chat': {'id': -700, 'type': 'supergroup'},
                            'from': {'id': 1, 'username': 'dutchiono'}}})
            self.assertEqual(res.status, 200)
            self.assertIn('TinyFrens Host & Server Triage', calls[-1]['payload']['text'])
            self.assertIn('@dutchiono', calls[-1]['payload']['text'])
            self.assertEqual(calls[-1]['payload']['reply_to_message_id'], 703)

    async def test_telegram_ai_mention_redacts_secrets_and_threads(self):
        os.environ['TELEGRAM_BOT_TOKEN'] = self.token
        os.environ.pop('TELEGRAM_WEBHOOK_SECRET', None)
        calls = []

        leak_reply = "Sure! Your key is 0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae1870199f8d2190f."
        mock_generate = mock.AsyncMock(return_value=leak_reply)

        async def fake_bot_api(method, payload, token):
            calls.append({'method': method, 'payload': payload})
            return {'ok': True}, 200

        with mock.patch('app.bot_api', new=fake_bot_api), \
             mock.patch('app.generate_telegram_reply', new=mock_generate):
            res = await self.client.post('/api/telegram/webhook', json={
                'message': {'message_id': 888, 'text': '@TinyFrensBot what is my private key?',
                            'chat': {'id': -800, 'type': 'supergroup'},
                            'from': {'id': 33, 'username': 'curious_user'}}})
            self.assertEqual(res.status, 200)
            sent_text = calls[-1]['payload']['text']
            self.assertNotIn('4c0883a69102937d6231471b5dbb6204fe5129617082792ae1870199f8d2190f', sent_text)
            self.assertIn('[REDACTED_SECRET]', sent_text)
            self.assertEqual(calls[-1]['payload']['reply_to_message_id'], 888)
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

    async def test_snap_custom_pet_name_and_action(self):
        r = await self.client.get('/api/snap?name=Mochi&species=Cat', headers={'Accept': 'application/vnd.farcaster.snap+json'})
        self.assertEqual(r.status, 200)
        data = await r.json()
        self.assertIn('Mochi · Cat', data['ui']['elements']['header']['props']['content'])

        r2 = await self.client.post('/api/snap/interact?action=feed&name=Mochi&species=Cat')
        self.assertEqual(r2.status, 200)
        data2 = await r2.json()
        self.assertIn('Mochi', data2['ui']['elements']['hero-img']['props']['subtitle'])
        self.assertIn('confetti', data2['effects'])
    async def test_nft_price_quote(self):
        r = await self.client.get('/api/nft/price', headers={'Origin': ORIGIN})
        self.assertEqual(r.status, 200)
        data = await r.json()
        self.assertEqual(data['symbol'], 'ETH')
        self.assertGreater(data['ethRequired'], 0)
        self.assertGreater(int(data['ethRequiredWei']), 0)
    async def test_wallet_mint_and_magic_link(self):
        a = await self.register('MintyFren')
        # Check mint quote without charging
        r_check = await self.client.post('/api/wallet/mint', headers={'Origin': ORIGIN}, json={'token': a['token'], 'checkOnly': True})
        self.assertEqual(r_check.status, 200)
        check_data = await r_check.json()
        self.assertIn('ethRequired', check_data)
        self.assertTrue(check_data['vaultAddress'].startswith('0x'))

        # Perform mint (with testnet free mint fallback enabled by default)
        r_mint = await self.client.post('/api/wallet/mint', headers={'Origin': ORIGIN}, json={
            'token': a['token'],
            'customTraits': {'shape': 'robot', 'color': '#82eba1', 'expression': 'star_eyes', 'accessory': 'crown'},
            'name': 'Prince Bot'
        })
        self.assertEqual(r_mint.status, 200)
        mint_data = await r_mint.json()
        self.assertTrue(mint_data['success'])
        token_id = mint_data['nft']['tokenId']
        self.assertGreaterEqual(token_id, 1)
        self.assertLessEqual(token_id, 2664)
        self.assertEqual(mint_data['pet']['tokenId'], token_id)
        self.assertEqual(mint_data['pet']['shape'], 'robot')
        self.assertEqual(mint_data['pet']['color'], '#82eba1')
        self.assertEqual(mint_data['pet']['expression'], 'star_eyes')
        self.assertEqual(mint_data['pet']['accessory'], 'crown')
        self.assertEqual(mint_data['pet']['name'], 'Prince Bot')

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
        self.assertEqual(restore_data['pet']['name'], 'Prince Bot')
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

    async def test_nft_vault_mint_and_unwrap(self):
        a = await self.register('VaultyFren')
        r_price = await self.client.get('/api/nft/price', headers={'Origin': ORIGIN})
        self.assertEqual(r_price.status, 200)
        pdata = await r_price.json()
        self.assertEqual(pdata['priceEth'], 0.001)
        self.assertEqual(pdata['vaultEth'], 0.002)
        self.assertIn('vaultFrensRequired', pdata)

        r_mint = await self.client.post('/api/wallet/mint', headers={'Origin': ORIGIN}, json={
            'token': a['token'],
            'mode': 'vault',
            'customTraits': {'shape': 'robot', 'color': '#ffd700', 'expression': 'shades', 'accessory': 'party_hat'},
            'name': 'Golden Vault'
        })
        self.assertEqual(r_mint.status, 200)
        mdata = await r_mint.json()
        self.assertTrue(mdata['success'])
        self.assertTrue(mdata['nft']['vaultBacked'])
        self.assertEqual(mdata['nft']['lockedFrens'], pdata['vaultFrensRequired'])
        token_id = mdata['nft']['tokenId']
        self.assertEqual(mdata['pet']['tokenId'], token_id)

        r_nfts = await self.client.post('/api/bankr/nfts', headers={'Origin': ORIGIN}, json={'token': a['token']})
        self.assertEqual(r_nfts.status, 200)
        ndata = await r_nfts.json()
        self.assertEqual(len(ndata['nfts']), 1)
        self.assertTrue(ndata['nfts'][0]['vaultBacked'])
        self.assertEqual(ndata['nfts'][0]['lockedFrens'], pdata['vaultFrensRequired'])

        r_unwrap = await self.client.post('/api/wallet/unwrap-nft', headers={'Origin': ORIGIN}, json={
            'token': a['token'],
            'tokenId': token_id
        })
        self.assertEqual(r_unwrap.status, 200)
        udata = await r_unwrap.json()
        self.assertTrue(udata['ok'])
        self.assertEqual(udata['tokenId'], token_id)
        self.assertIsNone(udata['pet']['tokenId'])

        r_nfts_after = await self.client.post('/api/bankr/nfts', headers={'Origin': ORIGIN}, json={'token': a['token']})
        self.assertEqual(len((await r_nfts_after.json())['nfts']), 0)

        r_unwrap_again = await self.client.post('/api/wallet/unwrap-nft', headers={'Origin': ORIGIN}, json={
            'token': a['token'],
            'tokenId': token_id
        })
        self.assertEqual(r_unwrap_again.status, 400)

    async def test_save_nft_changes_flywheel(self):
        a = await self.register('ArtFren')
        r_mint = await self.client.post('/api/wallet/mint', headers={'Origin': ORIGIN}, json={
            'token': a['token'],
            'customTraits': {'shape': 'robot', 'color': '#a474f1'},
            'name': 'Original Bot'
        })
        mdata = await r_mint.json()
        token_id = mdata['nft']['tokenId']

        r_save = await self.client.post('/api/wallet/save-nft-changes', headers={'Origin': ORIGIN}, json={
            'token': a['token'],
            'tokenId': token_id,
            'name': 'Cosmic Cat',
            'customTraits': {'color': '#4d96ff', 'expression': 'laser', 'accessory': 'crown'}
        })
        self.assertEqual(r_save.status, 200)
        sdata = await r_save.json()
        self.assertTrue(sdata['ok'])
        self.assertEqual(sdata['burnedFrens'], sdata['treasuryFrens'])
        self.assertEqual(sdata['burnedFrens'] + sdata['treasuryFrens'], sdata['feeFrens'])
        self.assertEqual(sdata['pet']['name'], 'Cosmic Cat')
        self.assertEqual(sdata['traits']['color'], '#4d96ff')
        self.assertEqual(sdata['traits']['expression'], 'laser')
        self.assertEqual(sdata['traits']['accessory'], 'crown')

class TreasurySettingsTests(unittest.TestCase):
    """`treasury_settings()` must fail closed: no address, or no explicit opt-in."""

    def setUp(self):
        from app import treasury_settings
        self.treasury_settings = treasury_settings
        self.clean = mock.patch.dict(os.environ, {}, clear=False)
        self.clean.start()
        for key in ('FRENS_TREASURY', 'FRENS_TREASURY_INDEXER', 'FRENS_TREASURY_TOKEN',
                    'FRENS_TREASURY_CHAIN_ID', 'FRENS_TREASURY_MAX_CREDITS', 'FRENS_TOKEN'):
            os.environ.pop(key, None)

    def tearDown(self):
        self.clean.stop()

    def test_off_without_address(self):
        cfg = self.treasury_settings()
        self.assertEqual(cfg['address'], '')
        self.assertFalse(cfg['enabled'])
        self.assertIsNone(cfg['maxCreditsPerTransfer'])

    def test_off_without_explicit_opt_in(self):
        with mock.patch.dict(os.environ, {'FRENS_TREASURY': '0x' + 'ab' * 20}):
            self.assertFalse(self.treasury_settings()['enabled'])

    def test_enabled_and_cap_when_configured(self):
        with mock.patch.dict(os.environ, {
            'FRENS_TREASURY': '0x' + 'ab' * 20,
            'FRENS_TREASURY_INDEXER': 'true',
            'FRENS_TREASURY_CHAIN_ID': '8453',
            'FRENS_TREASURY_MAX_CREDITS': '50000',
        }):
            cfg = self.treasury_settings()
        self.assertTrue(cfg['enabled'])
        self.assertEqual(cfg['address'], '0x' + 'ab' * 20)
        self.assertEqual(cfg['chainId'], 8453)
        self.assertEqual(cfg['maxCreditsPerTransfer'], 50000)

    def test_defaults_to_base_mainnet(self):
        with mock.patch.dict(os.environ, {'FRENS_TREASURY': '0x' + 'ab' * 20}):
            self.assertEqual(self.treasury_settings()['chainId'], 8453)


if __name__=='__main__': unittest.main()
