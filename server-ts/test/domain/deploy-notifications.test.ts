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
    const calls: Record<string, unknown>[] = [];
    let shouldFail = false;
    const context = createAppContext(loadConfig({ TELEGRAM_BOT_TOKEN: 'bot-token' }), db, {
      now: () => 1700000000,
      telegramApi: {
        async call(_method, payload) {
          calls.push(payload);
          return shouldFail
            ? { data: { ok: false }, status: 403 }
            : { data: { ok: true }, status: 200 };
        },
      },
    });
    context.repos.telegram.subscribeDeployNotifications('123', 'IonODutch', 1);

    const revision = 'a'.repeat(40);
    assert.deepEqual(await deliverDeploymentNotification(context, revision), {
      subscribers: 1,
      sent: 1,
      alreadyNotified: 0,
    });
    assert.deepEqual(await deliverDeploymentNotification(context, revision), {
      subscribers: 1,
      sent: 0,
      alreadyNotified: 1,
    });
    assert.equal(calls.length, 1);

    shouldFail = true;
    await assert.rejects(
      deliverDeploymentNotification(context, 'b'.repeat(40)),
      /failed for 1 subscribed chat/
    );
    assert.equal(context.repos.telegram.listDeployNotificationChats()[0].last_revision, revision);
    db.close();
  });
});
