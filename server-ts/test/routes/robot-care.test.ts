import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { AppContext, createAppContext } from '../../src/context.js';
import { loadConfig } from '../../src/config.js';
import { createDbConnection, DatabaseConnection } from '../../src/db/connection.js';
import { initSchema } from '../../src/db/schema.js';
import { MILLI_ENERGY } from '../../src/domain/player-energy.js';

describe('Routes: Robot Care account Energy API', () => {
  let db: DatabaseConnection;
  let app: FastifyInstance;
  let context: AppContext;
  let ownedResult: boolean;
  let now: number;
  let partialInventory: boolean;
  let discoveryFails: boolean;
  const ORIGIN = 'https://tinyfrens.lol';
  const PET_ID = 'pet-care-1';
  const TOKEN = 'tok-123';
  const WALLET = '0x1111111111111111111111111111111111111111';

  async function setupApp(options?: {
    linkWallet?: boolean;
    robotIds?: number[];
    purchasedEnergy?: number;
    config?: Record<string, string>;
  }) {
    db = createDbConnection(':memory:');
    initSchema(db);
    now = 1_800_000_000;
    ownedResult = true;
    partialInventory = false;
    discoveryFails = false;
    const robotIds = options?.robotIds ?? [1];

    context = createAppContext(loadConfig(options?.config ?? {}), db, {
      now: () => now,
      robotsVerifier: {
        discover: async () => {
          if (discoveryFails) throw new Error('RPC unavailable');
          return {
            nfts: robotIds.map(tokenId => ({ tokenId })),
            partial: partialInventory,
          };
        },
        read: async () => ({ active: ownedResult }),
        ownerOf: async () => ownedResult,
      },
    });

    const tokenHash = crypto.createHash('sha256').update(TOKEN).digest('hex');
    context.repos.pets.createPet(
      PET_ID,
      'code123',
      tokenHash,
      JSON.stringify({ name: 'Beep', shape: 'robot', color: '#a474f1' })
    );

    if (options?.linkWallet !== false) {
      const account = context.repos.deviceSync.ensureAccount(PET_ID);
      context.repos.wallets.linkAccountWallet(account, WALLET, 'personal_sign', Math.floor(now));
      if (options?.purchasedEnergy) {
        context.playerEnergy.grantPurchased(
          account,
          options.purchasedEnergy * MILLI_ENERGY,
          'test'
        );
      }
    }

    app = await buildApp({ context });
  }

  function post(url: string, payload: any) {
    return app.inject({ method: 'POST', url, headers: { origin: ORIGIN }, payload });
  }

  afterEach(async () => {
    if (app) await app.close();
  });

  test('status reports account Energy, verified Robot count, and configurable costs', async () => {
    await setupApp({
      robotIds: [1, 2],
      config: { ROBOT_ENERGY_COST_FEED: '6' },
    });
    const res = await post('/api/robots/care', { token: TOKEN, tokenId: 1 });

    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.tokenId, 1);
    assert.equal(data.energy.eligibleRobots, 2);
    assert.equal(data.energy.totalMilli, 0);
    assert.equal(data.energy.ratePerDayMilli, 30 * MILLI_ENERGY);
    assert.equal(data.energy.capacityMilli, 90 * MILLI_ENERGY);
    assert.equal(data.costsMilli.feed, 6 * MILLI_ENERGY);
    assert.equal(data.allowance, undefined);
    assert.equal(data.balance, undefined);
  });

  test('one Robot accrues six Energy in six hours', async () => {
    await setupApp();
    await post('/api/robots/care', { token: TOKEN, tokenId: 1 });
    now += 6 * 60 * 60;
    const res = await post('/api/robots/care', { token: TOKEN, tokenId: 1 });
    assert.equal(JSON.parse(res.body).energy.totalMilli, 6 * MILLI_ENERGY);
  });

  test('care spends shared account Energy without assigning the spend to one Robot', async () => {
    await setupApp({ purchasedEnergy: 10 });
    const res = await post('/api/robots/care/action', {
      token: TOKEN,
      tokenId: 1,
      action: 'feed',
    });

    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.allowed, true);
    assert.equal(data.costMilli, 4 * MILLI_ENERGY);
    assert.equal(data.energy.totalMilli, 6 * MILLI_ENERGY);
    const account = context.repos.deviceSync.ensureAccount(PET_ID);
    const entry = context.playerEnergy.history(account)[0];
    assert.equal(entry.reason, 'care');
    assert.equal(entry.ref_type, 'care-action');
    assert.equal(entry.ref_id, 'feed');
  });

  test('account inventory deduplicates Robots found through multiple linked wallets', async () => {
    await setupApp({ robotIds: [1, 2] });
    const account = context.repos.deviceSync.ensureAccount(PET_ID);
    context.repos.wallets.linkAccountWallet(
      account,
      '0x2222222222222222222222222222222222222222',
      'personal_sign',
      Math.floor(now)
    );

    const res = await post('/api/robots/care', { token: TOKEN, tokenId: 1 });
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).energy.eligibleRobots, 2);
  });

  test('insufficient Energy blocks care without mutating the companion', async () => {
    await setupApp();
    const res = await post('/api/robots/care/action', {
      token: TOKEN,
      tokenId: 1,
      action: 'play',
    });

    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.allowed, false);
    assert.equal(data.insufficientEnergy, true);
    assert.equal(data.costMilli, 5 * MILLI_ENERGY);
    assert.equal(data.energy.totalMilli, 0);
  });

  test('unknown action is rejected', async () => {
    await setupApp({ purchasedEnergy: 10 });
    const res = await post('/api/robots/care/action', {
      token: TOKEN,
      tokenId: 1,
      action: 'teleport',
    });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, 'Unknown care action');
  });

  test('partial or failed inventory fails closed without spending Energy', async () => {
    await setupApp({ purchasedEnergy: 10 });
    partialInventory = true;
    const partial = await post('/api/robots/care/action', {
      token: TOKEN,
      tokenId: 1,
      action: 'feed',
    });
    assert.equal(partial.statusCode, 503);

    partialInventory = false;
    discoveryFails = true;
    const failed = await post('/api/robots/care/action', {
      token: TOKEN,
      tokenId: 1,
      action: 'feed',
    });
    assert.equal(failed.statusCode, 503);

    const account = context.repos.deviceSync.ensureAccount(PET_ID);
    assert.equal(context.playerEnergy.status(account, 1).totalMilli, 10 * MILLI_ENERGY);
  });

  test('target ownership and complete inventory must agree', async () => {
    await setupApp({ robotIds: [2] });
    const res = await post('/api/robots/care', { token: TOKEN, tokenId: 1 });
    assert.equal(res.statusCode, 503);
    assert.equal(JSON.parse(res.body).error, 'Robot Energy unavailable');
  });

  test('not owned is forbidden', async () => {
    await setupApp();
    ownedResult = false;
    const res = await post('/api/robots/care', { token: TOKEN, tokenId: 1 });
    assert.equal(res.statusCode, 403);
    assert.equal(JSON.parse(res.body).error, 'You do not own this robot');
  });

  test('unlinked wallet is forbidden', async () => {
    await setupApp({ linkWallet: false });
    const res = await post('/api/robots/care', { token: TOKEN, tokenId: 1 });
    assert.equal(res.statusCode, 403);
    assert.equal(JSON.parse(res.body).error, 'Link your wallet first');
  });

  test('ordinary game completion no longer grants legacy credits', async () => {
    await setupApp({ config: { ROBOT_CARE_GAME_REWARD_CREDITS: '250' } });
    const before = context.economy.balance(PET_ID);
    const res = await post('/api/robots/game', {
      token: TOKEN,
      tokenId: 1,
      game: 'snack-catch',
    });

    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).granted, 0);
    assert.equal(context.economy.balance(PET_ID), before);
  });

  test('bad credentials, token IDs, and game identifiers are rejected', async () => {
    await setupApp();
    assert.equal((await post('/api/robots/care', { token: 'nope', tokenId: 1 })).statusCode, 400);
    assert.equal((await post('/api/robots/care', { token: TOKEN, tokenId: 9999 })).statusCode, 400);
    assert.equal((await post('/api/robots/care', { token: TOKEN })).statusCode, 400);
    assert.equal((await post('/api/robots/game', { token: TOKEN, tokenId: 1 })).statusCode, 400);
  });

  test('rate limits still apply to Energy actions', async () => {
    await setupApp();
    context.rateLimiter.limit = () => { throw new Error('Please wait before trying again'); };
    const res = await post('/api/robots/care/action', {
      token: TOKEN,
      tokenId: 1,
      action: 'feed',
    });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, 'Please wait before trying again');
  });
});
