"""Short-lived GitHub App credentials, scoped to one repository's issues."""
import asyncio
import base64
from datetime import datetime
import json
import os
from pathlib import Path
import time

from aiohttp import ClientSession, ClientTimeout
from Crypto.Hash import SHA256
from Crypto.PublicKey import RSA
from Crypto.Signature import pkcs1_15

API = 'https://api.github.com'


def _encoded(value):
    return base64.urlsafe_b64encode(value).rstrip(b'=')


class GitHubApp:
    def __init__(self, issuer, key_path, installation_id=None, now=time.time):
        self.issuer, self.key_path = str(issuer), Path(key_path)
        self.installation_id, self.now = installation_id, now
        self.cache = {}
        self.lock = asyncio.Lock()

    def jwt(self):
        try:
            key = RSA.import_key(self.key_path.read_bytes())
            if not key.has_private():
                raise ValueError()
            stamp = int(self.now())
            header = _encoded(b'{"alg":"RS256","typ":"JWT"}')
            claims = _encoded(json.dumps({'iat': stamp - 60, 'exp': stamp + 540,
                                         'iss': self.issuer}, separators=(',', ':')).encode())
            message = header + b'.' + claims
            signature = pkcs1_15.new(key).sign(SHA256.new(message))
            return (message + b'.' + _encoded(signature)).decode()
        except (OSError, ValueError, IndexError, TypeError):
            raise ValueError('GitHub App private key is missing or invalid') from None

    async def _request(self, method, path, jwt, body=None):
        headers = {'Authorization': 'Bearer ' + jwt,
                   'Accept': 'application/vnd.github+json',
                   'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'TinyFrens-Telegram-Bot'}
        async with ClientSession(timeout=ClientTimeout(total=20)) as session:
            async with session.request(method, API + path, headers=headers, json=body) as response:
                if response.status >= 400:
                    raise ValueError(f'GitHub App authentication failed (HTTP {response.status})')
                return await response.json()

    async def token(self, owner, repo):
        async with self.lock:
            # A replaced key invalidates the cached credential configuration too.
            try:
                stat = self.key_path.stat()
            except OSError:
                raise ValueError('GitHub App private key is missing or invalid') from None
            cache_key = (owner, repo, stat.st_mtime_ns, stat.st_size)
            cached = self.cache.get(cache_key)
            if cached and self.now() < cached[1] - 60:
                return cached[0]
            jwt = self.jwt()
            installation = self.installation_id
            if not installation:
                data = await self._request('GET', f'/repos/{owner}/{repo}/installation', jwt)
                installation = data.get('id')
            try:
                installation = int(installation)
                if installation <= 0:
                    raise ValueError()
            except (ValueError, TypeError):
                raise ValueError('GitHub App installation ID is invalid') from None
            data = await self._request('POST', f'/app/installations/{installation}/access_tokens', jwt,
                                       {'repositories': [repo], 'permissions': {'issues': 'write'}})
            try:
                token = data['token']
                expires = datetime.fromisoformat(data['expires_at'].replace('Z', '+00:00')).timestamp()
                if not isinstance(token, str) or not token or expires <= self.now() + 60:
                    raise ValueError()
            except (KeyError, TypeError, ValueError):
                raise ValueError('GitHub App returned an invalid installation token') from None
            self.cache = {cache_key: (token, expires)}
            return token


_provider = None
_configuration = None


async def token(owner, repo):
    global _provider, _configuration
    settings = tuple(os.environ.get(name, '').strip() for name in
                     ('GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY_PATH', 'GITHUB_APP_INSTALLATION_ID'))
    if not any(settings):
        return os.environ.get('GITHUB_TOKEN')
    if not settings[0] or not settings[1]:
        raise ValueError('GitHub App needs GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_PATH')
    if settings != _configuration:
        _provider = GitHubApp(*settings)
        _configuration = settings
    return await _provider.token(owner, repo)
