import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../../src/config.js';
import { TelegramOperationalAlerts } from '../../src/domain/operational-alerts.js';

test('operational alerts DM the owner, redact secrets, and deduplicate incidents', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const api = {
    async call(_method: string, payload: Record<string, unknown>) {
      calls.push(payload);
      return { status: 200, data: { ok: true } };
    },
  };
  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: '123456:TEST_BOT_TOKEN',
    TELEGRAM_DEPLOY_OWNER_ID: '969561894',
    APP_REVISION: 'a'.repeat(40),
  });
  const alerts = new TelegramOperationalAlerts(config, () => api, () => 1_700_000_000);

  assert.equal(await alerts.report('worker:deposit', 'Deposit worker failed', `ghp_${'x'.repeat(36)}`), true);
  assert.equal(await alerts.report('worker:deposit', 'Deposit worker failed again'), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].chat_id, '969561894');
  assert.match(String(calls[0].text), /Deposit worker failed/);
  assert.match(String(calls[0].text), /\[REDACTED_TOKEN\]/);
  assert.doesNotMatch(String(calls[0].text), /ghp_/);
  assert.match(String(calls[0].text), /Revision: aaaaaaa/);
});
