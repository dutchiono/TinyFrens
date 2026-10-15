import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import { TelegramRepository } from '../../src/db/repositories/telegram.js';
import {
  addBlocklist,
  addFilter,
  isChatAdmin,
  matchBlocklist,
  matchFilter,
  recordStrike,
  TelegramModeration,
} from '../../src/domain/telegram-moderation.js';
import { TelegramApiResponse, TelegramBotApi } from '../../src/integrations/telegram-api.js';

class FakeTelegramApi implements TelegramBotApi {
  calls: { method: string; payload: Record<string, unknown>; token: string }[] = [];
  members = new Map<unknown, string>();
  onCall?: (method: string, payload: Record<string, unknown>) => void;

  async call(method: string, payload: Record<string, unknown>, token: string): Promise<TelegramApiResponse> {
    this.calls.push({ method, payload, token });
    this.onCall?.(method, payload);
    let result: Record<string, unknown> = {};
    if (method === 'getChatMember') result = { status: this.members.get(payload.user_id) || 'member' };
    if (method === 'sendMessage') result = { message_id: 77 };
    return { data: { ok: true, result }, status: 200 };
  }
}

function setup() {
  const db = createDbConnection(':memory:');
  runMigrations(db);
  return { db, repo: new TelegramRepository(db), api: new FakeTelegramApi() };
}

describe('Telegram moderation parity', () => {
  test('filter CRUD validation and whole-word matching', () => {
    const { db, repo } = setup();
    assert.equal(addFilter(repo, '-100', '/website', 'https://tinyfrens.lol', '123', 10), 'website');
    assert.equal(matchFilter(repo, '-100', '/website'), 'https://tinyfrens.lol');
    assert.equal(matchFilter(repo, '-100', 'Check our website!'), 'https://tinyfrens.lol');
    assert.equal(matchFilter(repo, '-100', 'mywebsites'), null);
    assert.equal(repo.listFilters('-100')[0].created_by, '123');
    assert.throws(() => addFilter(repo, '1', 'two words', 'reply'), /cannot contain spaces/);
    assert.throws(() => addFilter(repo, '1', '', 'reply'), /1 to 64/);
    assert.throws(() => addFilter(repo, '1', 'valid', ''), /between 1 and 2000/);
    assert.equal(repo.deleteFilter('-100', 'website'), true);
    assert.equal(repo.deleteFilter('-100', 'website'), false);
    db.close();
  });

  test('blocklist CRUD matching and strike reset', () => {
    const { db, repo } = setup();
    addBlocklist(repo, '-100', 'crypto-scam', '123', 10);
    addBlocklist(repo, '-100', 'airdrop', '123', 10);
    assert.deepEqual(repo.listBlocklist('-100'), ['airdrop', 'crypto-scam']);
    assert.equal(matchBlocklist(repo, '-100', 'join our airdrop now'), 'airdrop');
    assert.equal(matchBlocklist(repo, '-100', 'hot air droplets'), null);
    assert.equal(matchBlocklist(repo, '-100', 'claim at crypto-scam.xyz'), 'crypto-scam');
    assert.equal(recordStrike(repo, '-100', '9', 'airdrop', 11), 1);
    assert.equal(recordStrike(repo, '-100', '9', 'airdrop', 12), 2);
    assert.equal(repo.getStrikes('-100', '9').strikes, 2);
    assert.equal(repo.resetStrikes('-100', '9'), true);
    assert.equal(repo.resetStrikes('-100', '9'), false);
    db.close();
  });

  test('admin verification handles anonymous admins and Telegram roles', async () => {
    const { db, api } = setup();
    const chat = { id: -100, type: 'supergroup' };
    assert.equal(await isChatAdmin(api, chat, null, 'tok', { sender_chat: { id: -100 } }), true);
    api.members.set(1, 'administrator');
    api.members.set(2, 'creator');
    api.members.set(3, 'member');
    assert.equal(await isChatAdmin(api, chat, { id: 1 }, 'tok'), true);
    assert.equal(await isChatAdmin(api, chat, { id: 2 }, 'tok'), true);
    assert.equal(await isChatAdmin(api, chat, { id: 3 }, 'tok'), false);
    assert.equal(await isChatAdmin(api, { id: 1, type: 'private' }, { id: 1 }, 'tok'), false);
    db.close();
  });

  test('creates deterministic four-choice challenge and verifies the newcomer', async () => {
    const { db, repo, api } = setup();
    const values = [0, 1, 0, 1, 2, 0, 0, 0];
    const moderation = new TelegramModeration(repo, api, {
      enabled: true,
      timeout: 180,
      token: 'bot-token',
      now: () => 1000,
      randomInteger: maximum => (values.shift() ?? 0) % maximum,
      tokenFactory: () => 'fixed_token',
    });
    const challenge = moderation.createChallenge('-100', '42');
    assert.equal(challenge.answer, 5);
    assert.equal(challenge.expires, 1180);
    assert.equal(new Set(challenge.options).size, 4);

    const handled = await moderation.handleUpdate({
      callback_query: {
        id: 'callback-1',
        data: `tfverify:${challenge.token}:${challenge.answer}`,
        from: { id: 42, first_name: 'Ada' },
      },
    });
    assert.equal(handled, true);
    assert.equal(repo.getChallengeByToken(challenge.token), undefined);
    assert.deepEqual(api.calls.map(call => call.method), [
      'restrictChatMember', 'answerCallbackQuery', 'sendMessage',
    ]);
    assert.equal(api.calls[2].payload.text, '✅ Ada verified. Welcome to TinyFrens!');
    await moderation.stop();
    db.close();
  });

  test('rejects other users and removes newcomer after three failed answers', async () => {
    const { db, repo, api } = setup();
    const moderation = new TelegramModeration(repo, api, {
      enabled: true,
      timeout: 180,
      token: 'bot-token',
      now: () => 1000,
      randomInteger: maximum => Math.max(0, maximum - 1),
      tokenFactory: () => 'challenge_1',
    });
    repo.saveChallenge({
      chat_id: '-100', user_id: '42', token: 'challenge_1', answer: 10,
      attempts: 2, expires: 1180, message_id: 77,
    });
    await moderation.handleUpdate({
      callback_query: { id: 'wrong-user', data: 'tfverify:challenge_1:9', from: { id: 7 } },
    });
    assert.equal(repo.getChallengeByToken('challenge_1')?.attempts, 2);
    await moderation.handleUpdate({
      callback_query: { id: 'wrong-answer', data: 'tfverify:challenge_1:9', from: { id: 42 } },
    });
    assert.equal(repo.getChallengeByToken('challenge_1'), undefined);
    assert.deepEqual(api.calls.map(call => call.method), [
      'answerCallbackQuery', 'answerCallbackQuery', 'banChatMember', 'unbanChatMember',
      'deleteMessage', 'sendMessage',
    ]);
    await moderation.stop();
    db.close();
  });

  test('restores persisted challenge timers and removes expired newcomer', async () => {
    const { db, repo, api } = setup();
    repo.saveChallenge({
      chat_id: '-100', user_id: '42', token: 'persisted_1', answer: 8,
      attempts: 0, expires: 1000, message_id: null,
    });
    let removed!: () => void;
    const removal = new Promise<void>(resolve => { removed = resolve; });
    api.onCall = method => {
      if (method === 'unbanChatMember') removed();
    };
    const moderation = new TelegramModeration(repo, api, {
      enabled: true,
      timeout: 180,
      token: 'bot-token',
      now: () => 1000,
    });
    moderation.start();
    await removal;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(repo.getChallengeByToken('persisted_1'), undefined);
    assert.deepEqual(api.calls.map(call => call.method), ['banChatMember', 'unbanChatMember', 'sendMessage']);
    await moderation.stop();
    db.close();
  });

  test('restricts a new member, persists the challenge, and schedules cleanup', async () => {
    const { db, repo, api } = setup();
    const values = [0, 1, 0, 1, 2, 0, 0, 0];
    const moderation = new TelegramModeration(repo, api, {
      enabled: true,
      timeout: 600,
      botUsername: 'TinyFrensBot',
      token: 'bot-token',
      now: () => 1000,
      randomInteger: maximum => (values.shift() ?? 0) % maximum,
      tokenFactory: () => 'new_member_1',
    });
    const handled = await moderation.handleUpdate({
      message: {
        chat: { id: -100, type: 'supergroup' },
        new_chat_members: [{ id: 42, first_name: 'Ada' }],
      },
    });
    assert.equal(handled, true);
    assert.equal(repo.getChallengeByToken('new_member_1')?.message_id, 77);
    assert.deepEqual(api.calls.map(call => call.method), ['getChatMember', 'restrictChatMember', 'sendMessage']);
    await moderation.stop();
    db.close();
  });

  test('requires group admin for filter and blocklist management', async () => {
    const { db, repo, api } = setup();
    const moderation = new TelegramModeration(repo, api, {
      enabled: false,
      timeout: 180,
      token: 'bot-token',
      now: () => 1000,
    });
    const chat = { id: -100, type: 'supergroup' };
    const denied = await moderation.handleManagement(
      { text: '/filter website https://tinyfrens.lol', from: { id: 7 } },
      chat
    );
    assert.equal(denied, true);
    assert.equal(repo.listFilters('-100').length, 0);
    assert.equal(api.calls.at(-1)?.payload.text, 'Only chat administrators can configure filters.');

    api.members.set(1, 'administrator');
    await moderation.handleManagement(
      { text: '/filter website https://tinyfrens.lol', from: { id: 1 } },
      chat
    );
    await moderation.handleManagement(
      { text: '/blocklist add airdrop', from: { id: 1 } },
      chat
    );
    assert.equal(repo.getFilter('-100', 'website'), 'https://tinyfrens.lol');
    assert.deepEqual(repo.listBlocklist('-100'), ['airdrop']);
    await moderation.stop();
    db.close();
  });

  test('admin ban command protects bots and admins then bans ordinary users', async () => {
    const { db, repo, api } = setup();
    api.members.set(1, 'administrator');
    api.members.set(9, 'member');
    const moderation = new TelegramModeration(repo, api, {
      enabled: false,
      timeout: 180,
      token: 'bot-token',
    });
    const chat = { id: -100, type: 'group' };
    await moderation.handleManagement({
      text: '/ban spam',
      from: { id: 1 },
      reply_to_message: { from: { id: 9, username: 'spammer' } },
    }, chat);
    assert.ok(api.calls.some(call => call.method === 'banChatMember' && call.payload.user_id === 9));
    assert.equal(api.calls.at(-1)?.payload.text, '🚫 Banned @spammer. Reason: spam');

    await moderation.handleManagement({
      text: '/ban',
      from: { id: 1 },
      reply_to_message: { from: { id: 10, is_bot: true } },
    }, chat);
    assert.equal(api.calls.at(-1)?.payload.text, 'Cannot ban a bot with this command.');
    await moderation.stop();
    db.close();
  });

  test('blocklist applies warning then ban while exempting administrators', async () => {
    const { db, repo, api } = setup();
    addBlocklist(repo, '-100', 'airdrop');
    api.members.set(5, 'member');
    api.members.set(1, 'administrator');
    const moderation = new TelegramModeration(repo, api, {
      enabled: false,
      timeout: 180,
      token: 'bot-token',
      now: () => 1000,
    });
    const chat = { id: -100, type: 'supergroup' };
    const message = {
      text: 'join our airdrop',
      message_id: 50,
      from: { id: 5, username: 'repeat_spammer' },
    };
    assert.equal(await moderation.handleContent(message, chat), true);
    assert.equal(repo.getStrikes('-100', '5').strikes, 1);
    assert.equal(await moderation.handleContent(message, chat), true);
    assert.equal(repo.getStrikes('-100', '5').strikes, 2);
    assert.ok(api.calls.some(call => call.method === 'banChatMember' && call.payload.user_id === 5));

    assert.equal(await moderation.handleContent({
      text: 'admin airdrop notice',
      from: { id: 1 },
    }, chat), false);
    assert.equal(repo.getStrikes('-100', '1').strikes, 0);
    await moderation.stop();
    db.close();
  });

  test('filter replies to ordinary messages but leaves bot commands reserved', async () => {
    const { db, repo, api } = setup();
    addFilter(repo, '-100', 'website', 'https://tinyfrens.lol');
    addFilter(repo, '-100', 'game', 'filter should not consume game');
    const moderation = new TelegramModeration(repo, api, {
      enabled: false,
      timeout: 180,
      token: 'bot-token',
    });
    const chat = { id: -100, type: 'group' };
    assert.equal(await moderation.handleContent({
      text: 'website please', message_id: 12, from: { id: 5 },
    }, chat), true);
    assert.equal(api.calls.at(-1)?.payload.reply_to_message_id, 12);
    assert.equal(await moderation.handleContent({ text: '/game', from: { id: 5 } }, chat), false);
    await moderation.stop();
    db.close();
  });
});
