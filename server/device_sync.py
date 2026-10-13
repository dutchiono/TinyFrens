"""Approved device groups share wallet links and companion choices, never device secrets."""
import json
import re
import secrets
import time

from aiohttp import web

COLLECTIONS = {
    (4663, '0xca28587b61eac19a87dfcfd9420870867a916675'),
    (4663, '0x34d9e560ee16662d19e44315a822bd51eea0133c'),
    (8453, '0x8d446c126d4873bfa3eb195b7f0094acc1187a75'),
    (8453, '0xd745d8005a1ad8f783b97bf55e0d0e6a920ea8ff'),
}


def ensure_account(db, pid):
    """Return the shared account for a device, creating its solo account once."""
    row = db.execute('SELECT account FROM device_sync_members WHERE device=?', (pid,)).fetchone()
    if row:
        return row[0]
    aid = secrets.token_urlsafe(24)
    with db:
        db.execute('INSERT INTO device_sync_members VALUES(?,?)', (pid, aid))
        db.execute('INSERT INTO device_sync_accounts VALUES(?,0,?)', (aid, '[]'))
    return aid


def request_sync(db, pid, raw_code, label='Telegram Mini App'):
    """Create the same approval request as /device-sync/request for a trusted adapter."""
    code = str(raw_code).replace('-', '').replace(' ', '').upper()
    row = db.execute('SELECT device,expires,requester FROM device_sync_codes WHERE code=?', (code,)).fetchone()
    if not row or row[1] <= time.time():
        raise ValueError('Code expired or not found. Create a new code.')
    if ensure_account(db, pid) == ensure_account(db, row[0]):
        raise ValueError('Telegram is already linked to this TinyFrens account')
    if row[2]:
        raise ValueError('This code already has a request. Create a new code.')
    rid = secrets.token_urlsafe(24)
    with db:
        db.execute('UPDATE device_sync_codes SET requester=?,request_id=?,label=? WHERE code=?',
                   (pid, rid, str(label)[:40], code))
    return {'waiting': True, 'requestId': rid}


def selection(value):
    if not isinstance(value, list) or len(value) > 5:
        raise ValueError('Choose up to five companions')
    result = []
    for item in value:
        chain, address, token = item['chainId'], item['originalAddress'].lower(), item['tokenId']
        motion = item.get('motion', {})
        mode, speed, size = motion.get('mode', 'roam'), motion.get('speed', 60), motion.get('size', 80)
        if (chain, address) not in COLLECTIONS or type(token) is not int or not 1 <= token <= 10000:
            raise ValueError('Unsupported companion')
        if mode not in ('roam', 'bubble') or type(speed) is not int or not 20 <= speed <= 140 or type(size) is not int or not 48 <= size <= 128:
            raise ValueError('Invalid companion settings')
        clean = dict(chainId=chain, originalAddress=address, tokenId=token, motion=dict(mode=mode, speed=speed, size=size))
        if any((n['chainId'], n['originalAddress'], n['tokenId']) == (chain, address, token) for n in result):
            raise ValueError('Duplicate companion')
        result.append(clean)
    return result


def install(app, db, token_pet, limit):
    from turtle_connect import linked_wallets, wallet_devices
    db.executescript('''
        CREATE TABLE IF NOT EXISTS device_sync_members(device TEXT PRIMARY KEY, account TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS device_sync_accounts(account TEXT PRIMARY KEY, revision INTEGER NOT NULL, selection TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS device_sync_codes(code TEXT PRIMARY KEY, device TEXT UNIQUE NOT NULL, expires REAL NOT NULL,
            requester TEXT, request_id TEXT, label TEXT);
    ''')

    def snapshot(pid):
        aid = ensure_account(db, pid)
        revision, items = db.execute('SELECT revision,selection FROM device_sync_accounts WHERE account=?', (aid,)).fetchone()
        return {'account': aid, 'revision': revision, 'selection': json.loads(items), 'devices': len(wallet_devices(db, pid)), 'addresses': linked_wallets(db, pid)}

    def code_row(code):
        code = str(code).replace('-', '').replace(' ', '').upper()
        row = db.execute('SELECT device,expires,requester,request_id,label FROM device_sync_codes WHERE code=?', (code,)).fetchone()
        if not row or row[1] <= time.time():
            raise ValueError('Code expired or not found. Create a new code.')
        return code, row

    async def state(pid, body):
        aid = ensure_account(db, pid)
        if 'selection' in body:
            items = selection(body['selection'])
            with db:
                changed = db.execute('UPDATE device_sync_accounts SET selection=?,revision=revision+1 WHERE account=? AND revision=?',
                                     (json.dumps(items), aid, body.get('revision'))).rowcount
            if not changed:
                return web.json_response({'error': 'Another device changed your selection. Refreshing.', **snapshot(pid)}, status=409)
        return snapshot(pid)

    async def start(pid, body):
        ensure_account(db, pid)
        code = ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(12))
        expires = time.time() + 600
        with db:
            db.execute('DELETE FROM device_sync_codes WHERE device=? OR expires<=?', (pid, time.time()))
            db.execute('INSERT INTO device_sync_codes(code,device,expires) VALUES(?,?,?)', (code, pid, expires))
        return {'code': code, 'expires': expires}

    async def request(pid, body):
        code, row = code_row(body.get('code'))
        return request_sync(db, pid, code, body.get('label', 'TinyFrens device'))

    async def status(pid, body):
        code, row = code_row(body.get('code'))
        if pid not in (row[0], row[2]):
            raise ValueError('This request belongs to another device')
        return {'pending': bool(row[2]), 'requestId': row[3], 'label': row[4], 'expires': row[1]}

    async def accept(pid, body):
        code, row = code_row(body.get('code'))
        if row[0] != pid or not row[2] or row[3] != body.get('requestId'):
            raise ValueError('This device has no matching request to approve')
        source, target = ensure_account(db, pid), ensure_account(db, row[2])
        members = list(dict.fromkeys(wallet_devices(db, pid) + wallet_devices(db, row[2])))
        addresses = list(dict.fromkeys(a for device in members for a in linked_wallets(db, device)))
        if len(members) > 20 or len({a.lower() for a in addresses}) > 10:
            raise ValueError('Sync supports up to 20 devices and 10 wallets')
        # Keep each wallet's original link time across the whole group. Copying with a
        # fresh per-device timestamp made synced devices disagree on wallet order
        # whenever the copy crossed a second boundary (linked_wallets orders by created).
        linked_at = {}
        for device in members:
            for address, created in db.execute('SELECT address,created FROM wallet_links WHERE pet_id=?', (device,)):
                key = address.lower()
                if key not in linked_at or created < linked_at[key]:
                    linked_at[key] = created
        fallback = int(time.time())
        with db:
            from account_profile import merge_accounts
            merge_accounts(db, source, target)
            db.execute('UPDATE device_sync_members SET account=? WHERE account=?', (source, target))
            db.execute('DELETE FROM device_sync_accounts WHERE account=?', (target,))
            for device in members:
                for address in addresses:
                    db.execute('INSERT OR IGNORE INTO wallet_links VALUES(?,?,?)',
                               (device, address, linked_at.get(address.lower(), fallback)))
                # A request created before account merging must not add another wallet later.
                db.execute('DELETE FROM turtle_pairings WHERE pet_id=?', (device,))
                db.execute('DELETE FROM wallet_link_challenges WHERE pet_id=?', (device,))
            db.execute('UPDATE device_sync_accounts SET revision=revision+1 WHERE account=?', (source,))
            db.execute('DELETE FROM device_sync_codes WHERE device IN (SELECT device FROM device_sync_members WHERE account=?)', (source,))
        return snapshot(pid)

    async def leave(pid, body):
        old = snapshot(pid)
        with db:
            db.execute('DELETE FROM device_sync_members WHERE device=?', (pid,))
            db.execute('DELETE FROM device_sync_codes WHERE device=? OR requester=?', (pid, pid))
        aid = ensure_account(db, pid)
        with db:
            db.execute('UPDATE device_sync_accounts SET selection=?,revision=1 WHERE account=?', (json.dumps(old['selection']), aid))
        return snapshot(pid)

    def handler(action):
        async def handle(http):
            try:
                body = await http.json()
                pid = token_pet(body.get('token'))
                limit(('device-sync', action.__name__, pid), 120 if action in (state, status) else 20, 60)
                if action == request:
                    limit(('device-sync-request', http.remote), 20, 60)
                result = await action(pid, body)
                if isinstance(result, web.StreamResponse):
                    result.headers['Cache-Control'] = 'no-store'
                    return result
                return web.json_response(result, headers={'Cache-Control': 'no-store'})
            except (ValueError, TypeError, KeyError, AttributeError) as exc:
                return web.json_response({'error': str(exc)}, status=400, headers={'Cache-Control': 'no-store'})
        return handle

    for name, action in [('state', state), ('start', start), ('request', request), ('status', status), ('accept', accept), ('leave', leave)]:
        app.router.add_post('/api/device-sync/' + name, handler(action))
