import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createAppContext } from '../../src/context.js';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';

describe('Static web and generic preflight parity', () => {
  let app: FastifyInstance;

  before(async () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);
    app = await buildApp({
      context: createAppContext(loadConfig({ ALLOWED_ORIGINS: 'https://tinyfrens.lol' }), db),
    });
    await app.ready();
  });

  after(async () => app.close());

  test('serves browser assets with MIME types and public CORS', async () => {
    const response = await app.inject({ method: 'GET', url: '/web/app.js' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'text/javascript');
    assert.equal(response.headers['cache-control'], undefined);
    assert.equal(response.headers['access-control-allow-origin'], '*');
    assert.match(response.body, /TinyFrens|pet|document/i);
  });

  test('blocks traversal outside the web root', async () => {
    const response = await app.inject({ method: 'GET', url: '/web/%2e%2e/server/.env.example' });
    assert.ok([400, 403, 404].includes(response.statusCode));
    assert.doesNotMatch(response.body, /GITHUB_APP_PRIVATE_KEY_PATH/);
  });

  test('answers generic OPTIONS with Python-compatible CORS headers', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/wallet-link/status',
      headers: { origin: 'https://tinyfrens.lol' },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['access-control-allow-origin'], 'https://tinyfrens.lol');
    assert.equal(response.headers['access-control-allow-methods'], 'POST, GET, OPTIONS');
    assert.equal(response.headers['cache-control'], 'no-store');
  });
});
