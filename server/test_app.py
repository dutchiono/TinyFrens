import asyncio, tempfile, unittest
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
