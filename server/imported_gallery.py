"""Public galleries of selected imports, never entire third-party collections."""
import json

from aiohttp import web
from extra_companions import COLLECTIONS as EXTRAS
from robot_companion import CONTRACT
from turtle_connect import COLLECTION, CHAIN_ID


COLLECTIONS = [
    dict(id='robots', name='Robots v1', contract=CONTRACT, chainId=8453, release=True, explorer='https://basescan.org'),
    dict(id='hood-turtles', name='Hood Turtles', contract=COLLECTION, chainId=CHAIN_ID, release=False, explorer=None),
    *[dict(id='nubs' if chain == 4663 else 'bots-computers', name=name, contract=address,
           chainId=chain, release=False, explorer=None if chain == 4663 else 'https://basescan.org')
      for address, (chain, _, name, _) in EXTRAS.items()],
]


def imported_page(db, collection, after=0):
    items = {}
    # A saved selection alone is not ownership proof. Require its account's
    # linked wallet and a successful verifier payload for this exact collection.
    rows = db.execute('SELECT DISTINCT a.account,a.selection,w.address FROM device_sync_accounts a '
                      'JOIN device_sync_members m ON m.account=a.account '
                      'JOIN wallet_links w ON w.pet_id=m.device')
    for _, selected, wallet in rows:
        for nft in json.loads(selected):
            if (nft.get('chainId'), nft.get('originalAddress')) != (collection['chainId'], collection['contract']):
                continue
            tid = nft.get('tokenId')
            if type(tid) is not int or tid <= after or tid in items:
                continue
            if collection['contract'] == COLLECTION:
                row = db.execute('SELECT payload FROM turtle_ownership WHERE wallet=? COLLATE NOCASE AND token_id=?', (wallet, tid)).fetchone()
            else:
                row = db.execute('SELECT payload FROM extra_companion_ownership WHERE wallet=? COLLATE NOCASE AND collection=? AND token=?',
                                 (wallet, collection['contract'], tid)).fetchone()
            if not row:
                continue
            data = json.loads(row[0])
            if (not data.get('active') or data.get('chainId') != collection['chainId']
                    or data.get('originalAddress') != collection['contract'] or data.get('tokenId') != tid
                    or str(data.get('originalOwner', '')).lower() != wallet.lower() or not data.get('image')):
                continue
            items[tid] = dict(tokenId=tid, metadata=dict(name=data.get('name'), image=data['image']),
                              owner=data['originalOwner'], checkedAt=data.get('checkedAt'))
    ids = sorted(items)
    selected = ids[:24]
    return dict(contract=collection['contract'], chainId=collection['chainId'], items=[items[tid] for tid in selected],
                nextAfter=selected[-1] if len(ids) > 24 else None)


def install(app, db):
    async def collections(request):
        return web.json_response({'collections': COLLECTIONS}, headers={'Cache-Control': 'public, max-age=60'})

    async def imported(request):
        try:
            collection = next((c for c in COLLECTIONS if c['id'] == request.query.get('collection') and not c['release']), None)
            if not collection:
                raise ValueError('Unsupported imported collection')
            after = int(request.query.get('after', '0'))
            if not 0 <= after <= 10000:
                raise ValueError('Invalid gallery cursor')
            return web.json_response(imported_page(db, collection, after), headers={'Cache-Control': 'no-store'})
        except ValueError as exc:
            return web.json_response({'error': str(exc)}, status=400)

    app.router.add_get('/api/gallery/collections', collections)
    app.router.add_get('/api/gallery/imported', imported)
