"""Shared TinyFrens account names and verified social identities."""
import re
import time

from aiohttp import web

from device_sync import ensure_account


def install_schema(db):
    db.executescript('''
        CREATE TABLE IF NOT EXISTS account_profiles(
            account TEXT PRIMARY KEY, display_name TEXT NOT NULL DEFAULT '',
            x_handle TEXT NOT NULL DEFAULT '', updated INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS account_identities(
            account TEXT NOT NULL, platform TEXT NOT NULL, subject TEXT NOT NULL,
            handle TEXT NOT NULL DEFAULT '', display_name TEXT NOT NULL DEFAULT '',
            verified INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL,
            PRIMARY KEY(platform,subject));
    ''')


def clean_name(value):
    value = re.sub(r'\s+', ' ', re.sub(r'[\x00-\x1f\x7f]', '', str(value or ''))).strip()
    if value and not 1 <= len(value) <= 32:
        raise ValueError('Display name must be 1 to 32 characters')
    return value


def telegram_identity(db, pid, user):
    install_schema(db)
    account = ensure_account(db, pid)
    subject = str(user.get('id', ''))
    if not subject:
        raise ValueError('Telegram user is missing')
    handle = str(user.get('username') or '')[:32]
    name = clean_name(' '.join(filter(None, [user.get('first_name'), user.get('last_name')])))
    with db:
        db.execute('INSERT OR REPLACE INTO account_identities VALUES(?,?,?,?,?,?,?)',
                   (account, 'telegram', subject, handle, name, 1, int(time.time())))
    return account


def merge_accounts(db, source, target):
    """Move public profile data before device_sync removes the target account."""
    if source == target:
        return
    install_schema(db)
    source_profile = db.execute('SELECT display_name,x_handle FROM account_profiles WHERE account=?', (source,)).fetchone()
    target_profile = db.execute('SELECT display_name,x_handle FROM account_profiles WHERE account=?', (target,)).fetchone()
    if target_profile:
        display = (source_profile[0] if source_profile else '') or target_profile[0]
        x_handle = (source_profile[1] if source_profile else '') or target_profile[1]
        db.execute('INSERT OR REPLACE INTO account_profiles VALUES(?,?,?,?)',
                   (source, display, x_handle, int(time.time())))
    db.execute('UPDATE account_identities SET account=? WHERE account=?', (source, target))
    db.execute('DELETE FROM account_profiles WHERE account=?', (target,))


def read(db, pid):
    install_schema(db)
    account = ensure_account(db, pid)
    row = db.execute('SELECT display_name,x_handle FROM account_profiles WHERE account=?', (account,)).fetchone()
    identities = [dict(platform=r[0], handle=r[1], displayName=r[2], verified=bool(r[3]))
                  for r in db.execute('SELECT platform,handle,display_name,verified FROM account_identities '
                                      'WHERE account=? ORDER BY platform,updated', (account,))]
    # Legacy profile values and wallet assertions do not prove X ownership.
    x_identity = next((item for item in identities if item['platform'] == 'x' and item['verified']), None)
    x_handle = x_identity['handle'] if x_identity else ''
    source = 'verified-identity' if x_identity else None
    return {'displayName': row[0] if row else '', 'xHandle': x_handle,
            'xHandleSource': source, 'identities': identities}


def install(app, db, token_pet, limit):
    install_schema(db)

    async def profile(request):
        try:
            body = await request.json()
            pid = token_pet(body.get('token'))
            limit(('account-profile', pid), 30, 60)
            if 'xHandle' in body:
                raise ValueError('X handles require verified X ownership and cannot be edited manually')
            if 'displayName' in body:
                current = read(db, pid)
                display = clean_name(body.get('displayName', current['displayName']))
                with db:
                    db.execute('INSERT OR REPLACE INTO account_profiles VALUES(?,?,?,?)',
                               (ensure_account(db, pid), display, '', int(time.time())))
            return web.json_response(read(db, pid), headers={'Cache-Control': 'no-store'})
        except (ValueError, TypeError, KeyError) as exc:
            return web.json_response({'error': str(exc)}, status=400, headers={'Cache-Control': 'no-store'})

    app.router.add_post('/api/account/profile', profile)
