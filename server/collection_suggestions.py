"""Persistent collection suggestions and deposited FRENS voting."""
import json
import re
import time
from aiohttp import web
from economy import InsufficientCredits


def parse_frens_to_credits(amount, credits_per_frens=100):
    """Safely convert a FRENS amount string or number to integer credits without floating point error."""
    if isinstance(amount, (int, float)) and not isinstance(amount, bool):
        if amount <= 0 or not (amount == amount):  # NaN check
            raise ValueError('Vote amount must be greater than zero')
        amount = f"{amount:.18f}".rstrip('0').rstrip('.')
    if not isinstance(amount, str):
        raise ValueError('Invalid vote amount format')
    amount = amount.strip()
    if not re.fullmatch(r'[0-9]+(?:\.[0-9]{1,18})?', amount):
        raise ValueError('Vote amount must be a positive number with up to 18 decimal places')
    if not any(c in '123456789' for c in amount):
        raise ValueError('Vote amount must be greater than zero')
    parts = amount.split('.')
    whole = int(parts[0])
    fraction_str = (parts[1] if len(parts) > 1 else '').ljust(18, '0')[:18]
    amount_wei = whole * (10 ** 18) + int(fraction_str)
    credits = (amount_wei * credits_per_frens) // (10 ** 18)
    if credits <= 0:
        min_frens = 1 / credits_per_frens
        raise ValueError(f'Vote amount must be at least {min_frens:g} FRENS (1 credit)')
    if credits > 100_000_000 * credits_per_frens:
        raise ValueError('Vote amount exceeds maximum allowed per vote')
    return credits, amount


def install(app, db, token_pet, limit, economy=None, deposit_settings=None):
    db.executescript('''
        CREATE TABLE IF NOT EXISTS collection_suggestions(
            id INTEGER PRIMARY KEY,chain_id INTEGER NOT NULL,address TEXT NOT NULL,
            name TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(chain_id,address));
        CREATE TABLE IF NOT EXISTS collection_votes(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            collection_id INTEGER NOT NULL,
            pet_id TEXT NOT NULL,
            credits INTEGER NOT NULL,
            frens_amount TEXT NOT NULL,
            created INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS collection_votes_collection ON collection_votes(collection_id);
        CREATE INDEX IF NOT EXISTS collection_votes_pet ON collection_votes(pet_id);
    ''')
    db.commit()

    def collection(row):
        data = dict(id=row[0], chainId=row[1], address=row[2], name=row[3], created=row[4])
        if len(row) > 5:
            data['credits'] = row[5]
            data['votes'] = row[6]
            per = economy.credits_per_frens if economy else 100
            data['frens'] = round(row[5] / per, 4) if row[5] % per else row[5] // per
        else:
            data['credits'] = 0
            data['votes'] = 0
            data['frens'] = 0
        return data

    async def listing(request):
        rows = db.execute(
            'SELECT s.id, s.chain_id, s.address, s.name, s.created, '
            'COALESCE(SUM(v.credits), 0) AS total_credits, '
            'COUNT(v.id) AS vote_count '
            'FROM collection_suggestions s '
            'LEFT JOIN collection_votes v ON s.id = v.collection_id '
            'GROUP BY s.id '
            'ORDER BY total_credits DESC, s.created DESC, s.id DESC '
            'LIMIT 100'
        ).fetchall()
        return web.json_response({'collections': [collection(row) for row in rows]})

    async def submit(request):
        try:
            body = await request.json()
            pid = token_pet(body.get('token'))
            chain = body.get('chainId')
            if type(chain) is not int or not 1 <= chain <= 2147483647:
                raise ValueError('Choose a network or enter a valid chain ID.')
            address = body.get('address')
            if not isinstance(address, str) or not re.fullmatch(r'0x[0-9a-fA-F]{40}', address) or int(address, 16) == 0:
                raise ValueError('Enter the NFT collection contract address (0x followed by 40 hexadecimal characters).')
            address = address.lower()
            name = body.get('name', '')
            if not isinstance(name, str) or len(name.strip()) > 100 or any(ord(c) < 32 for c in name):
                raise ValueError('Collection name must be 100 characters or fewer.')
            existing = db.execute('SELECT id,chain_id,address,name,created FROM collection_suggestions '
                                  'WHERE chain_id=? AND address=?', (chain, address)).fetchone()
            if existing:
                return web.json_response({'collection': collection(existing), 'existing': True})
            limit(('collection-suggestion', pid), 5, 86400)
            limit(('collection-suggestion-ip', request.remote or '?'), 20, 3600)
            if db.execute('SELECT COUNT(*) FROM collection_suggestions').fetchone()[0] >= 500:
                raise ValueError('Suggestions are full for now. Please try again later.')
            with db:
                cursor = db.execute('INSERT INTO collection_suggestions(chain_id,address,name,created) VALUES(?,?,?,?)',
                                    (chain, address, name.strip(), int(time.time())))
            row = db.execute('SELECT id,chain_id,address,name,created FROM collection_suggestions WHERE id=?',
                             (cursor.lastrowid,)).fetchone()
            return web.json_response({'collection': collection(row), 'existing': False}, status=201)
        except (ValueError, TypeError, AttributeError, json.JSONDecodeError) as exc:
            return web.json_response({'error': str(exc)}, status=400)

    async def vote(request):
        try:
            body = await request.json()
            pid = token_pet(body.get('token'))
            if economy is None:
                return web.json_response({'error': 'Economy is not enabled on this server'}, status=503)
            cid = body.get('collectionId')
            if type(cid) is not int or cid <= 0:
                raise ValueError('Select a valid collection to vote on')
            coll = db.execute('SELECT id, name FROM collection_suggestions WHERE id=?', (cid,)).fetchone()
            if not coll:
                raise ValueError('Collection suggestion not found')
            credits, clean_amount = parse_frens_to_credits(body.get('amount'), economy.credits_per_frens)
            limit(('collection-vote', pid), 60, 3600)
            limit(('collection-vote-ip', request.remote or '?'), 120, 3600)
            try:
                remaining = economy.spend(pid, credits, reason='vote', ref_type='collection', ref_id=str(cid))
            except InsufficientCredits:
                cur_balance = economy.balance(pid)
                return web.json_response({
                    'error': 'Insufficient deposited FRENS balance',
                    'balance': cur_balance,
                    'creditsPerFrens': economy.credits_per_frens,
                    'requiredCredits': credits,
                    'shortfallCredits': max(0, credits - cur_balance),
                }, status=400, headers={'Cache-Control': 'no-store'})
            with db:
                db.execute(
                    'INSERT INTO collection_votes(collection_id, pet_id, credits, frens_amount, created) VALUES(?,?,?,?,?)',
                    (cid, pid, credits, clean_amount, int(time.time())),
                )
            return web.json_response({
                'success': True,
                'collectionId': cid,
                'collectionName': coll[1],
                'creditsBurned': credits,
                'frensBurned': clean_amount,
                'balance': remaining,
                'creditsPerFrens': economy.credits_per_frens,
            }, headers={'Cache-Control': 'no-store'})
        except (ValueError, TypeError, AttributeError, json.JSONDecodeError) as exc:
            return web.json_response({'error': str(exc)}, status=400, headers={'Cache-Control': 'no-store'})

    async def vote_status(request):
        try:
            body = await request.json() if request.can_read_body else {}
        except Exception:
            body = {}
        balance = 0
        if isinstance(body, dict) and body.get('token'):
            try:
                pid = token_pet(body.get('token'))
                balance = economy.balance(pid) if economy else 0
            except Exception:
                pass
        dep = deposit_settings() if deposit_settings else {}
        deposit_info = {
            'enabled': bool(dep.get('enabled') and dep.get('address') and economy is not None),
            'address': dep.get('address') if dep.get('enabled') and economy is not None else None,
            'chainId': dep.get('chainId', 8453),
            'token': dep.get('token', '0x1A96226727a1D0a46334b3A4b3878B32B7659ba3'),
        }
        return web.json_response({
            'balance': balance,
            'creditsPerFrens': economy.credits_per_frens if economy else 100,
            'deposit': deposit_info,
        }, headers={'Cache-Control': 'no-store'})

    app.router.add_get('/api/collections/suggestions', listing)
    app.router.add_post('/api/collections/suggestions', submit)
    app.router.add_post('/api/collections/vote', vote)
    app.router.add_post('/api/vote/status', vote_status)
    app.router.add_get('/api/vote/status', vote_status)
