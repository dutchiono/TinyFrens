"""TinyFrens relay: private device credentials, friend consent, live guest visits."""
import asyncio, hashlib, json, os, re, secrets, sqlite3, time
from collections import defaultdict, deque
from aiohttp import web, WSMsgType, ClientSession, ClientTimeout

SHAPES = {'cat', 'blob', 'robot', 'bunny', 'dog', 'bear', 'frog', 'turtle'}
GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
BANKR_URL = 'https://api.bankr.bot'

def profile(raw):
    if not isinstance(raw, dict): raise ValueError('Invalid pet')
    if raw.get('shape')=='mascot': raw={**raw,'shape':'robot'}
    name = re.sub(r'\s+', ' ', re.sub(r'[\x00-\x1f\x7f]', '', str(raw.get('name', '')))).strip()[:20]
    if not name or raw.get('shape') not in SHAPES or not re.fullmatch(r'#[a-fA-F0-9]{6}', str(raw.get('color', ''))):
        raise ValueError('Invalid pet')
    res = dict(name=name, shape=raw['shape'], color=raw['color'])
    if raw.get('expression'): res['expression'] = str(raw['expression'])[:20]
    if raw.get('accessory'): res['accessory'] = str(raw['accessory'])[:20]
    if raw.get('tokenId') is not None:
        try: res['tokenId'] = int(raw['tokenId'])
        except (ValueError, TypeError): pass
    return res

def create_app(database=None, origins=None):
    db = sqlite3.connect(database or os.environ.get('DB_PATH', 'tinyfrens.db'))
    db.executescript('''CREATE TABLE IF NOT EXISTS pets(id TEXT PRIMARY KEY, code TEXT UNIQUE, token TEXT UNIQUE, profile TEXT);
    CREATE TABLE IF NOT EXISTS friends(a TEXT, b TEXT, PRIMARY KEY(a,b));
    CREATE TABLE IF NOT EXISTS requests(sender TEXT, receiver TEXT, PRIMARY KEY(sender,receiver));
    CREATE TABLE IF NOT EXISTS pet_wallets(pet_id TEXT PRIMARY KEY, provider TEXT, wallet_id TEXT, evm_address TEXT, sol_address TEXT, api_key TEXT, nft TEXT, created INTEGER);''')
    allowed = set(origins or os.environ.get('ALLOWED_ORIGINS', 'https://tinyfrens.lol,https://www.tinyfrens.lol').split(','))
    if os.environ.get('ALLOW_NATIVE_ORIGIN') == 'true': allowed.add('null')
    sockets, visits, pending, rooms, room_by_pet, rates = {}, {}, {}, defaultdict(dict), {}, defaultdict(deque)
    now = time.time
    def limit(key, maximum, seconds):
        q=rates[key]; t=now()
        while q and q[0]<t-seconds: q.popleft()
        if len(q)>=maximum: raise ValueError('Please wait before trying again')
        q.append(t)
    def pet(pid):
        row=db.execute('SELECT code,profile FROM pets WHERE id=?',(pid,)).fetchone()
        return dict(id=pid,code=row[0],pet=json.loads(row[1]),online=pid in sockets)
    def token_pet(token):
        if not isinstance(token,str) or len(token)>200: raise ValueError('Device credential not recognized')
        row=db.execute('SELECT id FROM pets WHERE token=?',(hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
        if not row: raise ValueError('Device credential not recognized')
        return row[0]
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
    async def room_state(room):
        if room not in rooms: return
        members=[dict(id=pid,pet=data['pet']) for pid,data in rooms[room].items()]
        public=room=='public'
        code='' if public else room.split(':',1)[1]
        for pid in list(rooms[room]):
            await send(pid,dict(type='party-state',room='public' if public else 'private',code=code,members=members))
    async def leave_room(pid):
        room=room_by_pet.pop(pid,None)
        if room and pid in rooms.get(room,{}):
            rooms[room].pop(pid,None)
            if rooms[room]: await room_state(room)
            else: rooms.pop(room,None)
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
    async def chat(request):
        try:
            ip=request.headers.get('X-Forwarded-For',request.remote or '?') if os.environ.get('TRUST_PROXY')=='true' else request.remote or '?'
            limit(('chat',ip),30,3600)
            body=await request.json()
            p=profile(body.get('pet'))
            message=re.sub(r'\s+',' ',re.sub(r'[\x00-\x1f\x7f]','',str(body.get('message','')))).strip()
            if not 1<=len(message)<=400: raise ValueError('Say a little something first')
            api_key=os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')
            if not api_key: return web.json_response({'error':'Pet chat is not connected yet'},status=503)
            model=os.environ.get('GEMINI_MODEL','gemini-2.0-flash')
            system=('You are a TinyFren: a tiny, warm, playful pocket-pet companion. '
                    'Reply in one or two short sentences. No markdown. No financial advice, trading instructions, '
                    'private-key handling, seed phrases, or promises about prices. If wallet or token data is missing, say so gently.')
            prompt=f"Pet name: {p['name']}. Pet shape: {p['shape']}. User says: {message}"
            payload={'systemInstruction':{'parts':[{'text':system}]},'contents':[{'role':'user','parts':[{'text':prompt}]}],
                     'generationConfig':{'temperature':0.8,'maxOutputTokens':120}}
            timeout=ClientTimeout(total=18)
            async with ClientSession(timeout=timeout) as session:
                async with session.post(GEMINI_URL.format(model=model),headers={'x-goog-api-key':api_key},json=payload) as response:
                    data=await response.json(content_type=None)
                    if response.status>=400: raise ValueError('Pet chat is having trouble right now')
            parts=data.get('candidates',[{}])[0].get('content',{}).get('parts',[])
            reply=' '.join(str(part.get('text','')) for part in parts).strip()
            reply=re.sub(r'[*_`#>\[\]]','',reply)
            if not reply: reply=p['name']+' blinks, thinking very hard.'
            return web.json_response({'reply':reply[:500]})
        except (ValueError,KeyError,TypeError,json.JSONDecodeError,asyncio.TimeoutError):
            return web.json_response({'error':'Pet chat is having trouble right now'},status=400)
    async def bankr_status(request):
        return web.json_response({'connected':bool(os.environ.get('BANKR_API_KEY')),'partner':bool(os.environ.get('BANKR_PARTNER_KEY'))})
    async def bankr_wallet(request):
        try:
            ip=request.headers.get('X-Forwarded-For',request.remote or '?') if os.environ.get('TRUST_PROXY')=='true' else request.remote or '?'
            limit(('bankr-wallet',ip),20,3600)
            body=await request.json()
            pid=token_pet(body.get('token'))
            if body.get('pet') is not None:
                p=profile(body.get('pet')); db.execute('UPDATE pets SET profile=? WHERE id=?',(json.dumps(p),pid)); db.commit()
            row=db.execute('SELECT provider,wallet_id,evm_address,sol_address,api_key FROM pet_wallets WHERE pet_id=?',(pid,)).fetchone()
            if row:
                return web.json_response({'mode':row[0],'walletId':row[1],'evmAddress':row[2],'solAddress':row[3],'partner':row[0]=='bankr-partner'})
            bankr_base=os.environ.get('BANKR_API_URL',BANKR_URL).rstrip('/')
            partner_key=os.environ.get('BANKR_PARTNER_KEY')
            timeout=ClientTimeout(total=20)
            if partner_key:
                async with ClientSession(timeout=timeout) as session:
                    payload={'idempotencyKey':'tinyfrens:'+pid,'wallet':{'solana':False},'apiKey':{'permissions':{'agentApiEnabled':True,'llmGatewayEnabled':False,'tokenLaunchApiEnabled':False,'readOnly':False}}}
                    async with session.post(bankr_base+'/partner/wallets',headers={'Content-Type':'application/json','X-Partner-Key':partner_key},json=payload) as response:
                        data=await response.json(content_type=None)
                        if response.status>=400: return web.json_response({'error':data.get('message') or data.get('error') or 'Bankr could not create a fren wallet'},status=response.status)
                db.execute('INSERT OR REPLACE INTO pet_wallets VALUES(?,?,?,?,?,?,?,?)',(pid,'bankr-partner',data.get('id',''),data.get('evmAddress',''),data.get('solAddress',''),data.get('apiKey',''),None,int(now())))
                db.commit()
                return web.json_response({'mode':'bankr-partner','walletId':data.get('id',''),'evmAddress':data.get('evmAddress',''),'solAddress':data.get('solAddress',''),'partner':True})
            api_key=os.environ.get('BANKR_API_KEY')
            if not api_key: return web.json_response({'error':'Bankr is not connected yet'},status=503)
            async with ClientSession(timeout=timeout) as session:
                async with session.get(bankr_base+'/wallet/me',headers={'X-API-Key':api_key}) as response:
                    data=await response.json(content_type=None)
                    if response.status>=400: return web.json_response({'error':data.get('message') or data.get('error') or 'Bankr wallet is unavailable'},status=response.status)
            evm=next((w.get('address') for w in data.get('wallets',[]) if w.get('chain')=='evm'),None)
            sol=next((w.get('address') for w in data.get('wallets',[]) if w.get('chain')=='solana'),None)
            return web.json_response({'mode':'server-agent','walletId':'server-bankr-wallet','evmAddress':evm or '','solAddress':sol or '','partner':False,'message':'Using the server Bankr wallet until per-fren partner wallets are enabled.'})
        except (ValueError,KeyError,TypeError,json.JSONDecodeError,asyncio.TimeoutError) as e:
            return web.json_response({'error':str(e) or 'Bankr wallet is having trouble right now'},status=400)
    def nft_traits(nft):
        seed=':'.join(str(nft.get(k,'')) for k in ('chain','tokenId','name'))+':'+str((nft.get('collection') or {}).get('address',''))
        digest=hashlib.sha256(seed.encode()).digest()
        shapes=['cat','blob','robot','bunny','dog','bear','frog','turtle'];colors=['#a474f1','#66c7d2','#ffb95e','#82eba1','#ff82a7','#4d96ff','#2ecc71','#ff7675']
        exprs=['joyful','wink','shades','star_eyes','sleepy','loving','laser','grin'];accs=['none','party_hat','crown','straw_hat','halo','beanie','strawberry','orb','bubble','bow_tie']
        return {'shape':shapes[digest[0]%len(shapes)],'color':colors[digest[1]%len(colors)],'expression':exprs[digest[2]%len(exprs)],'accessory':accs[digest[3]%len(accs)]}
    async def wallet_api_key(pid):
        row=db.execute('SELECT api_key FROM pet_wallets WHERE pet_id=?',(pid,)).fetchone()
        return row[0] if row and row[0] else os.environ.get('BANKR_API_KEY')
    async def bankr_nfts(request):
        try:
            ip=request.headers.get('X-Forwarded-For',request.remote or '?') if os.environ.get('TRUST_PROXY')=='true' else request.remote or '?'
            limit(('bankr-nfts',ip),30,3600)
            body=await request.json(); pid=token_pet(body.get('token')); api_key=await wallet_api_key(pid)
            if not api_key: return web.json_response({'error':'Bankr is not connected yet'},status=503)
            bankr_base=os.environ.get('BANKR_API_URL',BANKR_URL).rstrip('/')
            async with ClientSession(timeout=ClientTimeout(total=25)) as session:
                async with session.get(bankr_base+'/wallet/portfolio?include=nfts',headers={'X-API-Key':api_key}) as response:
                    data=await response.json(content_type=None)
                    if response.status>=400: return web.json_response({'error':data.get('message') or data.get('error') or 'Could not read fren NFTs'},status=response.status)
            return web.json_response({'nfts':data.get('nfts',[])})
        except (ValueError,KeyError,TypeError,json.JSONDecodeError,asyncio.TimeoutError) as e:
            return web.json_response({'error':str(e) or 'Could not read fren NFTs'},status=400)
    async def bankr_transform(request):
        try:
            ip=request.headers.get('X-Forwarded-For',request.remote or '?') if os.environ.get('TRUST_PROXY')=='true' else request.remote or '?'
            limit(('bankr-transform',ip),30,3600)
            body=await request.json(); pid=token_pet(body.get('token')); nft=body.get('nft')
            if not isinstance(nft,dict): raise ValueError('Choose an NFT first')
            name=re.sub(r'\s+',' ',re.sub(r'[\x00-\x1f\x7f]','',str(nft.get('name') or 'NFT Fren'))).strip()[:20] or 'NFT Fren'
            current=pet(pid)['pet']; traits=nft_traits(nft)
            transformed={**current,**traits,'name':name}
            if nft.get('tokenId') is not None:
                try: transformed['tokenId']=int(str(nft.get('tokenId')).split('.')[0])
                except ValueError: pass
            db.execute('UPDATE pets SET profile=? WHERE id=?',(json.dumps(transformed),pid))
            if db.execute('SELECT 1 FROM pet_wallets WHERE pet_id=?',(pid,)).fetchone():
                db.execute('UPDATE pet_wallets SET nft=? WHERE pet_id=?',(json.dumps(nft),pid))
            else:
                db.execute('INSERT INTO pet_wallets VALUES(?,?,?,?,?,?,?,?)',(pid,'server-agent','','','',os.environ.get('BANKR_API_KEY',''),json.dumps(nft),int(now())))
            db.commit()
            return web.json_response({'pet':transformed,'nft':nft})
        except (ValueError,KeyError,TypeError,json.JSONDecodeError) as e:
            return web.json_response({'error':str(e) or 'Could not transform your fren'},status=400)
    async def bankr_monitor(request):
        try:
            ip=request.headers.get('X-Forwarded-For',request.remote or '?') if os.environ.get('TRUST_PROXY')=='true' else request.remote or '?'
            limit(('bankr',ip),12,3600)
            api_key=os.environ.get('BANKR_API_KEY')
            if not api_key: return web.json_response({'error':'Bankr is not connected yet'},status=503)
            body=await request.json()
            p=profile(body.get('pet'))
            wallet=re.sub(r'\s+','',str(body.get('wallet',''))).strip()
            question=re.sub(r'\s+',' ',re.sub(r'[\x00-\x1f\x7f]','',str(body.get('question','')))).strip()[:300]
            if not 4<=len(wallet)<=120 or not re.fullmatch(r'[A-Za-z0-9:._-]+',wallet): raise ValueError('Enter a wallet address first')
            if not question: question='Give me a quick read on this wallet today.'
            prompt=(
                'You are Bankr being used inside TinyFrens, a tiny pet app. This is read-only wallet monitoring. '
                'Do not trade, swap, transfer, sign, deploy, or ask for private keys. Do not give financial advice. '
                f"Pet name: {p['name']}. Public wallet/address to monitor: {wallet}. "
                f"User request: {question}. "
                'Answer in a compact TinyFrens style: first say whether the day looks green, red, or quiet if data supports it, '
                'then mention the most important wallet signal at a glance. Keep it under 90 words.'
            )
            bankr_base=os.environ.get('BANKR_API_URL',BANKR_URL).rstrip('/')
            timeout=ClientTimeout(total=35)
            async with ClientSession(timeout=timeout) as session:
                headers={'Content-Type':'application/json','X-API-Key':api_key}
                async with session.post(bankr_base+'/agent/prompt',headers=headers,json={'prompt':prompt}) as response:
                    data=await response.json(content_type=None)
                    if response.status>=400: return web.json_response({'error':data.get('message') or data.get('error') or 'Bankr is unavailable'},status=response.status)
                job_id=data.get('jobId');thread_id=data.get('threadId')
                if not job_id: return web.json_response({'error':'Bankr did not return a job id'},status=400)
                result=data
                for _ in range(14):
                    await asyncio.sleep(2)
                    async with session.get(bankr_base+'/agent/job/'+str(job_id),headers={'X-API-Key':api_key}) as response:
                        result=await response.json(content_type=None)
                        if response.status>=400: return web.json_response({'error':result.get('message') or result.get('error') or 'Bankr is unavailable'},status=response.status)
                    if result.get('status') in ('completed','failed','cancelled'): break
                if result.get('status')!='completed':
                    return web.json_response({'pending':True,'jobId':job_id,'threadId':thread_id,'reply':'Bankr is still thinking. Try again in a moment.'})
            reply=str(result.get('response') or result.get('message') or '').strip()
            rich=result.get('richData')
            if not reply and isinstance(rich,dict): reply=str(rich.get('summary') or rich.get('text') or '').strip()
            reply=re.sub(r'[*_`#>\[\]]','',reply)[:900]
            if not reply: reply='Bankr finished, but did not return a readable wallet note.'
            return web.json_response({'reply':reply,'wallet':wallet,'jobId':job_id,'threadId':thread_id})
        except (ValueError,KeyError,TypeError,json.JSONDecodeError,asyncio.TimeoutError) as e:
            return web.json_response({'error':str(e) or 'Bankr is having trouble right now'},status=400)
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
                        if pid in room_by_pet:
                            rooms[room_by_pet[pid]][pid]=dict(pet=p,updated=now())
                            await room_state(room_by_pet[pid])
                    elif typ=='party-join':
                        limit(('party',pid),20,3600)
                        p=profile(m.get('pet'))
                        mode=str(m.get('room','public')).lower()
                        if mode=='public': room='public'
                        elif mode=='private':
                            code=re.sub(r'[^A-Z0-9-]','',str(m.get('code','')).upper())[:24]
                            if not 3<=len(code)<=24: raise ValueError('Enter a party code')
                            room='private:'+code
                        else: raise ValueError('Unknown party room')
                        if len(rooms[room])>=80: raise ValueError('That party room is full')
                        await leave_room(pid)
                        room_by_pet[pid]=room;rooms[room][pid]=dict(pet=p,updated=now())
                        await room_state(room)
                    elif typ=='party-leave':
                        await leave_room(pid)
                        await send(pid,dict(type='party-state',room='none',code='',members=[]))
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
                await leave_room(pid)
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
    app.router.add_post('/api/register',register);app.router.add_post('/api/chat',chat);app.router.add_get('/api/bankr/status',bankr_status);app.router.add_post('/api/bankr/wallet',bankr_wallet);app.router.add_post('/api/bankr/nfts',bankr_nfts);app.router.add_post('/api/bankr/transform',bankr_transform);app.router.add_post('/api/bankr/monitor',bankr_monitor);app.router.add_get('/ws',websocket)
    app.router.add_route('OPTIONS','/{path:.*}',options)
    return app

if __name__=='__main__': web.run_app(create_app(),host=os.environ.get('HOST','0.0.0.0'),port=int(os.environ.get('PORT','8080')),access_log=None)
