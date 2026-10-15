import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../../src/config.js';
import { GitHubApp, GitHubAuth } from '../../src/integrations/github-app.js';

describe('GitHub App installation authentication', () => {
  let directory: string;
  let keyPath: string;
  let privateKey: crypto.KeyObject;
  let publicKey: crypto.KeyObject;

  before(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'tinyfrens-github-app-'));
    ({ privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }));
    keyPath = path.join(directory, 'app.pem');
    writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  });

  after(() => rmSync(directory, { recursive: true, force: true }));

  test('creates a real RS256 JWT with short-lived claims', async () => {
    const app = new GitHubApp('app-client-id', keyPath, undefined, () => 1_700_000_000);
    const signed = await app.jwt();
    const [header, claims, signature] = signed.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
    assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url').toString()), {
      iat: 1_699_999_940,
      exp: 1_700_000_540,
      iss: 'app-client-id',
    });
    assert.equal(
      crypto.verify('RSA-SHA256', Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, 'base64url')),
      true
    );
  });

  test('discovers the installation and requests repository-scoped issue access', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      { id: 123 },
      { token: 'installation-token', expires_at: new Date(1_700_003_600_000).toISOString() },
    ];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return Response.json(responses.shift());
    };
    const app = new GitHubApp('123', keyPath, undefined, () => 1_700_000_000, fetcher);
    assert.equal(await app.token('owner', 'repo'), 'installation-token');
    assert.match(calls[0].url, /\/repos\/owner\/repo\/installation$/);
    assert.match(calls[1].url, /\/app\/installations\/123\/access_tokens$/);
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), {
      repositories: ['repo'],
      permissions: { issues: 'write' },
    });
  });

  test('shares concurrent refreshes, refreshes before expiry, and reloads replaced keys', async () => {
    let now = 1_700_000_000;
    let requests = 0;
    const fetcher: typeof fetch = async () => {
      requests += 1;
      return Response.json({
        token: `token-${requests}`,
        expires_at: new Date((now + 3600) * 1000).toISOString(),
      });
    };
    const app = new GitHubApp('123', keyPath, '456', () => now, fetcher);
    assert.deepEqual(await Promise.all([app.token('owner', 'repo'), app.token('owner', 'repo'), app.token('owner', 'repo')]), [
      'token-1', 'token-1', 'token-1',
    ]);
    assert.equal(requests, 1);
    now += 3541;
    assert.equal(await app.token('owner', 'repo'), 'token-2');
    writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }) + '\n');
    assert.equal(await app.token('owner', 'repo'), 'token-3');
  });

  test('fails closed for missing, partial, and invalid app credentials', async () => {
    const partial = new GitHubAuth(loadConfig({ GITHUB_APP_ID: '123', GITHUB_TOKEN: 'static-token' }));
    await assert.rejects(partial.token('owner', 'repo'), /GitHub App needs/);
    const missing = new GitHubApp('123', path.join(directory, 'missing.pem'));
    await assert.rejects(missing.token('owner', 'repo'), /^Error: GitHub App private key is missing or invalid$/);
    const invalidResponse: typeof fetch = async () => Response.json({ token: 'secret', expires_at: '2000-01-01T00:00:00Z' });
    const invalid = new GitHubApp('123', keyPath, '456', () => 1_700_000_000, invalidResponse);
    await assert.rejects(invalid.token('owner', 'repo'), /invalid installation token/);
    assert.equal(invalid.cache.size, 0);
  });

  test('retains static token compatibility when no app is configured', async () => {
    const auth = new GitHubAuth(loadConfig({ GITHUB_TOKEN: 'static-token' }));
    assert.equal(await auth.token('owner', 'repo'), 'static-token');
  });
});
