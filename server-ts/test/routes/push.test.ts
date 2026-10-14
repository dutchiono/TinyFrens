import assert from 'node:assert';
import { after, before, describe, test } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import { createAppContext } from '../../src/context.js';
import { Config, loadConfig } from '../../src/config.js';
import { mintPet } from '../../src/domain/account.js';

describe('Push Notification Routes Parity', () => {
  let app: FastifyInstance;
  let sharedContext: ReturnType<typeof createAppContext>;
  let testConfig: Config;
  let testPet: { id: string; token: string; code: string };
  const ORIGIN = 'https://tinyfrens.lol';

  before(async () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);

    testConfig = loadConfig({
      PET_DOMAIN: 'tinyfrens.lol',
      ORIGIN,
      ALLOWED_ORIGINS: 'https://tinyfrens.lol,https://www.tinyfrens.lol',
      VAPID_PUBLIC_KEY: 'test-vapid-public-key',
      VAPID_PRIVATE_KEY: 'test-vapid-private-key',
      VAPID_SUBJECT: 'mailto:frens@tinyfrens.lol',
    });

    sharedContext = createAppContext(testConfig, db, {
      now: () => 1000,
    });

    testPet = mintPet(db, { name: 'Pusher', shape: 'cat', color: '#ffaa00' });
    app = await buildApp({ context: sharedContext });
  });

  after(async () => {
    await app.close();
  });

  describe('GET /api/push/public-key', () => {
    test('returns configured vapid public key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/push/public-key',
        headers: { origin: ORIGIN },
      });

      assert.strictEqual(res.statusCode, 200);
      const data = res.json();
      assert.strictEqual(data.key, 'test-vapid-public-key');
    });
  });

  describe('POST /api/push/subscribe', () => {
    test('successfully stores a valid push subscription', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/push/subscribe',
        headers: { origin: ORIGIN },
        payload: {
          token: testPet.token,
          subscription: {
            endpoint: 'https://fcm.googleapis.com/fcm/send/test-sub-1',
            keys: {
              p256dh: 'BP4j...validkey',
              auth: 'auth...key',
            },
          },
        },
      });

      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.json(), { ok: true });

      const row = sharedContext.db
        .prepare<{ endpoint: string; pid: string }>('SELECT endpoint, pid FROM push_subs WHERE pid=?')
        .get(testPet.id);
      assert.ok(row);
      assert.strictEqual(row.endpoint, 'https://fcm.googleapis.com/fcm/send/test-sub-1');
      assert.strictEqual(row.pid, testPet.id);
    });

    test('rejects missing or invalid pet token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/push/subscribe',
        headers: { origin: ORIGIN },
        payload: {
          token: 'invalid-token-12345',
          subscription: {
            endpoint: 'https://fcm.googleapis.com/fcm/send/test-sub-2',
            keys: { p256dh: 'k', auth: 'a' },
          },
        },
      });

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json().error, 'Device credential not recognized');
    });

    test('rejects non-https endpoint', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/push/subscribe',
        headers: { origin: ORIGIN },
        payload: {
          token: testPet.token,
          subscription: {
            endpoint: 'http://insecure.endpoint/sub',
            keys: { p256dh: 'k', auth: 'a' },
          },
        },
      });

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json().error, 'Notifications subscription was invalid');
    });

    test('rejects missing or oversized subscription keys', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/push/subscribe',
        headers: { origin: ORIGIN },
        payload: {
          token: testPet.token,
          subscription: {
            endpoint: 'https://fcm.googleapis.com/fcm/send/test-sub-3',
            keys: { p256dh: '', auth: 'x'.repeat(450) },
          },
        },
      });

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json().error, 'Notifications subscription was invalid');
    });
  });

  describe('POST /api/push/unsubscribe', () => {
    test('removes subscription matching endpoint and pid', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/push/unsubscribe',
        headers: { origin: ORIGIN },
        payload: {
          token: testPet.token,
          endpoint: 'https://fcm.googleapis.com/fcm/send/test-sub-1',
        },
      });

      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.json(), { ok: true });

      const count = sharedContext.db
        .prepare<{ count: number }>('SELECT count(*) as count FROM push_subs WHERE pid=?')
        .get(testPet.id);
      assert.strictEqual(count?.count, 0);
    });

    test('rejects invalid pet token on unsubscribe', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/push/unsubscribe',
        headers: { origin: ORIGIN },
        payload: {
          token: 'bogus-token',
          endpoint: 'https://fcm.googleapis.com/fcm/send/test-sub-1',
        },
      });

      assert.strictEqual(res.statusCode, 400);
    });
  });
});
