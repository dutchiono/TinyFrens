import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createAppContext } from '../../src/context.js';
import { mintPet, telegramPet } from '../../src/domain/account.js';
import { ROBOTS_CONTRACT } from '../../src/domain/companion-verifier.js';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import { TelegramApiFile, TelegramApiResponse, TelegramBotApi } from '../../src/integrations/telegram-api.js';

class FakeTelegramApi implements TelegramBotApi {
  calls: Array<{
    method: string;
    payload: Record<string, unknown>;
    files?: Record<string, TelegramApiFile>;
  }> = [];

  async call(
    method: string,
    payload: Record<string, unknown>,
    _token: string,
    files?: Record<string, TelegramApiFile>
  ): Promise<TelegramApiResponse> {
    this.calls.push({ method, payload, files });
    const result = method === 'sendAnimation' ? { animation: { file_id: 'telegram-file-id' } } : { message_id: 1 };
    return { data: { ok: true, result }, status: 200 };
  }
}

describe('Telegram /show media orchestration', () => {
  let app: FastifyInstance;
  let context: ReturnType<typeof createAppContext>;
  let api: FakeTelegramApi;

  before(async () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);
    api = new FakeTelegramApi();
    const svg = Buffer.from('<svg viewBox="0 0 16 16"><rect x="2" y="2" width="8" height="8" fill="#a474f1"/></svg>').toString('base64');
    const rig = { frames: [`data:image/svg+xml;base64,${svg}`, `data:image/svg+xml;base64,${svg}`], frameMs: 160 };
    context = createAppContext(loadConfig({
      TELEGRAM_BOT_TOKEN: 'bot-token',
      TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
      TELEGRAM_MINIAPP_URL: 'https://tinyfrens.lol/web/',
    }), db, {
      telegramApi: api,
      now: () => 1000,
      robotsVerifier: {
        read: async () => ({
          active: true,
          chainId: 8453,
          originalAddress: ROBOTS_CONTRACT,
          tokenId: 7,
          name: 'Robot #7',
          companion: rig,
        }),
        discover: async () => ({ nfts: [], partial: false }),
      },
    });
    const pet = telegramPet(context, { id: 42, first_name: 'Ada' }, false, true);
    const account = context.repos.deviceSync.ensureAccount(pet.id);
    context.repos.deviceSync.updateAccountSelections(account, JSON.stringify([{
      chainId: 8453,
      originalAddress: ROBOTS_CONTRACT,
      tokenId: 7,
      motion: { mode: 'roam', speed: 60, size: 80 },
    }]), JSON.stringify([{
      chainId: 8453,
      originalAddress: ROBOTS_CONTRACT,
      tokenId: 7,
      slot: 1,
    }]), 0);
    context.repos.wallets.linkAccountWallet(
      account,
      '0x0000000000000000000000000000000000000001',
      'personal_sign',
      1000
    );
    app = await buildApp({ context });
    await app.ready();
  });

  after(async () => {
    await context.telegramModeration.stop();
    await app.close();
  });

  async function show(text = '/show', userId = 42) {
    return app.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': 'webhook-secret',
      },
      payload: {
        message: {
          message_id: api.calls.length + 1,
          text,
          chat: { id: -100, type: 'group' },
          from: { id: userId, first_name: 'Ada' },
        },
      },
    });
  }

  test('uploads the GIF once and reuses Telegram file_id afterward', async () => {
    context.db.prepare(
      'INSERT INTO tg_media_cache(chain, collection, token_id, file_id, updated) VALUES(?, ?, ?, ?, ?)'
    ).run(8453, ROBOTS_CONTRACT, 7, 'legacy-blank-file-id', 999);
    assert.equal(context.repos.telegram.getCachedMediaFileId(8453, ROBOTS_CONTRACT, 7), undefined);

    assert.equal((await show()).statusCode, 200);
    const first = api.calls.find(call => call.method === 'sendAnimation');
    assert.equal(first?.payload.animation, 'attach://animation');
    assert.equal(first?.files?.animation.contentType, 'image/gif');
    assert.equal(Buffer.from(first?.files?.animation.data || []).toString('ascii', 0, 6), 'GIF89a');
    assert.equal(context.repos.telegram.getCachedMediaFileId(8453, ROBOTS_CONTRACT, 7), 'telegram-file-id');
    const stored = context.db.prepare<{ file_id: string }>(
      'SELECT file_id FROM tg_media_cache WHERE chain=? AND collection=? AND token_id=?'
    ).get(8453, ROBOTS_CONTRACT, 7);
    assert.equal(stored?.file_id, 'gif-v2:telegram-file-id');

    assert.equal((await show()).statusCode, 200);
    const animationCalls = api.calls.filter(call => call.method === 'sendAnimation');
    assert.equal(animationCalls.length, 2);
    assert.equal(animationCalls[1].payload.animation, 'telegram-file-id');
    assert.equal(animationCalls[1].files, undefined);
  });

  test('uses exact Telegram slots after reordering', async () => {
    const pet = telegramPet(context, { id: 42, first_name: 'Ada' });
    const account = context.repos.deviceSync.ensureAccount(pet.id);
    const revision = context.repos.deviceSync.getAccountState(account)?.revision ?? -1;
    assert.equal(context.repos.deviceSync.updateAccountSelections(account, null, JSON.stringify([{
      chainId: 8453,
      originalAddress: ROBOTS_CONTRACT,
      tokenId: 7,
      slot: 2,
    }]), revision), true);

    assert.equal((await show()).statusCode, 200);
    assert.match(String(api.calls.at(-1)?.payload.text), /slot 1 is empty/);
    assert.equal((await show('/show 2')).statusCode, 200);
    assert.equal(api.calls.at(-1)?.method, 'sendAnimation');
  });

  test('explains when a selected Telegram slot has no linked wallet', async () => {
    const pet = telegramPet(context, { id: 44, first_name: 'No Wallet' }, false, true);
    const account = context.repos.deviceSync.ensureAccount(pet.id);
    const webDevice = mintPet(context.db, { name: 'Web device' });
    context.db.prepare('INSERT INTO device_sync_members(device, account) VALUES(?, ?)').run(webDevice.id, account);
    assert.equal(context.repos.deviceSync.updateAccountSelections(account, null, JSON.stringify([{
      chainId: 8453,
      originalAddress: ROBOTS_CONTRACT,
      tokenId: 7,
      slot: 1,
    }]), 0), true);
    assert.equal((await show('/show', 44)).statusCode, 200);
    assert.match(String(api.calls.at(-1)?.payload.text), /Link a wallet first/);
  });

  test('requires an explicit account link instead of creating a Telegram account', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': 'webhook-secret',
      },
      payload: {
        message: {
          message_id: 99,
          text: '/show',
          chat: { id: 43, type: 'private' },
          from: { id: 43, first_name: 'New Fren' },
        },
      },
    });
    assert.equal(response.statusCode, 200);
    assert.match(String(api.calls.at(-1)?.payload.text), /not linked to a TinyFrens account/);
    const markup = api.calls.at(-1)?.payload.reply_markup as any;
    assert.equal(markup.inline_keyboard[0][0].web_app.url, 'https://tinyfrens.lol/web/#pet');
  });
});
