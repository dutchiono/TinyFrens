"""TinyFrens — Discord Activity / Bot integration helpers (Phase 2).

Discord "Activities" are multiplayer experiences rendered inside an iframe within a
voice channel. They talk to the client through the Embedded App SDK
(@discord/embedded-app-sdk), which handles its own OAuth2 handshake in the browser.
The only server responsibilities for registering the app are:

* Verifying the Ed25519 ``X-Signature-Ed25519`` header on Interactions so the
  endpoint can answer Discord's ``PING`` (type 1) and pass App Directory validation.
* Exchanging an OAuth2 authorization ``code`` for an access token so the Activity
  can identify the current user/channel and join a per-channel party room.

Docs: https://docs.discord.com/developers/platform/activities
      https://docs.discord.com/developers/platform/interactions
"""
import json

from aiohttp import BasicAuth, ClientSession, ClientTimeout

DISCORD_API = 'https://discord.com/api/v10'


def verify_interaction(signature, timestamp, body, public_key):
    """Verify a Discord interaction signature (Ed25519).

    Returns True/False when PyNaCl is installed, or ``None`` when it is missing
    (so the caller can answer with a helpful "not configured" error instead of a
    crash). Add ``PyNaCl`` to requirements to enable real verification.
    """
    if not (signature and timestamp and public_key):
        return False
    try:
        import nacl.signing  # type: ignore
        import nacl.exceptions  # type: ignore
    except Exception:
        return None
    try:
        verify_key = nacl.signing.VerifyKey(bytes.fromhex(public_key))
        verify_key.verify(timestamp.encode() + body, bytes.fromhex(signature))
        return True
    except (nacl.exceptions.BadSignatureError, ValueError):
        return False
    except Exception:
        return False


async def exchange_code(code, client_id, client_secret, redirect_uri=''):
    """Exchange an OAuth2 authorization code for tokens. Returns (data, status)."""
    form = {'grant_type': 'authorization_code', 'code': code}
    if redirect_uri:
        form['redirect_uri'] = redirect_uri
    timeout = ClientTimeout(total=15)
    async with ClientSession(timeout=timeout) as session:
        async with session.post(DISCORD_API + '/oauth2/token', data=form,
                                auth=BasicAuth(client_id, client_secret)) as response:
            return await response.json(content_type=None), response.status


def channel_room_id(channel_id):
    """Return a stable party-room id for a Discord channel (``dc:<id>``)."""
    if not channel_id:
        return None
    return 'dc:' + str(channel_id)
