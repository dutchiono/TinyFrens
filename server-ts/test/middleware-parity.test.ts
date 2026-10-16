import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createAppContext } from '../src/context.js';
import { createDbConnection } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations.js';

async function setup(environment: Record<string, string> = {}) {
  const db = createDbConnection(':memory:');
  runMigrations(db);
  const context = createAppContext(loadConfig({
    ALLOWED_ORIGINS: 'https://tinyfrens.lol',
    ...environment,
  }), db);
  const app = await buildApp({ context });
  return app;
}

async function setupWithAlerts() {
  const db = createDbConnection(':memory:');
  runMigrations(db);
  const alerts: Array<{ key: string; title: string; detail?: string }> = [];
  const context = createAppContext(loadConfig({}), db, {
    operationalAlerts: {
      async report(key, title, detail) {
        alerts.push({ key, title, detail });
        return true;
      },
    },
  });
  return { app: await buildApp({ context }), alerts };
}

describe('application middleware parity', () => {
  test('allows Origin: null only when native origins are enabled', async () => {
    const enabled = await setup({ ALLOW_NATIVE_ORIGIN: 'true' });
    const accepted = await enabled.inject({
      method: 'POST',
      url: '/api/register',
      headers: { origin: 'null', 'content-type': 'application/json' },
      payload: {},
    });
    assert.equal(accepted.statusCode, 400);
    assert.equal(accepted.headers['access-control-allow-origin'], 'null');
    await enabled.close();

    const disabled = await setup({ ALLOW_NATIVE_ORIGIN: 'false' });
    const rejected = await disabled.inject({
      method: 'POST',
      url: '/api/register',
      headers: { origin: 'null', 'content-type': 'application/json' },
      payload: {},
    });
    assert.equal(rejected.statusCode, 403);
    assert.equal(rejected.body, 'Origin not allowed');
    await disabled.close();
  });

  test('uses the separate admin CORS contract without an Origin header', async () => {
    const app = await setup({ ADMIN_TOKEN: 'test-admin-token' });
    const response = await app.inject({ method: 'GET', url: '/api/admin/state' });
    assert.equal(response.statusCode, 401);
    assert.equal(response.headers['access-control-allow-origin'], '*');
    assert.equal(response.headers['access-control-allow-headers'], 'Content-Type, Authorization');
    assert.equal(response.headers['cache-control'], 'no-store');
    await app.close();
  });

  test('returns the frozen Python malformed JSON error', async () => {
    const app = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/register',
      headers: { origin: 'https://tinyfrens.lol', 'content-type': 'application/json' },
      payload: '{',
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(JSON.parse(response.body), {
      error: 'Expecting property name enclosed in double quotes: line 1 column 2 (char 1)',
    });
    await app.close();
  });

  test('rejects oversized bodies before origin response decoration', async () => {
    const app = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/register',
      headers: { origin: 'https://tinyfrens.lol', 'content-type': 'application/json' },
      payload: JSON.stringify({ pet: { name: 'x'.repeat(5000) } }),
    });
    assert.equal(response.statusCode, 413);
    assert.equal(response.headers['content-type'], 'text/plain; charset=utf-8');
    assert.equal(response.headers['access-control-allow-origin'], undefined);
    assert.equal(response.body, 'Maximum request body size 4096 exceeded.');
    await app.close();
  });

  test('redacts secrets from uncaught provider errors', async () => {
    const { app, alerts } = await setupWithAlerts();
    app.get('/api/admin/test-redaction', async () => {
      throw new Error(`provider rejected ghp_${'a'.repeat(36)}`);
    });
    const response = await app.inject({ method: 'GET', url: '/api/admin/test-redaction' });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(JSON.parse(response.body), { error: 'provider rejected [REDACTED_TOKEN]' });
    assert.doesNotMatch(response.body, /ghp_/);
    assert.equal(alerts.length, 2);
    assert.equal(alerts[0].key, 'http:GET:/api/admin/test-redaction');
    assert.match(alerts[0].title, /Unhandled HTTP 500/);
    assert.doesNotMatch(alerts[0].detail || '', /ghp_/);
    assert.match(alerts[1].title, /HTTP 500/);
    await app.close();
  });
});
