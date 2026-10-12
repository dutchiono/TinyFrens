"""Persistent collection suggestions, separate from live voting ballots."""
import json
import re
import time
from aiohttp import web


def install(app, db, token_pet, limit):
    db.execute('CREATE TABLE IF NOT EXISTS collection_suggestions('
               'id INTEGER PRIMARY KEY,chain_id INTEGER NOT NULL,address TEXT NOT NULL,'
               'name TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(chain_id,address))')
    db.commit()

    def collection(row):
        return dict(id=row[0], chainId=row[1], address=row[2], name=row[3], created=row[4])

    async def listing(request):
        rows = db.execute('SELECT id,chain_id,address,name,created FROM collection_suggestions '
                          'ORDER BY created DESC,id DESC LIMIT 100').fetchall()
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

    app.router.add_get('/api/collections/suggestions', listing)
    app.router.add_post('/api/collections/suggestions', submit)
