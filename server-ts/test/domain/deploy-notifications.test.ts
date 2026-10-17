import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { loadConfig } from '../../src/config.js';
import { createAppContext } from '../../src/context.js';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import { deliverDeploymentNotification } from '../../src/domain/deploy-notifications.js';

describe('deployment notifications', () => {
  test('delivers once per revision and leaves failed deliveries retryable', async () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);
    const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
    let shouldFail = false;
    const context = createAppContext(loadConfig({ TELEGRAM_BOT_TOKEN: 'bot-token' }), db, {
      now: () => 1700000000,
      telegramApi: {
        async call(method, payload) {
          calls.push({ method, payload });
          return shouldFail
            ? { data: { ok: false }, status: 403 }
            : { data: { ok: true, result: { message_id: 77 } }, status: 200 };
        },
      },
    });
    context.repos.telegram.subscribeDeployNotifications('123', 'IonODutch', 1);
    const summaryFetcher = async () => new Response(JSON.stringify({
      commit: { message: 'Make deploy updates useful' },
      files: [{ filename: 'server-ts/src/integrations/discord-api.ts' }],
    }), { status: 200 });

    const revision = 'a'.repeat(40);
    assert.deepEqual(await deliverDeploymentNotification(context, revision, summaryFetcher), {
      subscribers: 1,
      sent: 1,
      alreadyNotified: 0,
    });
    assert.deepEqual(await deliverDeploymentNotification(context, revision, summaryFetcher), {
      subscribers: 1,
      sent: 0,
      alreadyNotified: 1,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'sendMessage');
    assert.match(String(calls[0].payload.text), /What changed/);
    assert.match(String(calls[0].payload.text), /Discord, Backend/);

    assert.deepEqual(await deliverDeploymentNotification(context, 'b'.repeat(40), summaryFetcher), {
      subscribers: 1,
      sent: 1,
      alreadyNotified: 0,
    });
    assert.equal(calls[1].method, 'editMessageText');
    assert.equal(calls[1].payload.message_id, 77);

    shouldFail = true;
    await assert.rejects(
      deliverDeploymentNotification(context, 'c'.repeat(40), summaryFetcher),
      /failed for 1 subscribed chat/
    );
    assert.equal(context.repos.telegram.listDeployNotificationChats()[0].last_revision, 'b'.repeat(40));
    db.close();
  });

  test('quietly pins the first group card and replaces a missing card', async () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);
    const methods: string[] = [];
    let editFails = false;
    let nextMessageId = 90;
    const context = createAppContext(loadConfig({ TELEGRAM_BOT_TOKEN: 'bot-token' }), db, {
      telegramApi: {
        async call(method) {
          methods.push(method);
          if (method === 'editMessageText' && editFails) return { data: { ok: false }, status: 400 };
          return { data: { ok: true, result: { message_id: nextMessageId } }, status: 200 };
        },
      },
    });
    context.repos.telegram.subscribeDeployNotifications('-100123', 'owner', 1);
    const unavailable = async () => new Response(null, { status: 404 });

    await deliverDeploymentNotification(context, 'd'.repeat(40), unavailable);
    assert.deepEqual(methods, ['sendMessage', 'pinChatMessage']);
    assert.equal(context.repos.telegram.listDeployNotificationChats()[0].message_id, 90);

    methods.length = 0;
    editFails = true;
    nextMessageId = 91;
    await deliverDeploymentNotification(context, 'e'.repeat(40), unavailable);
    assert.deepEqual(methods, ['editMessageText', 'sendMessage', 'pinChatMessage']);
    assert.equal(context.repos.telegram.listDeployNotificationChats()[0].message_id, 91);
    db.close();
  });
});
