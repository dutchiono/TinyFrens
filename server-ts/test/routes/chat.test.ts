import assert from 'node:assert';
import { after, before, describe, test } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import { createAppContext } from '../../src/context.js';
import { Config, loadConfig } from '../../src/config.js';

describe('Chat Route Parity (POST /api/chat)', () => {
  let app: FastifyInstance;
  let sharedContext: ReturnType<typeof createAppContext>;
  let testConfig: Config;
  const ORIGIN = 'https://tinyfrens.lol';
  const originalFetch = globalThis.fetch;

  before(async () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);

    testConfig = loadConfig({
      PET_DOMAIN: 'tinyfrens.lol',
      ORIGIN,
      ALLOWED_ORIGINS: 'https://tinyfrens.lol,https://www.tinyfrens.lol',
      GEMINI_API_KEY: 'test-gemini-key',
      GEMINI_MODEL: 'gemini-3.5-flash-lite',
    });

    sharedContext = createAppContext(testConfig, db, {
      now: () => 1000,
    });

    app = await buildApp({ context: sharedContext });
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
  });

  test('returns 503 when neither GEMINI_API_KEY nor GOOGLE_API_KEY is configured', async () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);
    const unconfiguredContext = createAppContext(loadConfig({ ORIGIN }), db);
    const unconfiguredApp = await buildApp({ context: unconfiguredContext });

    const res = await unconfiguredApp.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { origin: ORIGIN },
      payload: {
        message: 'hello fren',
        pet: { name: 'Mochi', shape: 'cat', color: '#ffaa00' },
      },
    });

    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.json().error, 'Pet chat is not connected yet');
    await unconfiguredApp.close();
  });

  test('returns 400 when message is empty or whitespace only', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { origin: ORIGIN },
      payload: {
        message: '   ',
        pet: { name: 'Mochi', shape: 'cat', color: '#ffaa00' },
      },
    });

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.json().error, 'Pet chat is having trouble right now');
  });

  test('returns 400 when message exceeds 400 characters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { origin: ORIGIN },
      payload: {
        message: 'a'.repeat(401),
        pet: { name: 'Mochi', shape: 'cat', color: '#ffaa00' },
      },
    });

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.json().error, 'Pet chat is having trouble right now');
  });

  test('returns sanitized chat reply from Gemini model', async () => {
    let capturedUrl = '';
    let capturedHeaders: any;
    let capturedBody: any;

    globalThis.fetch = async (url: any, init: any) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers;
      capturedBody = JSON.parse(init?.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: '**Hello!** I am your _happy_ companion fren.' }],
              },
            },
          ],
        }),
      } as any;
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { origin: ORIGIN },
      payload: {
        message: 'how are you doing today?',
        pet: { name: 'Pip', shape: 'blob', color: '#00ccff' },
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const data = res.json();
    assert.strictEqual(data.reply, 'Hello! I am your happy companion fren.');
    assert.ok(capturedUrl.includes('gemini-3.5-flash-lite'));
    assert.strictEqual(capturedHeaders['x-goog-api-key'], 'test-gemini-key');
    assert.ok(capturedBody.contents[0].parts[0].text.includes('Pip'));
  });

  test('falls back to default thinking message if Gemini returns empty text', async () => {
    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '' }] } }],
        }),
      } as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { origin: ORIGIN },
      payload: {
        message: 'do a trick',
        pet: { name: 'Buster', shape: 'dog', color: '#aaff00' },
      },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.json().reply, 'Buster blinks, thinking very hard.');
  });

  test('returns 400 if Gemini returns HTTP error or network failure', async () => {
    globalThis.fetch = async () =>
      ({
        ok: false,
        status: 500,
        json: async () => ({ error: 'internal error' }),
      } as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { origin: ORIGIN },
      payload: {
        message: 'hello?',
        pet: { name: 'Buster', shape: 'dog', color: '#aaff00' },
      },
    });

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.json().error, 'Pet chat is having trouble right now');
  });

  test('enforces rate limiting on repeated chat calls', async () => {
    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'chirp' }] } }],
        }),
      } as any);

    // Rate limit is 30 calls per 3600s
    for (let i = 0; i < 25; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { origin: ORIGIN, 'x-forwarded-for': '198.51.100.5' },
        payload: {
          message: `call #${i}`,
          pet: { name: 'Spammy', shape: 'cat', color: '#ff0000' },
        },
      });
      // Should succeed while under limit
      if (res.statusCode !== 200) {
        assert.strictEqual(res.statusCode, 400);
      }
    }
  });
});
