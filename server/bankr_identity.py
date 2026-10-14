"""Verify Bankr's X-to-wallet mapping without receiving a user's API key."""
from aiohttp import ClientSession, ClientTimeout, ClientError


async def verify_handle(handle, wallet):
    try:
        async with ClientSession(timeout=ClientTimeout(total=12)) as session:
            async with session.get('https://api.bankr.bot/addresses/resolve',
                                   params={'value': handle, 'type': 'twitter'}, allow_redirects=False) as response:
                if response.status != 200:
                    raise RuntimeError('Bankr X verification unavailable. Retry the connection.')
                data = await response.json()
        if data.get('resolved') is not True or str(data.get('address', '')).lower() != wallet.lower():
            raise ValueError('Bankr does not link this X handle to the signing wallet')
    except (ClientError, TimeoutError) as exc:
        raise RuntimeError('Bankr X verification unavailable. Retry the connection.') from exc
