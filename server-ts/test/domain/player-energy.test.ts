import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createDbConnection, DatabaseConnection } from '../../src/db/connection.js';
import { initSchema } from '../../src/db/schema.js';
import {
  DEFAULT_ENERGY_POLICY,
  energyEntitlement,
  InsufficientEnergy,
  MILLI_ENERGY,
  PlayerEnergy,
} from '../../src/domain/player-energy.js';

describe('Domain: account Energy', () => {
  let db: DatabaseConnection;
  let now: number;
  let energy: PlayerEnergy;

  beforeEach(() => {
    db = createDbConnection(':memory:');
    initSchema(db);
    now = 1_800_000_000;
    energy = new PlayerEnergy(db, () => now);
  });

  test('requires a Robot and starts at 18 + 6 per Robot each day', () => {
    assert.deepEqual(energyEntitlement(0), { ratePerDayMilli: 0, capacityMilli: 0 });
    assert.deepEqual(energyEntitlement(1), {
      ratePerDayMilli: 24 * MILLI_ENERGY,
      capacityMilli: 72 * MILLI_ENERGY,
    });
    assert.deepEqual(energyEntitlement(2), {
      ratePerDayMilli: 30 * MILLI_ENERGY,
      capacityMilli: 90 * MILLI_ENERGY,
    });
  });

  test('generates one six-hour play session for the first Robot', () => {
    energy.status('account-1', 1);
    now += 6 * 60 * 60;
    const status = energy.status('account-1', 1);
    assert.equal(status.rechargeableMilli, 6 * MILLI_ENERGY);
    assert.equal(status.purchasedMilli, 0);
  });

  test('preserves fractional accrual across frequent reads', () => {
    energy.status('account-1', 1);
    for (let i = 0; i < 24; i += 1) {
      now += 60 * 60;
      energy.status('account-1', 1);
    }
    assert.equal(energy.status('account-1', 1).rechargeableMilli, 24 * MILLI_ENERGY);
  });

  test('caps rechargeable Energy but never erases purchased Energy', () => {
    energy.status('account-1', 1);
    energy.grantPurchased('account-1', 100 * MILLI_ENERGY, 'purchase', 'deposit', 'tx-1');
    now += 10 * 86_400;
    const status = energy.status('account-1', 1);
    assert.equal(status.rechargeableMilli, 72 * MILLI_ENERGY);
    assert.equal(status.purchasedMilli, 100 * MILLI_ENERGY);
    assert.equal(status.totalMilli, 172 * MILLI_ENERGY);
  });

  test('does not bank overflow while at the rechargeable cap', () => {
    energy.status('account-1', 1);
    now += 10 * 86_400;
    energy.status('account-1', 1);
    energy.spend('account-1', 1, 5 * MILLI_ENERGY, 'play');
    assert.equal(energy.status('account-1', 1).rechargeableMilli, 67 * MILLI_ENERGY);

    now += 6 * 60 * 60;
    assert.equal(energy.status('account-1', 1).rechargeableMilli, 72 * MILLI_ENERGY);
  });

  test('spends rechargeable Energy before purchased Energy', () => {
    energy.status('account-1', 1);
    energy.grantPurchased('account-1', 10 * MILLI_ENERGY, 'purchase');
    now += 6 * 60 * 60;
    const status = energy.spend('account-1', 1, 7 * MILLI_ENERGY, 'play', 'robot', '42');
    assert.equal(status.rechargeableMilli, 0);
    assert.equal(status.purchasedMilli, 9 * MILLI_ENERGY);
    const entry = energy.history('account-1')[0];
    assert.equal(entry.rechargeable_delta_milli, -6 * MILLI_ENERGY);
    assert.equal(entry.purchased_delta_milli, -1 * MILLI_ENERGY);
  });

  test('rejects a spend without enough Energy', () => {
    energy.status('account-1', 1);
    assert.throws(
      () => energy.spend('account-1', 1, MILLI_ENERGY, 'play'),
      InsufficientEnergy
    );
  });

  test('settles the old rate before an editable policy takes effect', () => {
    energy.status('account-1', 1);
    now += 12 * 60 * 60;
    const faster = { ...DEFAULT_ENERGY_POLICY, version: 2, accountBasePerDayMilli: 30 * MILLI_ENERGY };
    const changed = energy.status('account-1', 1, faster);
    assert.equal(changed.rechargeableMilli, 12 * MILLI_ENERGY);
    assert.equal(changed.ratePerDayMilli, 36 * MILLI_ENERGY);

    now += 12 * 60 * 60;
    assert.equal(energy.status('account-1', 1, faster).rechargeableMilli, 30 * MILLI_ENERGY);
  });

  test('does not erase banked Energy when ownership falls to zero', () => {
    energy.status('account-1', 1);
    now += 86_400;
    assert.equal(energy.status('account-1', 0).rechargeableMilli, 24 * MILLI_ENERGY);
    now += 86_400;
    const locked = energy.status('account-1', 0);
    assert.equal(locked.rechargeableMilli, 24 * MILLI_ENERGY);
    assert.equal(locked.ratePerDayMilli, 0);
  });
});
