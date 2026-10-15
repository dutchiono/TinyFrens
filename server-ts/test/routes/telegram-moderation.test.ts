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
      TELEGRAM_DEPLOY_OWNER_ID: '969561894',
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

  test('admin marks and clears the replied-to user as a suspected bot', async () => {
    api.members.set(1, 'administrator');
    api.members.set(5, 'member');
    const chat = { id: -101, type: 'supergroup' };
    const replied = {
      message_id: 40,
      text: 'generic engagement bait',
      chat,
      from: { id: 5, username: 'suspect_user', first_name: 'Suspect' },
    };

    const flagged = await webhook({
      message_id: 41,
      text: '/bot',
      chat,
      from: { id: 1, username: 'admin' },
      reply_to_message: replied,
    });
    assert.equal(flagged.statusCode, 200);
    assert.deepEqual(context.repos.telegram.getSuspectedBot('-101', '5'), {
      chat_id: '-101',
      user_id: '5',
      username: 'suspect_user',
      display_name: 'Suspect',
      flagged_by: '1',
      source_message_id: 40,
      flagged_at: 1000,
    });
    const notice = api.calls.findLast(call => call.method === 'sendMessage');
    assert.match(String(notice?.payload.text), /@suspect_user was marked as a suspected bot/);
    assert.equal(notice?.payload.reply_to_message_id, 40);
    assert.equal(notice?.payload.parse_mode, 'HTML');
    assert.ok(api.calls.some(call => call.method === 'deleteMessage' && call.payload.message_id === 41));

    const cleared = await webhook({
      message_id: 42,
      text: '/unbot',
      chat,
      from: { id: 1, username: 'admin' },
      reply_to_message: replied,
    });
    assert.equal(cleared.statusCode, 200);
    assert.equal(context.repos.telegram.getSuspectedBot('-101', '5'), undefined);
    assert.match(String(api.calls.findLast(call => call.method === 'sendMessage')?.payload.text), /Removed/);
  });

  test('suspected-bot labels require an admin and a replied-to message', async () => {
    api.members.set(6, 'member');
    const chat = { id: -102, type: 'supergroup' };
    await webhook({
      message_id: 50,
      text: '/bot',
      chat,
      from: { id: 6, username: 'ordinary_user' },
      reply_to_message: { message_id: 49, chat, from: { id: 7, first_name: 'Target' } },
    });
    assert.match(String(api.calls.findLast(call => call.method === 'sendMessage')?.payload.text), /Only chat administrators/);
    assert.equal(context.repos.telegram.getSuspectedBot('-102', '7'), undefined);

    api.members.set(1, 'administrator');
    await webhook({
      message_id: 51,
      text: '/bot',
      chat,
      from: { id: 1, username: 'admin' },
    });
    assert.match(String(api.calls.findLast(call => call.method === 'sendMessage')?.payload.text), /Reply to a user's message/);
  });

  test('escalates reply warnings from notice to ten-minute mute to ban', async () => {
    api.members.set(1, 'administrator');
    api.members.set(8, 'member');
    const chat = { id: -103, type: 'supergroup' };
    const replied = {
      message_id: 60,
      text: 'uncivil message',
      chat,
      from: { id: 8, username: 'rowdy_fren', first_name: 'Rowdy' },
    };

    await webhook({
      message_id: 61,
      text: '/warn be respectful',
      chat,
      from: { id: 1, username: 'admin' },
      reply_to_message: replied,
    });
    assert.equal(context.repos.telegram.getModerationWarnings('-103', '8')?.warnings, 1);
    assert.match(String(api.calls.findLast(call => call.method === 'sendMessage')?.payload.text), /warning 1\/3/);

    await webhook({
      message_id: 62,
      text: '/warn',
      chat,
      from: { id: 1, username: 'admin' },
      reply_to_message: replied,
    });
    const restriction = api.calls.findLast(call => call.method === 'restrictChatMember');
    assert.equal(restriction?.payload.user_id, 8);
    assert.equal(restriction?.payload.until_date, 1600);
    assert.equal((restriction?.payload.permissions as Record<string, boolean>).can_send_messages, false);
    assert.equal(context.repos.telegram.getModerationWarnings('-103', '8')?.warnings, 2);

    await webhook({
      message_id: 63,
      text: '/warn final chance used',
      chat,
      from: { id: 1, username: 'admin' },
      reply_to_message: replied,
    });
    const ban = api.calls.findLast(call => call.method === 'banChatMember');
    assert.equal(ban?.payload.user_id, 8);
    assert.equal(context.repos.telegram.getModerationWarnings('-103', '8')?.warnings, 3);
    assert.match(String(api.calls.findLast(call => call.method === 'sendMessage')?.payload.text), /warning 3\/3/);
  });

  test('does not double-count a retried warn update and lets an admin clear warnings', async () => {
    api.members.set(1, 'administrator');
    api.members.set(9, 'member');
    const chat = { id: -104, type: 'supergroup' };
    const replied = { message_id: 70, chat, from: { id: 9, first_name: 'Learning Fren' } };
    const warning = {
      message_id: 71,
      text: '/warn',
      chat,
      from: { id: 1, username: 'admin' },
      reply_to_message: replied,
    };
    await webhook(warning);
    await webhook(warning);
    assert.equal(context.repos.telegram.getModerationWarnings('-104', '9')?.warnings, 1);

    await webhook({ ...warning, message_id: 72, text: '/unwarn' });
    assert.equal(context.repos.telegram.getModerationWarnings('-104', '9'), undefined);
    assert.match(String(api.calls.findLast(call => call.method === 'sendMessage')?.payload.text), /Cleared all warnings/);
  });

  test('directs private game commands to the group and serves public status', async () => {
    const chat = { id: -200, type: 'private' };
    await webhook({
      message_id: 6,
      text: '/game',
      chat,
      from: { id: 22, first_name: 'Ada' },
    });
    assert.match(String(api.calls.at(-1)?.payload.text), /send \/game there/);

    await webhook({
      message_id: 7,
      text: '/status',
      chat,
      from: { id: 22, first_name: 'Ada' },
    });
    assert.match(String(api.calls.at(-1)?.payload.text), /Server Status: Online/);
  });

  test('restricts admin triage in DMs to the owner', async () => {
    const chat = { id: -300, type: 'private' };
    await webhook({
      message_id: 8,
      text: '/admin',
      chat,
      from: { id: 22, username: 'random_user' },
    });
    assert.match(String(api.calls.at(-1)?.payload.text), /Access Denied/);

    await webhook({
      message_id: 9,
      text: '/admin',
      chat,
      from: { id: 969561894, username: 'renamed-owner' },
    });
    assert.match(String(api.calls.at(-1)?.payload.text), /Host & Server Triage/);
    assert.doesNotMatch(String(api.calls.at(-1)?.payload.text), /bot-token/);
  });
});
