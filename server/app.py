"""TinyFrens relay: private device credentials, friend consent, live guest visits."""
import asyncio, hashlib, json, os, re, secrets, sqlite3, time
from collections import defaultdict, deque
from aiohttp import web, WSMsgType, ClientSession, ClientTimeout
import economy as economy_ledger
try:
    from telegram_integration import validate_init_data, user_profile, bot_api, reply_markup, classify
    from discord_integration import verify_interaction, exchange_code
except Exception:  # pragma: no cover - integration modules always ship together
    validate_init_data = user_profile = bot_api = reply_markup = classify = None
    verify_interaction = exchange_code = None

SHAPES = {'cat', 'blob', 'robot', 'bunny', 'dog', 'bear', 'frog', 'turtle'}
GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
BANKR_URL = 'https://api.bankr.bot'
NEYNAR_URL = 'https://api.neynar.com'
try:
    from eth_account import Account
except ImportError:
    Account = None

FREN_VAULT_SEED = os.environ.get('FREN_VAULT_SEED', 'tinyfrens-master-vault-seed-v1')

def fren_vault_address_and_key(pid):
    digest = hashlib.sha256(f"{FREN_VAULT_SEED}:{pid}".encode()).digest()
    if Account:
        acct = Account.from_key(digest)
        return acct.address, acct.key.hex()
    addr = '0x' + hashlib.sha256(digest).hexdigest()[:40]
    return addr, '0x' + digest.hex()

FRENS_TOKEN_ADDRESS = "0x1A96226727a1D0a46334b3A4b3878B32B7659ba3"
_frens_price_cache = {"ts": 0, "price_usd": 0.0000001050}

async def fetch_frens_price_usd():
    now_ts = time.time()
    if now_ts - _frens_price_cache["ts"] < 30 and _frens_price_cache["price_usd"] > 0:
        return _frens_price_cache["price_usd"]
    try:
        url = f"https://api.dexscreener.com/latest/dex/tokens/{FRENS_TOKEN_ADDRESS}"
        async with ClientSession(timeout=ClientTimeout(total=4)) as session:
            async with session.get(url) as response:
                if response.status == 200:
                    data = await response.json()
                    pairs = data.get("pairs") or []
                    for pair in pairs:
                        p_usd = float(pair.get("priceUsd") or 0)
                        if p_usd > 0:
                            _frens_price_cache["ts"] = now_ts
                            _frens_price_cache["price_usd"] = p_usd
                            return p_usd
    except Exception:
        pass
    return _frens_price_cache["price_usd"] or 0.0000001050

async def calculate_frens_mint_quote(target_usd=1.00):
    price_usd = await fetch_frens_price_usd()
    frens_amount = target_usd / price_usd if price_usd > 0 else 100.0
    frens_wei = int(frens_amount * 10**18)
    credits_needed = int(frens_amount * 100)
    return {
        "targetUsd": float(target_usd),
        "priceUsd": price_usd,
        "frensPriceUsd": price_usd,
        "frensRequired": round(frens_amount, 2),
        "frensRequiredWei": str(frens_wei),
        "creditsRequired": credits_needed,
        "tokenAddress": FRENS_TOKEN_ADDRESS,
        "symbol": "FRENS",
        "timestamp": int(time.time()),
        "expiresAt": int(time.time()) + 60
    }
ECONOMY_CONFIG_PATH = os.path.join(os.path.dirname(__file__), '..', 'contracts', 'config', 'economy.json')
ADDR_RE = re.compile(r'^0x[a-fA-F0-9]{40}$')

def load_economy_config():
    try:
        with open(ECONOMY_CONFIG_PATH, encoding='utf-8') as handle:
            return json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def economy_settings():
    mode = os.environ.get('ECONOMY_MODE', '').strip().lower()
    cfg = load_economy_config()
    if mode not in {'testnet', 'production'}:
        return {'enabled': False, 'mode': None, 'chainId': None, 'chainName': None, 'frensToken': None, 'symbol': 'FRENS', 'decimals': 18, 'depositsEnabled': False, 'productionToken': cfg.get('production', {}).get('frensToken')}
    block = cfg.get(mode) or {}
    token = (os.environ.get('FRENS_TOKEN') or block.get('frensToken') or '').strip()
    chain_raw = os.environ.get('CHAIN_ID') or block.get('chainId')
    try:
        chain_id = int(chain_raw) if chain_raw is not None else None
    except (TypeError, ValueError):
        chain_id = None
    enabled = mode == 'testnet' and bool(token and ADDR_RE.fullmatch(token) and chain_id)
    if mode == 'production':
        prod = cfg.get('production') or {}
        if prod.get('frensToken'):
            token = str(prod['frensToken']).strip()
        if prod.get('chainId') is not None:
            chain_id = int(prod['chainId'])
        enabled = False
    return {
        'enabled': enabled,
        'mode': mode,
        'chainId': chain_id,
        'chainName': block.get('chainName'),
        'explorer': block.get('explorer'),
        'frensToken': token if token else None,
        'name': block.get('name'),
        'symbol': block.get('symbol', 'FRENS'),
        'decimals': int(block.get('decimals', 18)),
        'depositsEnabled': os.environ.get('ECONOMY_DEPOSITS', '').lower() == 'true' and enabled,
        'productionToken': cfg.get('production', {}).get('frensToken'),
    }

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
    CREATE TABLE IF NOT EXISTS pet_wallets(pet_id TEXT PRIMARY KEY, provider TEXT, wallet_id TEXT, evm_address TEXT, sol_address TEXT, api_key TEXT, nft TEXT, created INTEGER);
    CREATE TABLE IF NOT EXISTS magic_links(code TEXT PRIMARY KEY, pet_id TEXT, created INTEGER, expires INTEGER);
    CREATE TABLE IF NOT EXISTS fren_nfts(id INTEGER PRIMARY KEY AUTOINCREMENT, pet_id TEXT, token_id INTEGER, name TEXT, traits TEXT, created INTEGER);
    CREATE TABLE IF NOT EXISTS tg_users(tg_id TEXT PRIMARY KEY, pet_id TEXT, updated INTEGER);
    CREATE TABLE IF NOT EXISTS dc_users(user_id TEXT PRIMARY KEY, pet_id TEXT, updated INTEGER);''')
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
    def room_kind(room):
        # 'public' | ('private', code) | ('chat', platform, code)
        if room=='public': return 'public','',''
        head,_,tail=room.partition(':')
        if head in ('tg','dc'): return 'chat',('telegram' if head=='tg' else 'discord'),tail
        return 'private','',tail
    async def room_state(room):
        if room not in rooms: return
        members=[dict(id=pid,pet=data['pet']) for pid,data in rooms[room].items()]
        kind,platform,code=room_kind(room)
        payload=dict(type='party-state',room=kind,code=code,members=members)
        if kind=='chat': payload['platform']=platform
        for pid in list(rooms[room]):
            await send(pid,payload)
    async def leave_room(pid):
        room=room_by_pet.pop(pid,None)
        if room and pid in rooms.get(room,{}):
            rooms[room].pop(pid,None)
            if rooms[room]: await room_state(room)
            else: rooms.pop(room,None)
    @web.middleware
    async def origin_guard(request, handler):
        origin=request.headers.get('Origin')
        public_paths={'/','/health','/.well-known/farcaster.json','/api/snap','/api/snap/interact','/snap','/api/farcaster/notify','/api/farcaster/webhook','/api/farcaster/cast','/api/telegram/auth','/api/telegram/webhook','/api/discord/token','/api/discord/interactions'}
        is_snap_req='application/vnd.farcaster.snap+json' in request.headers.get('Accept','')
        is_public=request.path in public_paths or is_snap_req
        if not is_public and origin not in allowed: raise web.HTTPForbidden(text='Origin not allowed')
        if request.method=='OPTIONS': response=web.Response()
        else: response=await handler(request)
        if not isinstance(response,web.WebSocketResponse):
            if is_public:
                response.headers.update({'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Accept, X-Snap-Payload','Access-Control-Allow-Methods':'POST, GET, OPTIONS'})
            elif origin in allowed:
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
    async def economy_status(request):
        data = economy_settings()
        if data['mode'] == 'production' and not data['enabled']:
            data['note'] = 'Production FRENS is configured in contracts/config/economy.json; server economy stays off until testnet passes and ECONOMY_MODE=production is explicitly enabled.'
        return web.json_response(data)
    async def bankr_wallet(request):
        try:
            ip=request.headers.get('X-Forwarded-For',request.remote or '?') if os.environ.get('TRUST_PROXY')=='true' else request.remote or '?'
            limit(('bankr-wallet',ip),20,3600)
            body=await request.json()
            pid=token_pet(body.get('token'))
            if body.get('pet') is not None:
                p=profile(body.get('pet')); db.execute('UPDATE pets SET profile=? WHERE id=?',(json.dumps(p),pid)); db.commit()
            row=db.execute('SELECT provider,wallet_id,evm_address,sol_address,api_key FROM pet_wallets WHERE pet_id=?',(pid,)).fetchone()
            if row and row[0] in ('bankr-partner', 'fren-vault') and row[2]:
                return web.json_response({'mode':row[0],'walletId':row[1],'evmAddress':row[2],'solAddress':row[3] or '','partner':row[0]=='bankr-partner','message':'Your personal Fren Pocket Vault on Base.'})
            partner_key=os.environ.get('BANKR_PARTNER_KEY')
            if partner_key:
                bankr_base=os.environ.get('BANKR_API_URL',BANKR_URL).rstrip('/')
                timeout=ClientTimeout(total=20)
                try:
                    async with ClientSession(timeout=timeout) as session:
                        payload={'idempotencyKey':'tinyfrens:'+pid,'wallet':{'solana':False},'apiKey':{'permissions':{'agentApiEnabled':True,'llmGatewayEnabled':False,'tokenLaunchApiEnabled':False,'readOnly':False}}}
                        async with session.post(bankr_base+'/partner/wallets',headers={'Content-Type':'application/json','X-Partner-Key':partner_key},json=payload) as response:
                            data=await response.json(content_type=None)
                            if response.status < 400 and data.get('evmAddress'):
                                db.execute('INSERT OR REPLACE INTO pet_wallets VALUES(?,?,?,?,?,?,?,?)',(pid,'bankr-partner',data.get('id',''),data.get('evmAddress',''),data.get('solAddress',''),data.get('apiKey',''),None,int(now())))
                                db.commit()
                                return web.json_response({'mode':'bankr-partner','walletId':data.get('id',''),'evmAddress':data.get('evmAddress',''),'solAddress':data.get('solAddress',''),'partner':True,'message':'Your dedicated Bankr partner wallet.'})
                except Exception: pass
            evm_addr, evm_key = fren_vault_address_and_key(pid)
            db.execute('INSERT OR REPLACE INTO pet_wallets VALUES(?,?,?,?,?,?,?,?)',(pid,'fren-vault','vault:'+pid,evm_addr,'',evm_key,None,int(now())))
            db.commit()
            return web.json_response({'mode':'fren-vault','walletId':'vault:'+pid,'evmAddress':evm_addr,'solAddress':'','partner':False,'message':'Your personal Fren Pocket Vault on Base.'})
        except (ValueError,KeyError,TypeError,json.JSONDecodeError,asyncio.TimeoutError) as e:
            return web.json_response({'error':str(e) or 'Fren vault is having trouble right now'},status=400)
    def nft_traits(nft):
        seed=':'.join(str(nft.get(k,'')) for k in ('chain','tokenId','name'))+':'+str((nft.get('collection') or {}).get('address',''))
        digest=hashlib.sha256(seed.encode()).digest()
        shapes=['cat','blob','robot','bunny','dog','bear','frog','turtle'];colors=['#a474f1','#66c7d2','#ffb95e','#82eba1','#ff82a7','#4d96ff','#2ecc71','#ff7675']
        exprs=['happy','wink','shades','star_eyes'];accs=['none','party_hat','crown','halo','bow_tie','orb']
        return {'shape':shapes[digest[0]%len(shapes)],'color':colors[digest[1]%len(colors)],'expression':exprs[digest[2]%len(exprs)],'accessory':accs[digest[3]%len(accs)]}
    async def wallet_api_key(pid):
        row=db.execute('SELECT api_key FROM pet_wallets WHERE pet_id=?',(pid,)).fetchone()
        return row[0] if row and row[0] and row[0].startswith('bk_') else os.environ.get('BANKR_API_KEY')
    async def bankr_nfts(request):
        try:
            ip=request.headers.get('X-Forwarded-For',request.remote or '?') if os.environ.get('TRUST_PROXY')=='true' else request.remote or '?'
            limit(('bankr-nfts',ip),60,3600)
            body=await request.json(); pid=token_pet(body.get('token'))
            row=db.execute('SELECT provider,wallet_id,evm_address,sol_address,api_key,nft FROM pet_wallets WHERE pet_id=?',(pid,)).fetchone()
            evm_addr = row[2] if row else fren_vault_address_and_key(pid)[0]
            nfts = []
            db_nfts = db.execute('SELECT token_id, name, traits FROM fren_nfts WHERE pet_id=? ORDER BY id DESC', (pid,)).fetchall()
            for row_nft in db_nfts:
                tid, nname, traits_json = row_nft
                traits_data = json.loads(traits_json) if traits_json else nft_traits_by_id(tid)
                nfts.append({
                    'chain': 'base',
                    'collection': {'name': 'TinyFrens', 'address': os.environ.get('TINYFRENS_NFT_ADDRESS', '0xTinyFrensNFT')},
                    'tokenId': tid,
                    'name': nname or f'TinyFren #{tid}',
                    'traits': traits_data
                })
            if row and row[0] == 'bankr-partner' and row[4]:
                bankr_base=os.environ.get('BANKR_API_URL',BANKR_URL).rstrip('/')
                try:
                    async with ClientSession(timeout=ClientTimeout(total=10)) as session:
                        async with session.get(bankr_base+'/wallet/portfolio?include=nfts',headers={'X-API-Key':row[4]}) as response:
                            if response.status < 400:
                                data=await response.json(content_type=None)
                                nfts.extend(data.get('nfts', []))
                except Exception: pass
            return web.json_response({'nfts': nfts, 'evmAddress': evm_addr})
        except (ValueError,KeyError,TypeError,json.JSONDecodeError,asyncio.TimeoutError) as e:
            return web.json_response({'error':str(e) or 'Could not read fren NFTs'},status=400)
    async def nft_price(request):
        try:
            quote = await calculate_frens_mint_quote(target_usd=1.00)
            return web.json_response(quote)
        except Exception as e:
            return web.json_response({'error': str(e)}, status=500)
    async def wallet_mint(request):
        try:
            ip=request.headers.get('X-Forwarded-For',request.remote or '?') if os.environ.get('TRUST_PROXY')=='true' else request.remote or '?'
            limit(('wallet-mint',ip),20,3600)
            body=await request.json(); pid=token_pet(body.get('token'))
            evm_addr, _ = fren_vault_address_and_key(pid)
            quote = await calculate_frens_mint_quote(target_usd=1.00)
            frens_needed = quote['frensRequired']
            credits_needed = quote['creditsRequired']
            row_credit = db.execute('SELECT balance FROM credit_accounts WHERE pet_id=?', (pid,)).fetchone()
            current_credits = row_credit[0] if row_credit else 0
            if body.get('checkOnly'):
                return web.json_response({
                    'canAfford': current_credits >= credits_needed,
                    'frensRequired': frens_needed,
                    'currentBalance': current_credits / 100.0,
                    'vaultAddress': evm_addr,
                    'quote': quote
                })
            allow_free = os.environ.get('ALLOW_TESTNET_FREE_MINT', 'true').lower() == 'true'
            if current_credits < credits_needed and not allow_free:
                current_frens = current_credits / 100.0
                return web.json_response({
                    'error': f"Minting requires {frens_needed:,.2f} FRENS ($1.00 USD). Your Fren Vault balance: {current_frens:,.2f} FRENS.",
                    'frensRequired': frens_needed,
                    'currentBalance': current_frens,
                    'targetUsd': 1.00,
                    'vaultAddress': evm_addr,
                    'quote': quote
                }, status=402)
            if current_credits >= credits_needed:
                new_balance = current_credits - credits_needed
                db.execute('UPDATE credit_accounts SET balance=?, updated_at=? WHERE pet_id=?', (new_balance, int(now()), pid))
                db.execute('INSERT INTO credit_ledger(pet_id,delta,balance,reason,ref_type,ref_id,created) VALUES(?,?,?,?,?,?,?)',
                           (pid, -credits_needed, new_balance, 'mint_nft_frens', 'usd_1.00', str(int(now())), int(now())))
            existing = db.execute('SELECT token_id FROM fren_nfts').fetchall()
            used_ids = {r[0] for r in existing}
            available_ids = [i for i in range(1, 889) if i not in used_ids]
            token_id = available_ids[secrets.randbelow(len(available_ids))] if available_ids else (secrets.randbelow(888) + 1)
            traits_data = nft_traits_by_id(token_id)
            species_capital = traits_data['shape'].capitalize()
            nft_name = f'TinyFren #{token_id} · {species_capital}'
            db.execute('INSERT INTO fren_nfts(pet_id,token_id,name,traits,created) VALUES(?,?,?,?,?)',
                       (pid, token_id, nft_name, json.dumps(traits_data), int(now())))
            current = pet(pid)['pet']
            transformed = {**current, **traits_data, 'tokenId': token_id, 'name': current['name']}
            db.execute('UPDATE pets SET profile=? WHERE id=?', (json.dumps(transformed), pid))
            db.commit()
            nft_obj = {
                'chain': 'base',
                'collection': {'name': 'TinyFrens', 'address': os.environ.get('TINYFRENS_NFT_ADDRESS', '0xTinyFrensNFT')},
                'tokenId': token_id,
                'name': nft_name,
                'traits': traits_data
            }
            return web.json_response({
                'success': True,
                'pet': transformed,
                'nft': nft_obj,
                'evmAddress': evm_addr,
                'quote': quote
            })
        except (ValueError,KeyError,TypeError,json.JSONDecodeError) as e:
            return web.json_response({'error':str(e) or 'Could not mint TinyFren'},status=400)
    async def wallet_magic_link(request):
        try:
            ip=request.headers.get('X-Forwarded-For',request.remote or '?') if os.environ.get('TRUST_PROXY')=='true' else request.remote or '?'
            limit(('wallet-magic',ip),15,3600)
            body=await request.json(); pid=token_pet(body.get('token'))
            code = secrets.token_urlsafe(16)
            expires = int(now()) + (30 * 86400)
            db.execute('INSERT OR REPLACE INTO magic_links VALUES(?,?,?,?)', (code, pid, int(now()), expires))
            db.commit()
            restore_url = f"https://tinyfrens.lol/web/#restore={code}"
            return web.json_response({'code': code, 'restoreUrl': restore_url, 'expires': expires})
        except (ValueError,KeyError,TypeError,json.JSONDecodeError) as e:
            return web.json_response({'error':str(e) or 'Could not generate magic link'},status=400)
    async def wallet_restore(request):
        try:
            ip=request.headers.get('X-Forwarded-For',request.remote or '?') if os.environ.get('TRUST_PROXY')=='true' else request.remote or '?'
            limit(('wallet-restore',ip),30,3600)
            body=await request.json(); code=str(body.get('code','')).strip()
            row = db.execute('SELECT pet_id, expires FROM magic_links WHERE code=?', (code,)).fetchone()
            if not row or row[1] < int(now()):
                return web.json_response({'error': 'Magic restore link is invalid or expired.'}, status=404)
            pid = row[0]
            pet_row = db.execute('SELECT code, profile FROM pets WHERE id=?', (pid,)).fetchone()
            if not pet_row: return web.json_response({'error': 'Pet not found'}, status=404)
            new_token = secrets.token_urlsafe(32)
            db.execute('UPDATE pets SET token=? WHERE id=?', (hashlib.sha256(new_token.encode()).hexdigest(), pid))
            db.commit()
            evm_addr, _ = fren_vault_address_and_key(pid)
            return web.json_response({
                'success': True,
                'id': pid,
                'code': pet_row[0],
                'token': new_token,
                'pet': json.loads(pet_row[1]),
                'evmAddress': evm_addr,
                'vaultAddress': evm_addr
            })
        except (ValueError,KeyError,TypeError,json.JSONDecodeError) as e:
            return web.json_response({'error':str(e) or 'Could not restore fren'},status=400)
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
    def nft_traits_by_id(token_id):
        shapes = ['cat', 'blob', 'robot', 'bunny', 'dog', 'bear', 'frog', 'turtle']
        species_list = ['Cat', 'Blob', 'Robot', 'Bunny', 'Puppy', 'Bear', 'Frog', 'Turtle']
        palettes = [
            ('Lavender Dream', '#a474f1', 'Classic'),
            ('Cyber Neon', '#66c7d2', 'Classic'),
            ('Sunny Amber', '#ffb95e', 'Classic'),
            ('Mint Meadow', '#82eba1', 'Classic'),
            ('Bubblegum', '#ff82a7', 'Classic'),
            ('Electric Blue', '#4d96ff', 'Classic'),
            ('Midnight Obsidian', '#3a2d52', 'Rare'),
            ('24K Solid Gold', '#ffd700', 'Legendary')
        ]
        expr_keys = ['happy', 'wink', 'shades', 'star_eyes']
        expr_labels = ['Classic Happy', 'Playful Wink', 'Cool Shades', 'Star Eyes']
        acc_keys = ['none', 'party_hat', 'crown', 'halo', 'bow_tie', 'orb']
        acc_labels = ['None', 'Party Hat', 'Royal Crown', 'Angel Halo', 'Dapper Bow Tie', 'Mystic Orb']
        s = (int(token_id) * 104729 + 7919) % 2147483647
        def rand():
            nonlocal s
            s = (s * 16807) % 2147483647
            return (s - 1) / 2147483646
        idx = (int(token_id) - 1) % 8
        shape = shapes[idx]
        species = species_list[idx]
        roll = rand() * 100
        if roll < 5: pal = palettes[7]
        elif roll < 20: pal = palettes[6]
        else: pal = palettes[int(rand() * 6)]
        e_idx = int(rand() * len(expr_keys))
        a_idx = int(rand() * len(acc_keys))
        return {
            'shape': shape,
            'species': species,
            'palette': pal[0],
            'color': pal[1],
            'tier': pal[2],
            'expression': expr_keys[e_idx],
            'expressionLabel': expr_labels[e_idx],
            'accessory': acc_keys[a_idx],
            'accessoryLabel': acc_labels[a_idx],
            'tokenId': int(token_id)
        }
    def make_snap_payload(action=None, nft_id=None):
        effects=["confetti"] if action in ("pet","feed","play") else []
        status_text="Your 1:1 on-chain & floating desktop companion."
        header_text="TinyFrens · Pocket Pet"
        status_sub="8 companion species · Curated 888 on-chain supply · AR camera snaps · Multiplayer party rooms"
        app_target="https://tinyfrens.lol/"
        if nft_id:
            try:
                traits = nft_traits_by_id(nft_id)
                header_text = f"TinyFren #{nft_id} · {traits['species']}"
                status_sub = f"[{traits['tier']}] {traits['palette']} · {traits['expressionLabel']}" + (f" · {traits['accessoryLabel']}" if traits['accessory'] != 'none' else "")
                status_text = f"TinyFren #{nft_id} is active in the Public Plaza!"
                app_target = f"https://tinyfrens.lol/?nft={nft_id}"
            except Exception: pass
        if action=="pet": status_text="You petted the fren! They did a little wiggle 💖"
        elif action=="feed": status_text="You fed the fren a fresh strawberry 🍓! Nom nom."
        elif action=="play": status_text="You played ball with your fren 🎾! Joy is at 100%!"
        return {
            "version": "2.0",
            "theme": {"accent": "purple"},
            "effects": effects,
            "ui": {
                "root": "page",
                "elements": {
                    "page": {
                        "type": "stack",
                        "props": {"gap": "md"},
                        "children": ["header", "hero-img", "status-text", "action-buttons", "open-miniapp-btn"]
                    },
                    "header": {
                        "type": "text",
                        "props": {"content": header_text, "weight": "bold", "size": "lg"}
                    },
                    "hero-img": {
                        "type": "image",
                        "props": {
                            "url": "https://tinyfrens.lol/icons/og-card.png",
                            "aspect": "16:9",
                            "title": header_text,
                            "subtitle": status_text
                        }
                    },
                    "status-text": {
                        "type": "text",
                        "props": {
                            "content": status_sub,
                            "size": "sm"
                        }
                    },
                    "action-buttons": {
                        "type": "stack",
                        "props": {"direction": "horizontal", "gap": "sm", "equalWidth": True},
                        "children": ["btn-pet", "btn-feed", "btn-play"]
                    },
                    "btn-pet": {
                        "type": "button",
                        "props": {"label": "Pet 💖", "variant": "secondary"},
                        "on": {"press": {"action": "submit", "params": {"target": "https://tinyfrens.miono.live/api/snap/interact?action=pet"}}}
                    },
                    "btn-feed": {
                        "type": "button",
                        "props": {"label": "Feed 🍓", "variant": "secondary"},
                        "on": {"press": {"action": "submit", "params": {"target": "https://tinyfrens.miono.live/api/snap/interact?action=feed"}}}
                    },
                    "btn-play": {
                        "type": "button",
                        "props": {"label": "Play 🎾", "variant": "secondary"},
                        "on": {"press": {"action": "submit", "params": {"target": "https://tinyfrens.miono.live/api/snap/interact?action=play"}}}
                    },
                    "open-miniapp-btn": {
                        "type": "button",
                        "props": {"label": "Open TinyFrens Mini App 🐾", "variant": "primary", "icon": "arrow-right"},
                        "on": {"press": {"action": "open_mini_app", "params": {"target": app_target}}}
                    }
                }
            }
        }
    async def get_snap(request):
        accept=request.headers.get('Accept','')
        nft_param=request.query.get('nft') or request.query.get('id')
        nft_id=None
        if nft_param:
            try:
                v=int(nft_param)
                if 1<=v<=888: nft_id=v
            except ValueError: pass
        link_query=f"?nft={nft_id}" if nft_id else ""
        link_hdr=f'<https://www.tinyfrens.lol/snap{link_query}>; rel="alternate"; type="application/vnd.farcaster.snap+json"'
        if 'application/vnd.farcaster.snap+json' not in accept and 'text/html' in accept:
            card_title=f"TinyFren #{nft_id}" if nft_id else "TinyFrens Snap"
            card_desc=f"Verified On-Chain #{nft_id} Companion" if nft_id else "An interactive pet built for Farcaster casts."
            html=f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{card_title} · Farcaster Snap</title><meta property="og:title" content="{card_title} · In-Feed Pocket Pet"><meta property="og:description" content="{card_desc}"><meta property="og:image" content="https://tinyfrens.lol/icons/og-card.png"><link rel="alternate" type="application/vnd.farcaster.snap+json" href="https://www.tinyfrens.lol/snap{link_query}"><link rel="icon" href="https://tinyfrens.lol/icons/icon.svg"><style>body{{margin:0;min-height:100vh;background:#17142a;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:grid;place-items:center;padding:20px;text-align:center;box-sizing:border-box}}.card{{background:#231c3c;border:1px solid #4a3474;border-radius:24px;padding:28px 20px;max-width:380px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,0.5)}}img{{width:100%;border-radius:16px;margin-bottom:16px}}h1{{font-size:24px;margin:0 0 8px}}p{{color:#c8b1fa;font-size:15px;margin:0 0 24px}}a{{display:block;background:#855DCD;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:14px;border-radius:14px}}</style></head><body><div class="card"><img src="https://tinyfrens.lol/icons/og-card.png" alt="TinyFrens"><h1>{card_title}</h1><p>{card_desc}</p><a href="https://tinyfrens.lol/web/{link_query}">Open Full Web App 🐾</a></div></body></html>"""
            return web.Response(text=html, content_type='text/html', headers={'Vary': 'Accept', 'Link': link_hdr})
        return web.json_response(make_snap_payload(nft_id=nft_id), content_type='application/vnd.farcaster.snap+json', headers={'Vary': 'Accept', 'Link': link_hdr})
    async def post_snap_interact(request):
        action=request.query.get('action')
        if not action:
            try:
                body=await request.json()
                if isinstance(body, dict) and 'payload' in body and isinstance(body['payload'], str):
                    import base64
                    p_raw=body['payload']
                    p_pad=p_raw + '=' * (-len(p_raw) % 4)
                    p_data=json.loads(base64.urlsafe_b64decode(p_pad.encode('ascii')))
                    action=p_data.get('inputs',{}).get('action')
                elif isinstance(body, dict):
                    action=body.get('inputs',{}).get('action') or body.get('action')
            except Exception:
                pass
        link_hdr='<https://www.tinyfrens.lol/snap>; rel="alternate"; type="application/vnd.farcaster.snap+json"'
        return web.json_response(make_snap_payload(action=action), content_type='application/vnd.farcaster.snap+json', headers={'Vary': 'Accept', 'Link': link_hdr})
    async def farcaster_manifest(request):
        candidates=[
            os.path.join(os.path.dirname(__file__),'..','web','.well-known','farcaster.json'),
            os.path.join(os.path.dirname(__file__),'web','.well-known','farcaster.json'),
            os.path.join(os.path.dirname(__file__),'.well-known','farcaster.json')
        ]
        data=None
        for p in candidates:
            if os.path.exists(p):
                with open(p,'r',encoding='utf-8') as f: data=json.load(f); break
        if not data:
            data={"accountAssociation":{"header":"","payload":"","signature":""},"frame":{"version":"1","name":"TinyFrens","iconUrl":"https://tinyfrens.lol/icons/icon-192.png","homeUrl":"https://tinyfrens.lol/","imageUrl":"https://tinyfrens.lol/icons/icon-512.png","buttonTitle":"Open TinyFrens","splashImageUrl":"https://tinyfrens.lol/icons/icon-192.png","splashBackgroundColor":"#17142a"}}
        return web.json_response(data, content_type='application/json')
    async def farcaster_notify(request):
        try:
            api_key=os.environ.get('NEYNAR_API_KEY')
            if not api_key: return web.json_response({'error':'Neynar API key is not configured'},status=503)
            body=await request.json()
            title=str(body.get('title','TinyFrens')).strip()[:60]
            msg_body=str(body.get('body','Your fren wants to play!')).strip()[:160]
            target_url=str(body.get('targetUrl','https://tinyfrens.lol/')).strip()
            headers={'Content-Type':'application/json','x-api-key':api_key}
            payload={'notification':{'title':title,'body':msg_body,'target_url':target_url}}
            timeout=ClientTimeout(total=15)
            async with ClientSession(timeout=timeout) as session:
                async with session.post(NEYNAR_URL+'/v2/farcaster/frame/notifications',headers=headers,json=payload) as response:
                    data=await response.json(content_type=None)
                    if response.status>=400: return web.json_response({'error':data.get('message') or 'Could not send notification'},status=response.status)
                    return web.json_response(data)
        except Exception as e: return web.json_response({'error':str(e)},status=400)
    async def farcaster_webhook(request):
        try:
            data=await request.json()
            return web.json_response({'received':True})
        except Exception: return web.json_response({'ok':True})
    async def farcaster_cast(request):
        try:
            api_key=os.environ.get('NEYNAR_API_KEY')
            signer_uuid=os.environ.get('FARCASTER_SIGNER_UUID')
            if not api_key: return web.json_response({'error':'Neynar API key is not configured'},status=503)
            if not signer_uuid: return web.json_response({'error':'FARCASTER_SIGNER_UUID is not configured yet'},status=503)
            body=await request.json()
            text=str(body.get('text','')).strip()[:1024]
            if not text: return web.json_response({'error':'Cast text cannot be empty'},status=400)
            payload={'signer_uuid':signer_uuid,'text':text}
            embeds=body.get('embeds')
            if isinstance(embeds,list) and embeds: payload['embeds']=embeds
            headers={'Content-Type':'application/json','x-api-key':api_key}
            timeout=ClientTimeout(total=15)
            async with ClientSession(timeout=timeout) as session:
                async with session.post(NEYNAR_URL+'/v2/farcaster/cast',headers=headers,json=payload) as response:
                    data=await response.json(content_type=None)
                    if response.status>=400: return web.json_response({'error':data.get('message') or 'Could not publish cast'},status=response.status)
                    return web.json_response(data)
        except Exception as e: return web.json_response({'error':str(e)},status=400)
    def mint_pet(p):
        """Create a persistent pet identity and return (pid, token, code)."""
        pid=secrets.token_hex(16); token=secrets.token_urlsafe(32)
        alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        while True:
            code=''.join(secrets.choice(alphabet) for _ in range(8))
            if not db.execute('SELECT 1 FROM pets WHERE code=?',(code,)).fetchone(): break
        db.execute('INSERT INTO pets VALUES(?,?,?,?)',(pid,code,hashlib.sha256(token.encode()).hexdigest(),json.dumps(p)))
        return pid, token, code
    def reissue_token(pid):
        """Give an existing pet a fresh bearer token and return (token, code)."""
        token=secrets.token_urlsafe(32)
        db.execute('UPDATE pets SET token=? WHERE id=?',(hashlib.sha256(token.encode()).hexdigest(),pid))
        code=db.execute('SELECT code FROM pets WHERE id=?',(pid,)).fetchone()
        return token, (code[0] if code else '')
    async def telegram_auth(request):
        # Exchange a validated Telegram initData for the same friends-relay
        # identity ({id,token,code}) so friends.js/party.js work unchanged inside
        # the Mini App. A returning Telegram user keeps the same fren.
        try:
            if validate_init_data is None: raise ValueError('Telegram support is unavailable')
            token=os.environ.get('TELEGRAM_BOT_TOKEN')
            if not token: return web.json_response({'error':'Telegram bot is not configured'},status=503)
            ip=request.headers.get('X-Forwarded-For',request.remote or '?') if os.environ.get('TRUST_PROXY')=='true' else request.remote or '?'
            limit(('tg-auth',ip),30,3600)
            body=await request.json()
            data=validate_init_data(str(body.get('initData','')),token)
            user=data['user'] or {}
            tg_id=str(user.get('id',''))
            if not tg_id: raise ValueError('No Telegram user in initData')
            p=user_profile(user)
            row=db.execute('SELECT pet_id FROM tg_users WHERE tg_id=?',(tg_id,)).fetchone()
            if row and db.execute('SELECT 1 FROM pets WHERE id=?',(row[0],)).fetchone():
                pid=row[0]
                db.execute('UPDATE pets SET profile=? WHERE id=?',(json.dumps(p),pid))
                bearer,code=reissue_token(pid)
            else:
                pid,bearer,code=mint_pet(p)
                db.execute('INSERT OR REPLACE INTO tg_users VALUES(?,?,?)',(tg_id,pid,int(now())))
            db.commit()
            return web.json_response({'id':pid,'token':bearer,'code':code,'chat':data['chat'],'startParam':data['start_param']})
        except (ValueError,KeyError,TypeError,json.JSONDecodeError) as e:
            return web.json_response({'error':str(e) or 'Telegram sign-in failed'},status=400)
    async def telegram_webhook(request):
        # Bot webhook: greet /start in DMs and, when added to a group, post an
        # inline web_app button that opens the Mini App in that group (== party room).
        try:
            if bot_api is None: return web.json_response({'error':'Telegram support is unavailable'},status=503)
            token=os.environ.get('TELEGRAM_BOT_TOKEN')
            if not token: return web.json_response({'error':'Telegram bot is not configured'},status=503)
            update=await request.json()
            kind,chat_id,chat=classify(update)
            miniapp=os.environ.get('TELEGRAM_MINIAPP_URL','https://tinyfrens.lol/web/')
            if kind=='start' and chat_id is not None:
                await bot_api('sendMessage',{'chat_id':chat_id,'text':'Hi! 🐾 I\'m your TinyFren. Tap below to wake me up — then invite me to a group so everyone\'s frens can hang out together.'},token)
                await bot_api('sendMessage',{'chat_id':chat_id,'text':'Ready when you are.','reply_markup':reply_markup(miniapp)},token)
            elif kind=='added' and chat_id is not None:
                title=(chat or {}).get('title') or 'this chat'
                await bot_api('sendMessage',{'chat_id':chat_id,'text':'A TinyFren has arrived in '+title+'! 🎉 Everyone here can open the app below to drop their fren into this shared room.','reply_markup':reply_markup(miniapp,'🐾 Open the room')},token)
            return web.json_response({'ok':True})
        except Exception as e: return web.json_response({'error':str(e)},status=400)
    async def discord_token(request):
        try:
            if exchange_code is None: return web.json_response({'error':'Discord support is unavailable'},status=503)
            client_id=os.environ.get('DISCORD_CLIENT_ID'); client_secret=os.environ.get('DISCORD_CLIENT_SECRET')
            if not client_id or not client_secret: return web.json_response({'error':'Discord app is not configured'},status=503)
            body=await request.json()
            code=str(body.get('code',''))
            if not code: raise ValueError('Missing authorization code')
            redirect=os.environ.get('DISCORD_REDIRECT_URI','')
            data,status=await exchange_code(code,client_id,client_secret,redirect)
            if status>=400: return web.json_response({'error':data.get('error_description') or 'Discord token exchange failed'},status=status)
            return web.json_response(data)
        except (ValueError,KeyError,TypeError,json.JSONDecodeError) as e:
            return web.json_response({'error':str(e) or 'Discord sign-in failed'},status=400)
    async def discord_interactions(request):
        # Verifies Discord's Ed25519 signature and answers PING (type 1) so the app
        # can be validated in the dev portal. Rich slash-command handling is Phase 3.
        try:
            if verify_interaction is None: return web.json_response({'error':'Discord support is unavailable'},status=503)
            public_key=os.environ.get('DISCORD_PUBLIC_KEY')
            if not public_key: return web.json_response({'error':'Discord app is not configured'},status=503)
            body=await request.read()
            signature=request.headers.get('X-Signature-Ed25519',''); timestamp=request.headers.get('X-Signature-Timestamp','')
            result=verify_interaction(signature,timestamp,body,public_key)
            if result is None: return web.json_response({'error':'Install PyNaCl to verify Discord interactions'},status=503)
            if not result: return web.HTTPUnauthorized(text='invalid request signature')
            try: data=json.loads(body)
            except json.JSONDecodeError: return web.json_response({'error':'bad body'},status=400)
            if data.get('type')==1: return web.json_response({'type':1})
            return web.json_response({'type':4,'data':{'content':'TinyFrens is launching soon in Discord! 🐾'}})
        except Exception as e: return web.json_response({'error':str(e)},status=400)
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
                        elif mode=='chat':
                            platform=str(m.get('platform','')).lower()
                            if platform not in ('telegram','discord'): raise ValueError('Unknown chat platform')
                            cid=re.sub(r'[^0-9A-Za-z:_-]','',str(m.get('chatId','')))[:64]
                            if not cid: raise ValueError('Missing chat id')
                            room=('tg:' if platform=='telegram' else 'dc:')+cid
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
                    elif typ=='party-action':
                        if pid in room_by_pet:
                            room=room_by_pet[pid]
                            action=str(m.get('action','wave')).lower()
                            if action in ('wave','dance','berry','pet','heart'):
                                target=m.get('target')
                                text=m.get('text')
                                payload=dict(type='party-action',sender=pid,action=action,pet=rooms[room][pid]['pet'])
                                if target: payload['target']=target
                                if text: payload['text']=str(text)[:100]
                                for other_pid in list(rooms[room]):
                                    await send(other_pid, payload)
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
    app.router.add_get('/',get_snap)
    app.router.add_post('/',post_snap_interact)
    app.router.add_get('/api/snap',get_snap)
    app.router.add_post('/api/snap',post_snap_interact)
    app.router.add_post('/api/snap/interact',post_snap_interact)
    app.router.add_get('/snap',get_snap)
    app.router.add_post('/snap',post_snap_interact)
    app.router.add_get('/.well-known/farcaster.json',farcaster_manifest)
    app.router.add_post('/api/farcaster/notify',farcaster_notify)
    app.router.add_post('/api/farcaster/webhook',farcaster_webhook)
    app.router.add_post('/api/farcaster/cast',farcaster_cast)
    # Telegram Mini App + bot
    app.router.add_post('/api/telegram/auth',telegram_auth)
    app.router.add_post('/api/telegram/webhook',telegram_webhook)
    # Discord Activity + interactions
    app.router.add_post('/api/discord/token',discord_token)
    app.router.add_post('/api/discord/interactions',discord_interactions)
    # On-chain economy: deposit sessions + off-chain credit ledger
    allocator = None
    router_addr = os.environ.get('DEPOSIT_ROUTER_PROXY')
    controller_key = os.environ.get('GAME_CONTROLLER_PRIVATE_KEY')
    if router_addr and controller_key and os.environ.get('BASE_RPC_URL'):
        try:
            from deposit_allocator import DepositRouterAllocator
            allocator = DepositRouterAllocator(
                router_addr,
                controller_key,
                os.environ.get('CHAIN_ID') or 84532,
                os.environ['BASE_RPC_URL'],
                token=economy_settings().get('frensToken'),
            )
        except Exception:
            app.logger.warning('DepositRouter allocator disabled (address/key/rpc issue)', exc_info=True)
    if allocator is None:
        pool=[a.strip() for a in os.environ.get('DEPOSIT_SESSION_ADDRESSES','').split(',') if a.strip()]
        if pool: allocator = economy_ledger.AddressPool(db, pool)
    economy = economy_ledger.attach(
        app, db,
        token_pet=token_pet,
        limit=limit,
        settings=economy_settings,
        allocator=allocator,
        indexer_secret=os.environ.get('ECONOMY_INDEXER_SECRET'),
    )
    # On-chain deposit indexer: scans Deposit logs and credits the ledger.
    # Starts in 'auto' when an allocator + RPC are wired; INDEXER_ENABLED=true
    # forces it (e.g. AddressPool-backed) and INDEXER_ENABLED=false suppresses.
    indexer = None
    idx_mode = os.environ.get('INDEXER_ENABLED', 'auto').lower()
    idx_wanted = idx_mode not in ('0', 'false', 'no')
    idx_auto_ok = bool(os.environ.get('BASE_RPC_URL')) and allocator is not None
    if idx_wanted and os.environ.get('BASE_RPC_URL') and (idx_auto_ok or idx_mode in ('1', 'true', 'yes')):
        try:
            from indexer import DepositIndexer
            indexer = DepositIndexer(
                economy,
                os.environ['BASE_RPC_URL'],
                os.environ.get('CHAIN_ID') or 84532,
                poll_seconds=float(os.environ.get('INDEXER_POLL_SECONDS', '6')),
                lookback=int(os.environ.get('INDEXER_LOOKBACK', '300')),
            )
        except Exception:
            app.logger.warning('Deposit indexer disabled (import/rpc issue)', exc_info=True)

    async def _start_indexer(_app):
        if indexer is not None:
            app.logger.info('Deposit indexer scanning %s (poll %.1fs)',
                            indexer.rpc_url, indexer.poll)
            indexer.start()

    async def _stop_indexer(_app):
        if indexer is not None:
            await indexer.aclose()

    if indexer is not None:
        app.on_startup.append(_start_indexer)
        app.on_cleanup.append(_stop_indexer)

    # NFT gallery support: read tokenURI straight from the on-chain collection so the
    # web/gallery.html page (and anyone) can render the real art. Read-only eth_call.
    TOKEN_URI_SELECTOR = '0xc87b56dd'  # tokenURI(uint256)

    async def nft_uri(request):
        nft = os.environ.get('TINYFRENS_NFT_ADDRESS')
        rpc = os.environ.get('BASE_RPC_URL')
        if not nft or not rpc or not re.fullmatch(r'0x[a-fA-F0-9]{40}', nft or ''):
            return web.json_response({'error': 'NFT contract / RPC not configured'}, status=503)
        try:
            tid = int(request.query.get('tokenId', '0'))
            if tid < 1 or tid > 1_000_000:
                return web.json_response({'error': 'tokenId out of range'}, status=400)
            data = TOKEN_URI_SELECTOR + tid.to_bytes(32, 'big').hex()
            payload = {'jsonrpc': '2.0', 'id': 1, 'method': 'eth_call',
                       'params': [{'to': nft, 'data': data}, 'latest']}
            async with ClientSession(timeout=ClientTimeout(total=10)) as session:
                async with session.post(rpc, json=payload) as response:
                    body = await response.json(content_type=None)
            if 'error' in body or not body.get('result') or body['result'] == '0x':
                return web.json_response({'tokenId': tid, 'minted': False, 'uri': None})
            raw = bytes.fromhex(body['result'][2:])
            offset = int.from_bytes(raw[:32], 'big')
            length = int.from_bytes(raw[offset:offset + 32], 'big')
            uri = raw[offset + 32:offset + 32 + length].decode('utf-8')
            return web.json_response({'tokenId': tid, 'minted': True, 'uri': uri,
                                      'collection': {'name': 'TinyFrens', 'address': nft}})
        except (ValueError, KeyError) as e:
            return web.json_response({'error': str(e) or 'Bad request'}, status=400)
        except (asyncio.TimeoutError, OSError, Exception):
            return web.json_response({'error': 'RPC unavailable'}, status=503)

    app.router.add_post('/api/register',register);app.router.add_post('/api/chat',chat);app.router.add_get('/api/bankr/status',bankr_status);app.router.add_get('/api/economy/status',economy_status);app.router.add_post('/api/bankr/wallet',bankr_wallet);app.router.add_post('/api/bankr/nfts',bankr_nfts);app.router.add_post('/api/bankr/transform',bankr_transform);app.router.add_post('/api/bankr/monitor',bankr_monitor);app.router.add_get('/api/nft/price',nft_price);app.router.add_get('/api/nft/uri',nft_uri);app.router.add_post('/api/wallet/mint',wallet_mint);app.router.add_post('/api/wallet/magic-link',wallet_magic_link);app.router.add_post('/api/wallet/restore',wallet_restore);app.router.add_get('/ws',websocket)
    app.router.add_route('OPTIONS','/{path:.*}',options)
    return app

if __name__=='__main__': web.run_app(create_app(),host=os.environ.get('HOST','0.0.0.0'),port=int(os.environ.get('PORT','8080')),access_log=None)
