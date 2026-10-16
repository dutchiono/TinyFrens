import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createAppContext, AppContext } from '../../src/context.js';
import { createDbConnection, DatabaseConnection } from '../../src/db/connection.js';
import { initSchema } from '../../src/db/schema.js';
import { loadConfig } from '../../src/config.js';

describe('Routes: Robot Care API', () => {
  let db: DatabaseConnection;
  let app: FastifyInstance;
  let context: AppContext;
  let ownedResult: boolean;
  const ORIGIN = 'https://tinyfrens.lol';
  const PET_ID = 'pet-care-1';
  const TOKEN = 'tok-123';
  const WALLET = '0x1111111111111111111111111111111111111111';

  async function setupApp(options?: {
    linkWallet?: boolean;
    initialCredits?: number;
    dailyAllowance?: number;
    feedPrice?: number;
    gameRewardCredits?: number;
  }) {
    db = createDbConnection(':memory:');
    initSchema(db);

    const config = loadConfig({
      ROBOT_CARE_DAILY_ALLOWANCE: String(options?.dailyAllowance ?? 2),
      ROBOT_CARE_PRICE_FEED: String(options?.feedPrice ?? 42),
      ROBOT_CARE_GAME_REWARD_CREDITS: String(options?.gameRewardCredits ?? 0),
    });

    ownedResult = true;

    context = createAppContext(config, db, {
      robotsVerifier: {
        discover: async () => ({ nfts: [], partial: false }),
        read: async () => ({ active: ownedResult }),
        ownerOf: async () => ownedResult,
      },
    });

    // Register test pet with hashed token
    const tokenHash = crypto.createHash('sha256').update(TOKEN).digest('hex');
    context.repos.pets.createPet(
      PET_ID,
      'code123',
      tokenHash,
      JSON.stringify({
        name: 'Beep',
        shape: 'robot',
        color: '#a474f1',
      })
    );

    if (options?.linkWallet !== false) {
      context.repos.wallets.linkAccountWallet(
        context.repos.deviceSync.ensureAccount(PET_ID),
        WALLET,
        'personal_sign',
        Math.floor(Date.now() / 1000)
      );
    }

    if (options?.initialCredits) {
      context.economy.grant(PET_ID, options.initialCredits);
    }

    app = await buildApp({ context });
  }

  function post(url: string, payload: any) {
    return app.inject({
      method: 'POST',
      url,
      headers: { origin: ORIGIN },
      payload,
    });
  }

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  test('status reports allowance, prices, and deposit block', async () => {
    await setupApp();
    const res = await post('/api/robots/care', { token: TOKEN, tokenId: 1 });

    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.tokenId, 1);
    assert.equal(data.allowance.limit, 2);
    assert.equal(data.allowance.remaining, 2);
    assert.equal(data.prices.feed, 42);
    assert.ok(data.deposit);
    assert.equal(typeof data.deposit.enabled, 'boolean');
  });

  test('action consumes free allowance', async () => {
    await setupApp();
    const res = await post('/api/robots/care/action', {
      token: TOKEN,
      tokenId: 1,
      action: 'feed',
    });

    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.ok(data.allowed);
    assert.ok(data.free);
    assert.equal(data.charged, 0);
    assert.equal(data.allowance.remaining, 1);
    assert.equal(data.tokenId, 1);
  });

  test('action beyond allowance quotes price when insufficient credits', async () => {
    await setupApp({ dailyAllowance: 2, feedPrice: 42 });

    // Consume 2 free uses
    for (let i = 0; i < 2; i++) {
      const res = await post('/api/robots/care/action', {
        token: TOKEN,
        tokenId: 1,
        action: 'feed',
      });
      assert.equal(res.statusCode, 200);
    }

    // 3rd use exceeds free allowance, no credits granted
    const res = await post('/api/robots/care/action', {
      token: TOKEN,
      tokenId: 1,
      action: 'feed',
    });

    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.allowed, false);
    assert.equal(data.free, false);
    assert.equal(data.requiresPayment, true);
    assert.equal(data.priceFrens, 42);
    assert.equal(data.tokenId, 1);
  });

  test('unknown action rejected with 400', async () => {
    await setupApp();
    const res = await post('/api/robots/care/action', {
      token: TOKEN,
      tokenId: 1,
      action: 'teleport',
    });

    assert.equal(res.statusCode, 400);
    const data = JSON.parse(res.body);
    assert.equal(data.error, 'Unknown care action');
  });

  test('bad token rejected with 400', async () => {
    await setupApp();
    const res = await post('/api/robots/care', { token: 'nope', tokenId: 1 });

    assert.equal(res.statusCode, 400);
  });

  test('bad token ID rejected with 400', async () => {
    await setupApp();
    const res = await post('/api/robots/care', { token: TOKEN, tokenId: 9999 });

    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /Invalid Robots v1 token number/);
  });

  test('missing token ID rejected with 400', async () => {
    await setupApp();
    const res = await post('/api/robots/care', { token: TOKEN });

    assert.equal(res.statusCode, 400);
  });

  test('not owned is forbidden with 403', async () => {
    await setupApp();
    ownedResult = false;

    const res = await post('/api/robots/care', { token: TOKEN, tokenId: 1 });

    assert.equal(res.statusCode, 403);
    assert.equal(JSON.parse(res.body).error, 'You do not own this robot');
  });

  test('unlinked wallet is forbidden with 403', async () => {
    await setupApp({ linkWallet: false });

    const res = await post('/api/robots/care', { token: TOKEN, tokenId: 1 });

    assert.equal(res.statusCode, 403);
    assert.equal(JSON.parse(res.body).error, 'Link your wallet first');
  });

  test('rate limit triggers 400 error', async () => {
    await setupApp();
    context.rateLimiter.limit = () => {
      throw new Error('Please wait before trying again');
    };

    const res = await post('/api/robots/care/action', {
      token: TOKEN,
      tokenId: 1,
      action: 'feed',
    });

    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, 'Please wait before trying again');
  });

  test('paid action charges credits when funded', async () => {
    await setupApp({ dailyAllowance: 1, feedPrice: 10, initialCredits: 10000 });

    // First action: free
    const r1 = await post('/api/robots/care/action', {
      token: TOKEN,
      tokenId: 1,
      action: 'feed',
    });
    assert.equal(JSON.parse(r1.body).free, true);

    // Second action: paid, charges 10 * 100 = 1000 credits
    const r2 = await post('/api/robots/care/action', {
      token: TOKEN,
      tokenId: 1,
      action: 'feed',
    });

    assert.equal(r2.statusCode, 200);
    const data = JSON.parse(r2.body);
    assert.equal(data.allowed, true);
    assert.equal(data.free, false);
    assert.equal(data.charged, 1000);
    assert.equal(data.balance, 9000);
  });

  test('game reward grants credits when configured', async () => {
    await setupApp({ gameRewardCredits: 250, initialCredits: 1000 });
    const before = context.economy.balance(PET_ID);

    const res = await post('/api/robots/game', {
      token: TOKEN,
      tokenId: 1,
      game: 'snack-catch',
    });

    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.granted, 250);
    assert.equal(data.game, 'snack-catch');
    assert.equal(data.tokenId, 1);
    assert.equal(context.economy.balance(PET_ID), before + 250);
  });

  test('game reward grants 0 by default when unconfigured', async () => {
    await setupApp({ gameRewardCredits: 0 });

    const res = await post('/api/robots/game', {
      token: TOKEN,
      tokenId: 1,
      game: 'snack-catch',
    });

    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.granted, 0);
  });

  test('game reward requires ownership', async () => {
    await setupApp();
    ownedResult = false;

    const res = await post('/api/robots/game', {
      token: TOKEN,
      tokenId: 1,
      game: 'snack-catch',
    });

    assert.equal(res.statusCode, 403);
    assert.equal(JSON.parse(res.body).error, 'You do not own this robot');
  });

  test('game reward requires valid game identifier', async () => {
    await setupApp();
    const res = await post('/api/robots/game', { token: TOKEN, tokenId: 1 });

    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, 'Unknown game');
  });

  test('app wiring: care requires a linked wallet after registration', async () => {
    db = createDbConnection(':memory:');
    initSchema(db);
    context = createAppContext(loadConfig({}), db);
    app = await buildApp({ context });

    // Register a new pet
    const regRes = await post('/api/register', {
      pet: { name: 'Beep', shape: 'robot', color: '#a474f1' },
    });
    assert.equal(regRes.statusCode, 200);
    const regData = JSON.parse(regRes.body);

    // Call robot care without linking wallet
    const careRes = await post('/api/robots/care', {
      token: regData.token,
      tokenId: 1,
    });

    assert.equal(careRes.statusCode, 403);
    assert.equal(JSON.parse(careRes.body).error, 'Link your wallet first');
  });
});
