import asyncio
import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from Crypto.Hash import SHA256
from Crypto.PublicKey import RSA
from Crypto.Signature import pkcs1_15

import github_app


class GitHubAppTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = RSA.generate(2048)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'app.pem'
        self.path.write_bytes(self.key.export_key())
        self.clock = 1700000000
        self.app = github_app.GitHubApp('app-client-id', self.path, now=lambda: self.clock)

    def response(self, token='installation-token'):
        expires = datetime.fromtimestamp(self.clock + 3600, timezone.utc).isoformat()
        return {'token': token, 'expires_at': expires}

    def test_jwt_has_real_rsa_signature_and_short_lived_claims(self):
        signed = self.app.jwt()
        header, claims, signature = signed.split('.')
        decode = lambda part: base64.urlsafe_b64decode(part + '=' * (-len(part) % 4))
        self.assertEqual(json.loads(decode(header))['alg'], 'RS256')
        self.assertEqual(json.loads(decode(claims)),
                         {'iat': self.clock - 60, 'exp': self.clock + 540, 'iss': 'app-client-id'})
        pkcs1_15.new(self.key.public_key()).verify(
            SHA256.new((header + '.' + claims).encode()), decode(signature))

    async def test_discovers_installation_and_limits_token_to_repository_issues(self):
        self.app._request = mock.AsyncMock(side_effect=[{'id': 123}, self.response()])
        self.assertEqual(await self.app.token('owner', 'repo'), 'installation-token')
        first, second = self.app._request.await_args_list
        self.assertEqual(first.args[:2], ('GET', '/repos/owner/repo/installation'))
        self.assertEqual(second.args[:2], ('POST', '/app/installations/123/access_tokens'))
        self.assertEqual(second.args[3], {'repositories': ['repo'], 'permissions': {'issues': 'write'}})

    async def test_concurrent_requests_share_cached_token_then_refresh_before_expiry(self):
        refreshed = self.response('renewed-token')
        refreshed['expires_at'] = datetime.fromtimestamp(self.clock + 7200, timezone.utc).isoformat()
        self.app._request = mock.AsyncMock(side_effect=[{'id': 123}, self.response(),
                                                       {'id': 123}, refreshed])
        results = await asyncio.gather(*(self.app.token('owner', 'repo') for _ in range(3)))
        self.assertEqual(results, ['installation-token'] * 3)
        self.assertEqual(self.app._request.await_count, 2)
        self.clock += 3541
        self.assertEqual(await self.app.token('owner', 'repo'), 'renewed-token')
        self.assertEqual(self.app._request.await_count, 4)

    async def test_explicit_installation_avoids_discovery(self):
        self.app.installation_id = '456'
        self.app._request = mock.AsyncMock(return_value=self.response())
        await self.app.token('owner', 'repo')
        self.assertEqual(self.app._request.await_count, 1)
        self.assertEqual(self.app._request.await_args.args[1], '/app/installations/456/access_tokens')

    async def test_replaced_key_invalidates_cached_token(self):
        self.app.installation_id = '456'
        self.app._request = mock.AsyncMock(side_effect=[self.response(), self.response('rotated')])
        await self.app.token('owner', 'repo')
        self.path.write_bytes(self.key.export_key() + b'\n')
        self.assertEqual(await self.app.token('owner', 'repo'), 'rotated')
        self.assertEqual(self.app._request.await_count, 2)

    async def test_missing_key_fails_without_leaking_file_contents(self):
        self.path.unlink()
        with self.assertRaisesRegex(ValueError, '^GitHub App private key is missing or invalid$'):
            await self.app.token('owner', 'repo')

    async def test_expired_response_is_not_cached(self):
        self.app.installation_id = '456'
        self.app._request = mock.AsyncMock(return_value={'token': 'secret', 'expires_at': '2000-01-01T00:00:00Z'})
        with self.assertRaisesRegex(ValueError, '^GitHub App returned an invalid installation token$'):
            await self.app.token('owner', 'repo')
        self.assertEqual(self.app.cache, {})

    async def test_static_token_remains_compatible_when_no_app_is_configured(self):
        with mock.patch.dict(os.environ, {'GITHUB_TOKEN': 'static-token'}, clear=True):
            self.assertEqual(await github_app.token('owner', 'repo'), 'static-token')

    async def test_partial_app_configuration_does_not_fall_back_to_static_token(self):
        with mock.patch.dict(os.environ, {'GITHUB_APP_ID': '123', 'GITHUB_TOKEN': 'static-token'}, clear=True):
            with self.assertRaisesRegex(ValueError, 'GitHub App needs'):
                await github_app.token('owner', 'repo')
