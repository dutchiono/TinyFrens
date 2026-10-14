import assert from 'node:assert';
import { describe, test } from 'node:test';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import { loadConfig } from '../../src/config.js';
import { RateLimiter } from '../../src/rate-limit.js';
import { deliverPush, pushConfigured, pushOffline, PushSender, PushSubscriptionInfo } from '../../src/domain/push.js';

describe('Domain: Push Notifications', () => {
  test('pushConfigured returns true only when VAPID_PRIVATE_KEY and VAPID_SUBJECT are set', () => {
    assert.strictEqual(pushConfigured(loadConfig({})), false);
    assert.strictEqual(pushConfigured(loadConfig({ VAPID_PRIVATE_KEY: 'priv' })), false);
    assert.strictEqual(pushConfigured(loadConfig({ VAPID_SUBJECT: 'mailto:a@b.c' })), false);
    assert.strictEqual(
      pushConfigured(loadConfig({ VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:a@b.c' })),
      true
    );
  });

  test('deliverPush prunes stale subscriptions returning 410 or 404', async () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);

    const config = loadConfig({
      VAPID_PRIVATE_KEY: 'test-private-key',
      VAPID_SUBJECT: 'mailto:admin@tinyfrens.lol',
    });

    db.prepare('INSERT INTO push_subs(endpoint, p256dh, auth, pid, created) VALUES(?, ?, ?, ?, ?)')
      .run('https://push.example/stale-410', 'key1', 'auth1', 'pid-1', 100);
    db.prepare('INSERT INTO push_subs(endpoint, p256dh, auth, pid, created) VALUES(?, ?, ?, ?, ?)')
      .run('https://push.example/stale-404', 'key2', 'auth2', 'pid-1', 100);
    db.prepare('INSERT INTO push_subs(endpoint, p256dh, auth, pid, created) VALUES(?, ?, ?, ?, ?)')
      .run('https://push.example/active', 'key3', 'auth3', 'pid-1', 100);

    const sentEndpoints: string[] = [];
    const mockSender: PushSender = {
      async send(sub: PushSubscriptionInfo) {
        sentEndpoints.push(sub.endpoint);
        if (sub.endpoint.includes('410')) {
          return { status: 410 };
        }
        if (sub.endpoint.includes('404')) {
          const err: any = new Error('Not found');
          err.statusCode = 404;
          throw err;
        }
        return { status: 200 };
      },
    };

    const rows = db.prepare('SELECT endpoint, p256dh, auth FROM push_subs').all() as any[];
    await deliverPush(db, config, rows, { title: 'Test', body: 'Hello' }, mockSender);

    assert.strictEqual(sentEndpoints.length, 3);
    const remaining = db.prepare('SELECT endpoint FROM push_subs').all() as any[];
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].endpoint, 'https://push.example/active');
  });

  test('pushOffline rate limits and sends to subscriptions', async () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);

    const config = loadConfig({
      VAPID_PRIVATE_KEY: 'test-private-key',
      VAPID_SUBJECT: 'mailto:admin@tinyfrens.lol',
    });

    const rateLimiter = new RateLimiter();

    db.prepare('INSERT INTO push_subs(endpoint, p256dh, auth, pid, created) VALUES(?, ?, ?, ?, ?)')
      .run('https://push.example/offline-target', 'k', 'a', 'pet-offline', 100);

    const calls: any[] = [];
    const mockSender: PushSender = {
      async send(sub, payload) {
        calls.push({ sub, payload });
        return { status: 200 };
      },
    };

    await pushOffline(db, config, rateLimiter, 1000, 'pet-offline', 'Wake up', 'Time to play', mockSender);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].sub.endpoint, 'https://push.example/offline-target');
    assert.strictEqual(calls[0].payload.title, 'Wake up');

    // Trigger rate limiting (limit is 10 in 3600s)
    for (let i = 0; i < 9; i++) {
      await pushOffline(db, config, rateLimiter, 1000 + i, 'pet-offline', 'Wake up', 'Time to play', mockSender);
    }
    assert.strictEqual(calls.length, 10);

    // 11th should be rate limited and silently skipped
    await pushOffline(db, config, rateLimiter, 1020, 'pet-offline', 'Wake up', 'Time to play', mockSender);
    assert.strictEqual(calls.length, 10);
  });
});
