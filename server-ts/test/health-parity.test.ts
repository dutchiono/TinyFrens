import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createDbConnection } from '../src/db/connection.js';
import { initSchema } from '../src/db/schema.js';
import { createAppContext } from '../src/context.js';
import { buildApp } from '../src/app.js';

describe('HTTP /health Route & Middleware Parity', () => {
  async function setupTestApp() {
    const config = loadConfig({
      ALLOWED_ORIGINS: 'https://tinyfrens.lol,https://www.tinyfrens.lol',
      ALLOW_NATIVE_ORIGIN: 'false',
    });
    const db = createDbConnection(':memory:');
    initSchema(db);
    const context = createAppContext(config, db);
    const app = await buildApp({ context });
    return { app, db };
  }

  test('GET /health returns 200 with {"ok":true} matching Python', async () => {
    const { app, db } = await setupTestApp();

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.deepEqual(body, { ok: true });

    // Public CORS headers
    assert.equal(response.headers['access-control-allow-origin'], '*');
    assert.equal(response.headers['access-control-allow-methods'], 'POST, GET, OPTIONS');
    assert.ok(response.headers['access-control-allow-headers']?.includes('Content-Type'));

    await app.close();
  });

  test('GET /health fails when SQLite is unavailable', async () => {
    const { app, db } = await setupTestApp();
    db.close();

    const response = await app.inject({ method: 'GET', url: '/health' });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body), { ok: false });
    await app.close();
  });

  test('GET /health/revision exposes the exact deployed revision', async () => {
    const revision = 'a'.repeat(40);
    const config = loadConfig({ APP_REVISION: revision });
    const db = createDbConnection(':memory:');
    initSchema(db);
    const app = await buildApp({ context: createAppContext(config, db) });

    const response = await app.inject({ method: 'GET', url: '/health/revision' });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { ok: true, revision });
    await app.close();
  });

  test('OPTIONS /health preflight returns 200 with CORS headers', async () => {
    const { app } = await setupTestApp();

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/health',
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['access-control-allow-origin'], '*');
    assert.equal(response.headers['access-control-allow-methods'], 'POST, GET, OPTIONS');

    await app.close();
  });

  test('Disallowed origin on protected route returns 403 Origin not allowed', async () => {
    const { app } = await setupTestApp();

    // Register a private route to test origin guard rejection
    app.post('/api/private-test', async () => ({ secret: true }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/private-test',
      headers: {
        origin: 'https://malicious.site',
      },
      payload: {},
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.headers['content-type'], 'text/plain; charset=utf-8');
    assert.equal(response.body, 'Origin not allowed');

    await app.close();
  });

  test('Allowed origin on private route returns proper CORS and Vary headers', async () => {
    const { app } = await setupTestApp();

    app.post('/api/private-test', async () => ({ success: true }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/private-test',
      headers: {
        origin: 'https://tinyfrens.lol',
      },
      payload: {},
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['access-control-allow-origin'], 'https://tinyfrens.lol');
    assert.equal(response.headers['vary'], 'Origin');
    assert.equal(response.headers['cache-control'], 'no-store');

    await app.close();
  });
});
