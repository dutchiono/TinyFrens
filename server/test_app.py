import asyncio, os, tempfile, unittest
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
        r=await self.client.post('/api/chat',headers={'Origin':ORIGIN},json={'message':'hi','pet':{'name':'Beep','shape':'robot','color':'#a474f1'}})
        self.assertEqual(r.status,503)
        self.assertEqual((await r.json())['error'],'Pet chat is not connected yet')
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
            self.assertEqual(r.status,503)
            self.assertEqual((await r.json())['error'],'Bankr is not connected yet')
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

if __name__=='__main__': unittest.main()
