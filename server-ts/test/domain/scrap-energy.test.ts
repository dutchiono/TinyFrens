import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { loadConfig } from '../../src/config.js';
import { createAppContext } from '../../src/context.js';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import { InsufficientEnergy } from '../../src/domain/player-energy.js';
import { joinEnergyPoweredScrapRun, scrapEnergyStatus } from '../../src/domain/scrap-energy.js';
import { getScrapState, startScrapRun } from '../../src/domain/telegram-scrap.js';

describe('Scrap Run account Energy', () => {
  test('gates each member near six hours and scales recharge with Robot ownership', async () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);
    let now = 1_800_000_000;
    let robotIds = [1];
    const context = createAppContext(loadConfig({}), db, {
      now: () => now,
      robotsVerifier: {
        discover: async () => ({ nfts: robotIds.map(tokenId => ({ tokenId })), partial: false }),
        read: async () => ({ active: true }),
        ownerOf: async () => true,
      },
    });
    context.repos.pets.createPet('pet-1', 'code-1', 'token-1', '{}');
    const account = context.repos.deviceSync.ensureAccount('pet-1');
    context.repos.wallets.linkAccountWallet(
      account, '0x1111111111111111111111111111111111111111', 'personal_sign', now
    );

    const initial = await scrapEnergyStatus(context, 'pet-1');
    assert.equal(initial.costMilli, 6_000);
    assert.equal(initial.waitSeconds, 6 * 60 * 60);

    now += 6 * 60 * 60;
    const run = startScrapRun(db, 'chat-1', 'user-1', 'Ada', now, 0.1).state;
    const joined = await joinEnergyPoweredScrapRun(context, {
      runId: run.run.id, userId: 'user-1', petId: 'pet-1', displayName: 'Ada', now,
    });
    assert.equal(joined.ok && joined.changed, true);
    assert.equal(context.playerEnergy.status(account, 1).totalMilli, 0);

    const replay = await joinEnergyPoweredScrapRun(context, {
      runId: run.run.id, userId: 'user-1', petId: 'pet-1', displayName: 'Ada', now,
    });
    assert.equal(replay.ok && replay.changed, false);

    const second = startScrapRun(db, 'chat-2', 'user-1', 'Ada', now, 0.2).state;
    await assert.rejects(
      joinEnergyPoweredScrapRun(context, {
        runId: second.run.id, userId: 'user-1', petId: 'pet-1', displayName: 'Ada', now,
      }),
      InsufficientEnergy
    );
    assert.equal(getScrapState(db, second.run.id)?.members.length, 0);

    robotIds = [1, 2];
    const faster = await scrapEnergyStatus(context, 'pet-1');
    assert.equal(faster.status.ratePerDayMilli, 30_000);
    assert.equal(faster.waitSeconds, 17_280);
    db.close();
  });
});
