import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createAppContext } from '../../src/context.js';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import { TelegramApiResponse, TelegramBotApi } from '../../src/integrations/telegram-api.js';

class FakeTelegramApi implements TelegramBotApi {
  calls: { method: string; payload: Record<string, unknown> }[] = [];
  members = new Map<unknown, string>();

  async call(method: string, payload: Record<string, unknown>): Promise<TelegramApiResponse> {
    this.calls.push({ method, payload });
    const result = method === 'getChatMember'
      ? { status: this.members.get(payload.user_id) || 'member' }
      : method === 'sendMessage' ? { message_id: 99 } : {};
    return { data: { ok: true, result }, status: 200 };
  }
}

describe('Telegram moderation webhook orchestration', () => {
  let app: FastifyInstance;
  let context: ReturnType<typeof createAppContext>;
  let api: FakeTelegramApi;

  before(async () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);
    api = new FakeTelegramApi();
    context = createAppContext(loadConfig({
      TELEGRAM_BOT_TOKEN: 'bot-token',
      TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
      TELEGRAM_MODERATION: 'true',
    }), db, {
      telegramApi: api,
      now: () => 1000,
    });
    app = await buildApp({ context });
    await app.ready();
  });

  after(async () => {
    await context.telegramModeration.stop();
    await app.close();
  });

  async function webhook(message: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': 'webhook-secret',
      },
      payload: { update_id: api.calls.length + 1, message },
    });
  }

  test('admin creates filter and ordinary message receives reply', async () => {
    api.members.set(1, 'administrator');
    const chat = { id: -100, type: 'supergroup' };
    const set = await webhook({
      message_id: 1,
      text: '/filter website https://tinyfrens.lol',
      chat,
      from: { id: 1, username: 'admin' },
    });
    assert.equal(set.statusCode, 200);
    assert.equal(context.repos.telegram.getFilter('-100', 'website'), 'https://tinyfrens.lol');

    const reply = await webhook({
      message_id: 2,
      text: 'where is the website?',
      chat,
      from: { id: 5, username: 'fren' },
    });
    assert.equal(reply.statusCode, 200);
    const sent = api.calls.at(-1);
    assert.equal(sent?.method, 'sendMessage');
    assert.equal(sent?.payload.text, 'https://tinyfrens.lol');
    assert.equal(sent?.payload.reply_to_message_id, 2);
  });

  test('blocklist deletes first violation and bans the second', async () => {
    api.members.set(1, 'administrator');
    api.members.set(5, 'member');
    const chat = { id: -100, type: 'supergroup' };
    await webhook({
      message_id: 3,
      text: '/blocklist add airdrop',
      chat,
      from: { id: 1, username: 'admin' },
    });

    const violation = {
      text: 'claim this airdrop',
      chat,
      from: { id: 5, username: 'spammer' },
    };
    await webhook({ ...violation, message_id: 4 });
    await webhook({ ...violation, message_id: 5 });

    assert.equal(context.repos.telegram.getStrikes('-100', '5').strikes, 2);
    assert.ok(api.calls.some(call => call.method === 'deleteMessage' && call.payload.message_id === 4));
    assert.ok(api.calls.some(call => call.method === 'banChatMember' && call.payload.user_id === 5));
  });
});
