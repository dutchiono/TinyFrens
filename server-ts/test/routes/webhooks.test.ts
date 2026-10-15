import assert from 'node:assert';
import crypto, { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import { createAppContext } from '../../src/context.js';
import { Config, loadConfig } from '../../src/config.js';

function signInitData(botToken: string, fields: Record<string, string>): string {
  const pairs = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  const dataCheck = pairs.join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const digest = createHmac('sha256', secret).update(dataCheck).digest('hex');
  const encoded = Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${encoded}&hash=${digest}`;
}

function signGithub(secret: string, body: string): string {
  const digest = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${digest}`;
}

describe('Signed Webhooks & External Integrations Parity (Phase 5)', () => {
  let app: FastifyInstance;
  let sharedContext: ReturnType<typeof createAppContext>;
  let testConfig: Config;
  let discordKeyPair: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject };
  let discordPublicKeyHex: string;
  const originalFetch = globalThis.fetch;

  before(async () => {
    // Generate an ephemeral Ed25519 key pair for Discord interaction tests
    discordKeyPair = crypto.generateKeyPairSync('ed25519');
    const rawExport = discordKeyPair.publicKey.export({ type: 'spki', format: 'der' });
    discordPublicKeyHex = rawExport.subarray(12).toString('hex');

    const db = createDbConnection(':memory:');
    runMigrations(db);

    testConfig = loadConfig({
      PET_DOMAIN: 'tinyfrens.lol',
      ORIGIN: 'https://tinyfrens.lol',
      ALLOWED_ORIGINS: 'https://tinyfrens.lol,https://www.tinyfrens.lol',
      SQLITE_PATH: ':memory:',
      GITHUB_WEBHOOK_SECRET: 'test-gh-secret',
      TELEGRAM_BOT_TOKEN: '123456:TEST_BOT_TOKEN',
      TELEGRAM_WEBHOOK_SECRET: 'test-tg-secret',
      TELEGRAM_DEPLOY_OWNER_ID: '969561894',
      DEPLOY_NOTIFY_SECRET: 'deploy-secret',
      DISCORD_CLIENT_ID: 'discord-client-id-123',
      DISCORD_CLIENT_SECRET: 'discord-client-secret-456',
      DISCORD_PUBLIC_KEY: discordPublicKeyHex,
      DISCORD_REDIRECT_URI: 'https://tinyfrens.lol/discord/callback',
      NEYNAR_API_KEY: 'test-neynar-key',
      FARCASTER_SIGNER_UUID: 'test-signer-uuid',
    });

    sharedContext = createAppContext(testConfig, db, {
      now: () => 1700000000,
      random: () => 0.42,
    });

    app = await buildApp({ context: sharedContext });
    await app.ready();
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
  });

  describe('GitHub Webhook (POST /api/github/webhook)', () => {
    test('unconfigured secret returns 200 { ok: true }', async () => {
      const db = createDbConnection(':memory:');
      runMigrations(db);
      const unconfiguredContext = createAppContext({ ...testConfig, GITHUB_WEBHOOK_SECRET: undefined }, db);
      const unconfiguredApp = await buildApp({ context: unconfiguredContext });
      await unconfiguredApp.ready();

      const res = await unconfiguredApp.inject({
        method: 'POST',
        url: '/api/github/webhook',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ action: 'created' }),
      });
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.json(), { ok: true });
      await unconfiguredApp.close();
    });

    test('rejects missing or invalid HMAC signature with 401', async () => {
      const payload = JSON.stringify({ action: 'created' });

      // No signature header
      const resNoSig = await app.inject({
        method: 'POST',
        url: '/api/github/webhook',
        headers: { 'content-type': 'application/json' },
        payload,
      });
      assert.strictEqual(resNoSig.statusCode, 401);
      assert.deepStrictEqual(resNoSig.json(), { error: 'invalid signature' });

      // Wrong signature
      const resBadSig = await app.inject({
        method: 'POST',
        url: '/api/github/webhook',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
        },
        payload,
      });
      assert.strictEqual(resBadSig.statusCode, 401);
      assert.deepStrictEqual(resBadSig.json(), { error: 'invalid signature' });
    });

    test('accepts valid HMAC signature and relays issue comment event to Telegram', async () => {
      let interceptedTelegramPayload: Record<string, unknown> | null = null;
      globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).includes('/bot') && String(url).includes('/sendMessage')) {
          interceptedTelegramPayload = JSON.parse(String(init?.body || '{}'));
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      };

      // Seed issue chat mapping in DB: repo 'dutchiono/TinyFrens', issue #42 -> chat '987654321'
      sharedContext.repos.telegram.linkChatToIssue('dutchiono/TinyFrens', 42, '987654321');

      const rawPayload = JSON.stringify({
        action: 'created',
        issue: {
          number: 42,
          title: 'Pet status indicator is dim',
          html_url: 'https://github.com/dutchiono/TinyFrens/issues/42',
        },
        comment: {
          body: 'Fix verified on mobile screen!',
        },
        repository: {
          full_name: 'dutchiono/TinyFrens',
        },
        sender: {
          login: 'dutchiono',
        },
      });

      const signature = signGithub('test-gh-secret', rawPayload);
      const res = await app.inject({
        method: 'POST',
        url: '/api/github/webhook',
        headers: {
          'content-type': 'application/json',
          'x-github-event': 'issue_comment',
          'x-hub-signature-256': signature,
        },
        payload: rawPayload,
      });

      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.json(), { ok: true });
      assert.ok(interceptedTelegramPayload);
      assert.strictEqual(interceptedTelegramPayload.chat_id, '987654321');
      assert.ok(String(interceptedTelegramPayload.text).includes('dutchiono commented on issue #42'));
    });

    test('ignores unmapped issue without error and returns 200', async () => {
      const rawPayload = JSON.stringify({
        action: 'created',
        issue: {
          number: 999,
          title: 'Unmapped issue',
          html_url: 'https://github.com/dutchiono/TinyFrens/issues/999',
        },
        comment: { body: 'Hello' },
        repository: { full_name: 'dutchiono/TinyFrens' },
      });
      const signature = signGithub('test-gh-secret', rawPayload);
      const res = await app.inject({
        method: 'POST',
        url: '/api/github/webhook',
        headers: {
          'content-type': 'application/json',
          'x-github-event': 'issue_comment',
          'x-hub-signature-256': signature,
        },
        payload: rawPayload,
      });
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.json(), { ok: true });
    });
  });

  describe('Discord OAuth & Interactions (POST /api/discord/*)', () => {
    test('POST /api/discord/token returns 503 when client credentials unconfigured', async () => {
      const db = createDbConnection(':memory:');
      runMigrations(db);
      const unconfiguredContext = createAppContext(
        { ...testConfig, DISCORD_CLIENT_ID: undefined, DISCORD_CLIENT_SECRET: undefined },
        db
      );
      const unconfiguredApp = await buildApp({ context: unconfiguredContext });
      await unconfiguredApp.ready();

      const res = await unconfiguredApp.inject({
        method: 'POST',
        url: '/api/discord/token',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ code: 'sample_code' }),
      });
      assert.strictEqual(res.statusCode, 503);
      assert.strictEqual(res.json().error, 'Discord app is not configured');
      await unconfiguredApp.close();
    });

    test('POST /api/discord/token returns 400 when authorization code is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/discord/token',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ code: '' }),
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json().error, 'Missing authorization code');
    });

    test('POST /api/discord/token exchanges valid code successfully', async () => {
      globalThis.fetch = async (url: string | URL | Request) => {
        if (String(url).includes('discord.com/api/v10/oauth2/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'dc-mock-token-xyz',
              token_type: 'Bearer',
              expires_in: 604800,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response('Not Found', { status: 404 });
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/discord/token',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ code: 'oauth_valid_code_123' }),
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json().access_token, 'dc-mock-token-xyz');
    });

    test('POST /api/discord/interactions returns 503 when DISCORD_PUBLIC_KEY missing', async () => {
      const db = createDbConnection(':memory:');
      runMigrations(db);
      const unconfiguredContext = createAppContext(
        { ...testConfig, DISCORD_PUBLIC_KEY: undefined },
        db
      );
      const unconfiguredApp = await buildApp({ context: unconfiguredContext });
      await unconfiguredApp.ready();

      const res = await unconfiguredApp.inject({
        method: 'POST',
        url: '/api/discord/interactions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ type: 1 }),
      });
      assert.strictEqual(res.statusCode, 503);
      assert.strictEqual(res.json().error, 'Discord app is not configured');
      await unconfiguredApp.close();
    });

    test('POST /api/discord/interactions rejects invalid signature with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/discord/interactions',
        headers: {
          'content-type': 'application/json',
          'x-signature-ed25519': '00'.repeat(64),
          'x-signature-timestamp': '1700000000',
        },
        payload: JSON.stringify({ type: 1 }),
      });
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.body, 'invalid request signature');
    });

    test('POST /api/discord/interactions answers PING (type 1) with valid Ed25519 signature', async () => {
      const ts = '1700000000';
      const body = JSON.stringify({ type: 1 });
      const dataToSign = Buffer.concat([Buffer.from(ts, 'utf-8'), Buffer.from(body, 'utf-8')]);
      const sig = crypto.sign(null, dataToSign, discordKeyPair.privateKey).toString('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/discord/interactions',
        headers: {
          'content-type': 'application/json',
          'x-signature-ed25519': sig,
          'x-signature-timestamp': ts,
        },
        payload: body,
      });

      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.json(), { type: 1 });
    });

    test('POST /api/discord/interactions answers slash command interaction (type 2) with launch message', async () => {
      const ts = '1700000001';
      const body = JSON.stringify({ type: 2, data: { name: 'fren' } });
      const dataToSign = Buffer.concat([Buffer.from(ts, 'utf-8'), Buffer.from(body, 'utf-8')]);
      const sig = crypto.sign(null, dataToSign, discordKeyPair.privateKey).toString('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/discord/interactions',
        headers: {
          'content-type': 'application/json',
          'x-signature-ed25519': sig,
          'x-signature-timestamp': ts,
        },
        payload: body,
      });

      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.type, 4);
      assert.ok(json.data.content.includes('TinyFrens is launching soon in Discord!'));
    });
  });

  describe('Telegram Auth & Webhooks (POST /api/telegram/*)', () => {
    test('POST /api/telegram/auth returns 503 when bot unconfigured', async () => {
      const db = createDbConnection(':memory:');
      runMigrations(db);
      const unconfiguredContext = createAppContext(
        { ...testConfig, TELEGRAM_BOT_TOKEN: undefined },
        db
      );
      const unconfiguredApp = await buildApp({ context: unconfiguredContext });
      await unconfiguredApp.ready();

      const res = await unconfiguredApp.inject({
        method: 'POST',
        url: '/api/telegram/auth',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ initData: 'any' }),
      });
      assert.strictEqual(res.statusCode, 503);
      assert.strictEqual(res.json().error, 'Telegram bot is not configured');
      await unconfiguredApp.close();
    });

    test('POST /api/telegram/auth rejects tampered initData with 400', async () => {
      const validInit = signInitData('123456:TEST_BOT_TOKEN', {
        auth_date: '1700000000',
        user: JSON.stringify({ id: 42, first_name: 'Ada' }),
      });
      const tampered = validInit + 'tampered';

      const res = await app.inject({
        method: 'POST',
        url: '/api/telegram/auth',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ initData: tampered }),
      });
      assert.strictEqual(res.statusCode, 400);
    });

    test('POST /api/telegram/auth provides stable persistent identity per Telegram user', async () => {
      const initData = signInitData('123456:TEST_BOT_TOKEN', {
        auth_date: '1700000000',
        query_id: 'AAH',
        user: JSON.stringify({ id: 10042, first_name: 'Ada', username: 'adalovelace' }),
      });

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/telegram/auth',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ initData }),
      });
      assert.strictEqual(res1.statusCode, 200);
      const body1 = res1.json();
      assert.match(body1.id, /^[a-f0-9]{32}$/);
      assert.match(body1.code, /^[A-Z2-9]{8}$/);
      assert.ok(body1.token);
      assert.strictEqual(body1.profile.identities[0].platform, 'telegram');
      assert.strictEqual(body1.profile.identities[0].handle, 'adalovelace');
      assert.strictEqual(body1.profile.identities[0].verified, true);

      // Second auth with same user returns the identical pet ID
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/telegram/auth',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ initData }),
      });
      assert.strictEqual(res2.statusCode, 200);
      const body2 = res2.json();
      assert.strictEqual(body2.id, body1.id);
      assert.strictEqual(body2.code, body1.code);
    });

    test('POST /api/telegram/webhook returns 503 when bot unconfigured', async () => {
      const db = createDbConnection(':memory:');
      runMigrations(db);
      const unconfiguredContext = createAppContext(
        { ...testConfig, TELEGRAM_BOT_TOKEN: undefined },
        db
      );
      const unconfiguredApp = await buildApp({ context: unconfiguredContext });
      await unconfiguredApp.ready();

      const res = await unconfiguredApp.inject({
        method: 'POST',
        url: '/api/telegram/webhook',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ update_id: 1 }),
      });
      assert.strictEqual(res.statusCode, 503);
      await unconfiguredApp.close();
    });

    test('POST /api/telegram/webhook rejects wrong secret token header with 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/telegram/webhook',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': 'wrong-secret',
        },
        payload: JSON.stringify({ update_id: 1 }),
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body, 'Telegram webhook secret did not match');
    });

    test('owner registers private and group deployment notification chats', async () => {
      const originalTelegramApi = sharedContext.telegramApi;
      sharedContext.telegramApi = {
        async call() { return { data: { ok: true }, status: 200 }; },
      };
      const res = await app.inject({
        method: 'POST',
        url: '/api/telegram/webhook',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': 'test-tg-secret',
        },
        payload: JSON.stringify({
          update_id: 2,
          message: {
            message_id: 10,
            text: '/deploynotify',
            chat: { id: 7123, type: 'private' },
            from: { id: 969561894, username: 'renamed-owner' },
          },
        }),
      });
      assert.equal(res.statusCode, 200);
      const groupRes = await app.inject({
        method: 'POST',
        url: '/api/telegram/webhook',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': 'test-tg-secret',
        },
        payload: JSON.stringify({
          update_id: 3,
          message: {
            message_id: 11,
            text: '/deploynotify',
            chat: { id: -1004467710774, type: 'supergroup' },
            from: { id: 969561894, username: 'renamed-owner' },
          },
        }),
      });
      sharedContext.telegramApi = originalTelegramApi;
      const chats = sharedContext.repos.telegram.listDeployNotificationChats();
      assert.equal(groupRes.statusCode, 200);
      assert.deepEqual(chats.map(chat => chat.chat_id), ['-1004467710774', '7123']);
      assert.ok(chats.every(chat => chat.username === 'renamed-owner'));
    });

    test('loopback deployment event requires its secret and deduplicates', async () => {
      const telegramCalls: Record<string, unknown>[] = [];
      const originalTelegramApi = sharedContext.telegramApi;
      sharedContext.telegramApi = {
        async call(_method, payload) {
          telegramCalls.push(payload);
          return { data: { ok: true }, status: 200 };
        },
      };
      const revision = 'd'.repeat(40);
      const missing = await app.inject({
        method: 'POST',
        url: '/api/internal/website-published',
        payload: { revision },
      });
      assert.equal(missing.statusCode, 404);
      const headers = { 'x-tinyfrens-deploy-secret': 'deploy-secret' };
      const first = await app.inject({ method: 'POST', url: '/api/internal/website-published', headers, payload: { revision } });
      const second = await app.inject({ method: 'POST', url: '/api/internal/website-published', headers, payload: { revision } });
      sharedContext.telegramApi = originalTelegramApi;
      assert.equal(first.statusCode, 200);
      assert.equal(first.json().sent, 2);
      assert.equal(second.statusCode, 200);
      assert.equal(second.json().alreadyNotified, 2);
      assert.equal(telegramCalls.length, 2);
    });

    test('POST /api/telegram/webhook retires old care-card buttons', async () => {
      const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
      const originalTelegramApi = sharedContext.telegramApi;
      sharedContext.telegramApi = {
        async call(method, payload) {
          calls.push({ method, payload });
          return { data: { ok: true }, status: 200 };
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/telegram/webhook',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': 'test-tg-secret',
        },
        payload: JSON.stringify({
          update_id: 100,
          callback_query: {
            id: 'cq_999',
            data: 'g:user_123:feed',
            from: { id: 'user_123', first_name: 'Trainer' },
            message: {
              message_id: 55,
              chat: { id: 'chat_777', type: 'group' },
            },
          },
        }),
      });
      sharedContext.telegramApi = originalTelegramApi;

      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.json(), { ok: true });
      assert.deepEqual(calls.map(call => call.method), ['answerCallbackQuery', 'editMessageText']);
      assert.match(String(calls[0].payload.text), /version has ended/);
      assert.match(String(calls[1].payload.text), /TinyFrens Group Game/);
      assert.deepEqual(calls[1].payload.reply_markup, { inline_keyboard: [] });
    });

    test('POST /api/telegram/webhook keeps group scrap participation in one edited message', async () => {
      const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
      const originalTelegramApi = sharedContext.telegramApi;
      const originalNow = sharedContext.now;
      sharedContext.telegramApi = {
        async call(method, payload) {
          calls.push({ method, payload });
          return method === 'sendMessage'
            ? { data: { ok: true, result: { message_id: 808 } }, status: 200 }
            : { data: { ok: true }, status: 200 };
        },
      };

      const command = await app.inject({
        method: 'POST',
        url: '/api/telegram/webhook',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': 'test-tg-secret',
        },
        payload: {
          update_id: 200,
          message: {
            message_id: 700,
            text: '/scrap',
            chat: { id: '-100-scrap', type: 'supergroup' },
            from: { id: 'starter', first_name: 'Ada' },
          },
        },
      });
      assert.equal(command.statusCode, 200);
      assert.equal(calls[0].method, 'sendMessage');
      assert.match(String(calls[0].payload.text), /TinyFrens Group Game/);
      assert.equal(calls[0].payload.reply_to_message_id, 700);
      assert.equal(calls[1].method, 'deleteMessage');
      assert.deepEqual(calls[1].payload, { chat_id: '-100-scrap', message_id: 700 });

      const run = sharedContext.db.prepare<{ id: string; message_id: number }>(
        'SELECT id, message_id FROM tg_scrap_runs WHERE chat_id=?'
      ).get('-100-scrap');
      assert.ok(run);
      assert.equal(run.message_id, 808);

      const joined = await app.inject({
        method: 'POST',
        url: '/api/telegram/webhook',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': 'test-tg-secret',
        },
        payload: {
          update_id: 201,
          callback_query: {
            id: 'cq_scrap_join',
            data: `scrap:${run.id}:join`,
            from: { id: 'friend', first_name: 'Bob' },
            message: {
              message_id: 808,
              chat: { id: '-100-scrap', type: 'supergroup' },
            },
          },
        },
      });
      sharedContext.now = () => 1700000061;
      const resolved = await app.inject({
        method: 'POST',
        url: '/api/telegram/webhook',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': 'test-tg-secret',
        },
        payload: {
          update_id: 202,
          callback_query: {
            id: 'cq_scrap_resolve',
            data: `scrap:${run.id}:resolve`,
            from: { id: 'starter', first_name: 'Ada' },
            message: {
              message_id: 808,
              chat: { id: '-100-scrap', type: 'supergroup' },
            },
          },
        },
      });
      sharedContext.telegramApi = originalTelegramApi;
      sharedContext.now = originalNow;

      assert.equal(joined.statusCode, 200);
      assert.equal(resolved.statusCode, 200);
      const edits = calls.filter(call => call.method === 'editMessageText');
      assert.equal(edits.length, 2);
      assert.equal(edits[0].payload.message_id, 808);
      assert.match(String(edits[0].payload.text), /Ada/);
      assert.match(String(edits[0].payload.text), /Bob/);
      assert.match(String(edits[1].payload.text), /Complete/);
      assert.match(String(edits[1].payload.text), /credits/);
      assert.equal(calls.filter(call => call.method === 'sendMessage').length, 1);
      assert.equal(calls.at(-1)?.method, 'answerCallbackQuery');
      const petIds = sharedContext.db.prepare<{ pet_id: string }>(
        "SELECT pet_id FROM tg_users WHERE tg_id IN ('starter', 'friend') ORDER BY tg_id"
      ).all();
      assert.equal(petIds.length, 2);
      assert.deepEqual(petIds.map(row => sharedContext.economy.balance(row.pet_id)), [35, 35]);
    });

    test('POST /api/telegram/webhook addresses update briefings to the requested user with verified progress', async () => {
      const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
      const originalTelegramApi = sharedContext.telegramApi;
      const previousFetch = globalThis.fetch;
      sharedContext.telegramApi = {
        async call(method, payload) {
          calls.push({ method, payload });
          return { data: { ok: true }, status: 200 };
        },
      };
      globalThis.fetch = async input => {
        const url = String(input);
        if (url.includes('/commits')) {
          return new Response(JSON.stringify([{
            sha: 'abc1234def',
            commit: {
              message: 'Ship Telegram scrap lobbies',
              author: { name: 'dutch', date: '2023-11-14T22:12:00Z' },
            },
          }]), { status: 200 });
        }
        if (url.includes('/pulls')) {
          return new Response(JSON.stringify([{
            number: 98,
            title: 'Add quiet Telegram group scrap runs',
            state: 'open',
            merged_at: null,
            updated_at: '2023-11-14T22:12:30Z',
          }]), { status: 200 });
        }
        if (url.includes('/actions/runs')) {
          return new Response(JSON.stringify({
            workflow_runs: [{
              name: 'Build & Test',
              conclusion: 'success',
              updated_at: '2023-11-14T22:13:00Z',
            }],
          }), { status: 200 });
        }
        throw new Error(`Unexpected request: ${url}`);
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/telegram/webhook',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': 'test-tg-secret',
        },
        payload: {
          update_id: 203,
          message: {
            message_id: 809,
            text: '@TinyFrensBot say hi to @LIMI7LESS and fill them in on everything weve done in the last 24 hrs',
            date: 1700000000,
            chat: { id: '-100-briefing', type: 'supergroup' },
            from: { id: 'owner', first_name: 'TinyFrens' },
          },
        },
      });
      sharedContext.telegramApi = originalTelegramApi;
      globalThis.fetch = previousFetch;

      assert.equal(response.statusCode, 200);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].method, 'sendMessage');
      const text = String(calls[0].payload.text);
      assert.match(text, /^Hey @LIMI7LESS/);
      assert.match(text, /PR #98/);
      assert.match(text, /Ship Telegram scrap lobbies/);
      assert.match(text, /Build & Test: success/);
      assert.doesNotMatch(text, /We love that energy/);
    });
  });

  describe('Farcaster Webhooks & Notifications (POST /api/farcaster/*)', () => {
    test('POST /api/farcaster/webhook accepts frame_added and returns 200 { received: true }', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/farcaster/webhook',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ event: 'frame_added' }),
      });
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.json(), { received: true });
    });

    test('POST /api/farcaster/notify returns 503 when NEYNAR_API_KEY is not configured', async () => {
      const db = createDbConnection(':memory:');
      runMigrations(db);
      const unconfiguredContext = createAppContext(
        { ...testConfig, NEYNAR_API_KEY: undefined },
        db
      );
      const unconfiguredApp = await buildApp({ context: unconfiguredContext });
      await unconfiguredApp.ready();

      const res = await unconfiguredApp.inject({
        method: 'POST',
        url: '/api/farcaster/notify',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ title: 'Hungry!', body: 'Feed your fren' }),
      });
      assert.strictEqual(res.statusCode, 503);
      assert.strictEqual(res.json().error, 'Neynar API key is not configured');
      await unconfiguredApp.close();
    });

    test('POST /api/farcaster/cast validation parity', async () => {
      // 1. Unconfigured API key returns 503
      const db = createDbConnection(':memory:');
      runMigrations(db);
      const unconfiguredKeyContext = createAppContext(
        { ...testConfig, NEYNAR_API_KEY: undefined },
        db
      );
      const unconfiguredKeyApp = await buildApp({ context: unconfiguredKeyContext });
      await unconfiguredKeyApp.ready();

      const resNoKey = await unconfiguredKeyApp.inject({
        method: 'POST',
        url: '/api/farcaster/cast',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ text: 'gm' }),
      });
      assert.strictEqual(resNoKey.statusCode, 503);
      await unconfiguredKeyApp.close();

      // 2. Unconfigured signer returns 503
      const dbSigner = createDbConnection(':memory:');
      runMigrations(dbSigner);
      const unconfiguredSignerContext = createAppContext(
        { ...testConfig, FARCASTER_SIGNER_UUID: undefined },
        dbSigner
      );
      const unconfiguredSignerApp = await buildApp({ context: unconfiguredSignerContext });
      await unconfiguredSignerApp.ready();

      const resNoSigner = await unconfiguredSignerApp.inject({
        method: 'POST',
        url: '/api/farcaster/cast',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ text: 'gm' }),
      });
      assert.strictEqual(resNoSigner.statusCode, 503);
      await unconfiguredSignerApp.close();

      // 3. Both configured, but text is empty -> 400
      const resEmptyText = await app.inject({
        method: 'POST',
        url: '/api/farcaster/cast',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ text: '' }),
      });
      assert.strictEqual(resEmptyText.statusCode, 400);
      assert.strictEqual(resEmptyText.json().error, 'Cast text cannot be empty');
    });
  });
});
