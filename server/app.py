"""TinyFrens relay: private device credentials, friend consent, live guest visits."""
import asyncio, hashlib, json, os, re, secrets, sqlite3, time
from collections import defaultdict, deque
from aiohttp import web, WSMsgType

SHAPES = {'cat', 'blob', 'robot'}

def profile(raw):
    if not isinstance(raw, dict): raise ValueError('Invalid pet')
    if raw.get('shape')=='mascot': raw={**raw,'shape':'robot'}
    name = re.sub(r'\s+', ' ', re.sub(r'[\x00-\x1f\x7f]', '', str(raw.get('name', '')))).strip()[:20]
    if not name or raw.get('shape') not in SHAPES or not re.fullmatch(r'#[a-fA-F0-9]{6}', str(raw.get('color', ''))):
        raise ValueError('Invalid pet')
    return dict(name=name, shape=raw['shape'], color=raw['color'])

def create_app(database=None, origins=None):
    db = sqlite3.connect(database or os.environ.get('DB_PATH', 'tinyfrens.db'))
    db.executescript('''CREATE TABLE IF NOT EXISTS pets(id TEXT PRIMARY KEY, code TEXT UNIQUE, token TEXT UNIQUE, profile TEXT);
    CREATE TABLE IF NOT EXISTS friends(a TEXT, b TEXT, PRIMARY KEY(a,b));
    CREATE TABLE IF NOT EXISTS requests(sender TEXT, receiver TEXT, PRIMARY KEY(sender,receiver));''')
    allowed = set(origins or os.environ.get('ALLOWED_ORIGINS', 'https://dutchiono.github.io').split(','))
    if os.environ.get('ALLOW_NATIVE_ORIGIN') == 'true': allowed.add('null')
    sockets, visits, pending, rates = {}, {}, {}, defaultdict(deque)
    now = time.time
    def limit(key, maximum, seconds):
        q=rates[key]; t=now()
        while q and q[0]<t-seconds: q.popleft()
        if len(q)>=maximum: raise ValueError('Please wait before trying again')
        q.append(t)
    def pet(pid):
        row=db.execute('SELECT code,profile FROM pets WHERE id=?',(pid,)).fetchone()
        return dict(id=pid,code=row[0],pet=json.loads(row[1]),online=pid in sockets)
    def paired(a,b): return db.execute('SELECT 1 FROM friends WHERE a=? AND b=?',(a,b)).fetchone() is not None
    async def send(pid, data):
        ws=sockets.get(pid)
        if ws and not ws.closed: await ws.send_json(data)
    async def state(pid):
        friends=[pet(r[0]) for r in db.execute('SELECT b FROM friends WHERE a=?',(pid,))]
        requests=[pet(r[0]) for r in db.execute('SELECT sender FROM requests WHERE receiver=?',(pid,))]
        await send(pid,dict(type='state',self=pet(pid),friends=friends,requests=requests))
    async def end(vid):
        v=visits.pop(vid,None)
        if v:
            for p in (v['sender'],v['receiver']): await send(p,dict(type='visit-ended',id=vid))
    @web.middleware
    async def origin_guard(request, handler):
        origin=request.headers.get('Origin')
        if request.path!='/health' and origin not in allowed: raise web.HTTPForbidden(text='Origin not allowed')
        if request.method=='OPTIONS': response=web.Response()
        else: response=await handler(request)
        if origin in allowed and not isinstance(response,web.WebSocketResponse):
            response.headers.update({'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, GET, OPTIONS','Cache-Control':'no-store'})
        return response
    async def register(request):
        try:
            # Behind Caddy, only its trusted proxy header is used when explicitly configured.
            ip=request.headers.get('X-Forwarded-For',request.remote or '?') if os.environ.get('TRUST_PROXY')=='true' else request.remote or '?'
            limit(('register',ip),10,3600)
            p=profile((await request.json())['pet']); pid=secrets.token_hex(16); token=secrets.token_urlsafe(32)
            alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
            while True:
                code=''.join(secrets.choice(alphabet) for _ in range(8))
                if not db.execute('SELECT 1 FROM pets WHERE code=?',(code,)).fetchone(): break
            db.execute('INSERT INTO pets VALUES(?,?,?,?)',(pid,code,hashlib.sha256(token.encode()).hexdigest(),json.dumps(p))); db.commit()
            return web.json_response(dict(id=pid,token=token,code=code))
        except (ValueError,KeyError,TypeError,json.JSONDecodeError) as e: return web.json_response({'error':str(e)},status=400)
    async def websocket(request):
        try: limit(('connect',request.remote or '?'),60,60)
        except ValueError: raise web.HTTPTooManyRequests()
        ws=web.WebSocketResponse(heartbeat=30,max_msg_size=4096); await ws.prepare(request); pid=None
        try:
            first=await asyncio.wait_for(ws.receive_json(),10)
            token=first.get('token','')
            if first.get('type')!='auth' or not isinstance(token,str) or len(token)>200: raise ValueError('Please reconnect')
            row=db.execute('SELECT id FROM pets WHERE token=?',(hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
            if not row: raise ValueError('Device credential not recognized')
            pid=row[0]
            if pid in sockets: await sockets[pid].close(code=4001,message=b'Opened on another screen')
            sockets[pid]=ws; await state(pid)
            for (other,) in db.execute('SELECT b FROM friends WHERE a=?',(pid,)).fetchall(): await state(other)
            async for message in ws:
                if message.type!=WSMsgType.TEXT: break
                try:
                    limit(('messages',pid),120,60); m=json.loads(message.data)
                    if not isinstance(m,dict): raise ValueError('Invalid message')
                    typ=m.get('type')
                    if typ=='profile':
                        p=profile(m.get('pet')); db.execute('UPDATE pets SET profile=? WHERE id=?',(json.dumps(p),pid)); db.commit()
                        for (other,) in db.execute('SELECT b FROM friends WHERE a=?',(pid,)).fetchall(): await state(other)
                        for vid,v in list(visits.items()):
                            if v['sender']==pid: await send(v['receiver'],dict(type='visit-profile',id=vid,pet=p))
                    elif typ=='friend-request':
                        limit(('requests',pid),15,3600); code=str(m.get('code','')).replace('-','').replace(' ','').upper()
                        row=db.execute('SELECT id FROM pets WHERE code=?',(code,)).fetchone()
                        if not row or row[0]==pid: raise ValueError('Check your friend’s code')
                        other=row[0]
                        if paired(pid,other): raise ValueError('Already friends')
                        if db.execute('SELECT count(*) FROM requests WHERE receiver=?',(other,)).fetchone()[0]>=30: raise ValueError('Try again later')
                        db.execute('INSERT OR IGNORE INTO requests VALUES(?,?)',(pid,other));db.commit();await state(other);await send(pid,dict(type='notice',text='Friend request sent. They need to accept.'))
                    elif typ=='friend-answer':
                        other=str(m.get('id',''))
                        if not db.execute('SELECT 1 FROM requests WHERE sender=? AND receiver=?',(other,pid)).fetchone(): raise ValueError('Request no longer available')
                        if m.get('accept') is True:
                            for person in (pid,other):
                                if db.execute('SELECT count(*) FROM friends WHERE a=?',(person,)).fetchone()[0]>=100: raise ValueError('Friends list is full')
                            for a,b in ((pid,other),(other,pid)): db.execute('INSERT OR IGNORE INTO friends VALUES(?,?)',(a,b))
                        db.execute('DELETE FROM requests WHERE (sender=? AND receiver=?) OR (sender=? AND receiver=?)',(other,pid,pid,other));db.commit();await state(pid);await state(other)
                    elif typ=='friend-remove':
                        other=str(m.get('id',''));db.execute('DELETE FROM friends WHERE (a=? AND b=?) OR (a=? AND b=?)',(pid,other,other,pid));db.commit()
                        for vid,v in list(visits.items()):
                            if set((v['sender'],v['receiver']))==set((pid,other)): await end(vid)
                        for vid,v in list(pending.items()):
                            if set((v['sender'],v['receiver']))==set((pid,other)): pending.pop(vid,None)
                        await state(pid);await state(other)
                    elif typ=='visit-request':
                        limit(('visits',pid),12,60); other=str(m.get('id',''))
                        if not paired(pid,other) or other not in sockets: raise ValueError('Your friend needs to open TinyFrens first')
                        if any(pid in (v['sender'],v['receiver']) or other in (v['sender'],v['receiver']) for v in [*visits.values(),*pending.values()]): raise ValueError('Finish the current visit first')
                        vid=secrets.token_hex(12);pending[vid]=dict(sender=pid,receiver=other,expires=now()+60)
                        await send(other,dict(type='visit-request',id=vid,friend=pet(pid)));await send(pid,dict(type='notice',text='Visit requested. Waiting for your friend.'))
                    elif typ=='visit-answer':
                        vid=str(m.get('id',''));v=pending.get(vid)
                        if not v or v['receiver']!=pid or v['expires']<now(): raise ValueError('Visit request expired')
                        pending.pop(vid)
                        if m.get('accept') is True and v['sender'] in sockets and paired(pid,v['sender']):
                            v['expires']=now()+1800;visits[vid]=v
                            await send(pid,dict(type='visit-start',id=vid,role='host',pet=pet(v['sender'])['pet'],expires=int(v['expires']*1000)))
                            await send(v['sender'],dict(type='visit-start',id=vid,role='visitor',friend=pet(pid),expires=int(v['expires']*1000)))
                        else: await send(v['sender'],dict(type='notice',text='Not visiting right now.'))
                    elif typ=='visit-end':
                        vid=str(m.get('id',''));v=visits.get(vid)
                        if not v or pid not in (v['sender'],v['receiver']): raise ValueError('Visit no longer available')
                        await end(vid)
                    elif typ=='visit-action':
                        v=visits.get(str(m.get('id','')));action=m.get('action')
                        if not v or pid not in (v['sender'],v['receiver']) or action not in ('wave','dance'): raise ValueError('Invalid visit action')
                        for p in (v['sender'],v['receiver']): await send(p,dict(type='visit-action',id=m['id'],action=action))
                    else: raise ValueError('Unknown action')
                except (ValueError,TypeError,KeyError,json.JSONDecodeError) as e: await ws.send_json(dict(type='error',text=str(e)))
        except (ValueError,TypeError,AttributeError,asyncio.TimeoutError,json.JSONDecodeError):
            await ws.close(code=4003,message=b'Authentication failed')
        finally:
            if pid and sockets.get(pid) is ws:
                sockets.pop(pid,None)
                for vid,v in list(visits.items()):
                    if pid in (v['sender'],v['receiver']): await end(vid)
                for vid,v in list(pending.items()):
                    if pid in (v['sender'],v['receiver']): pending.pop(vid,None)
                for (other,) in db.execute('SELECT b FROM friends WHERE a=?',(pid,)).fetchall(): await state(other)
        return ws
    async def lifetime(app):
        async def cleanup():
            while True:
                await asyncio.sleep(5)
                for vid,v in list(visits.items()):
                    if v['expires']<now(): await end(vid)
                for vid,v in list(pending.items()):
                    if v['expires']<now():
                        pending.pop(vid,None)
                        for p in (v['sender'],v['receiver']): await send(p,dict(type='visit-request-ended',id=vid))
                for k,q in list(rates.items()):
                    if not q or q[-1]<now()-3600: rates.pop(k,None)
        task=asyncio.create_task(cleanup());yield
        task.cancel()
        try: await task
        except asyncio.CancelledError: pass
        for ws in list(sockets.values()): await ws.close(code=1001,message=b'Server stopping')
        db.close()
    app=web.Application(middlewares=[origin_guard],client_max_size=4096)
    app.cleanup_ctx.append(lifetime)
    async def health(request): return web.json_response({'ok':True})
    async def options(request): return web.Response()
    app.router.add_get('/health',health)
    app.router.add_post('/api/register',register);app.router.add_get('/ws',websocket)
    app.router.add_route('OPTIONS','/{path:.*}',options)
    return app

if __name__=='__main__': web.run_app(create_app(),host='0.0.0.0',port=int(os.environ.get('PORT','8080')),access_log=None)
