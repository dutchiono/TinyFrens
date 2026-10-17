import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAFT_ENERGY_SIMULATOR_POLICY,
  diminishingBoostBps,
  simulateEnergyScenario,
  simulateFeeSplit,
} from '../../src/domain/energy-economy-simulator.js';

describe('Draft Energy economy simulator', () => {
  test('preserves the 18 + 6N baseline and scalable capacity', () => {
    const one = simulateEnergyScenario({ label: 'one', robots: 1, liquidFrens: 0, stakedFrens: 0, burnedFrens: 0 });
    const five = simulateEnergyScenario({ label: 'five', robots: 5, liquidFrens: 0, stakedFrens: 0, burnedFrens: 0 });
    assert.equal(one.energyPerDay, 24);
    assert.equal(one.energyPerSession, 6);
    assert.equal(one.capacity, 72);
    assert.equal(five.energyPerDay, 48);
    assert.equal(five.capacity, 144);
  });

  test('requires a Robot even when the account has token boosts', () => {
    const result = simulateEnergyScenario({
      label: 'no robot', robots: 0, liquidFrens: 1_000_000, stakedFrens: 1_000_000, burnedFrens: 1_000_000,
    });
    assert.equal(result.energyPerDay, 0);
    assert.equal(result.totalBoostBps, 0);
    assert.equal(result.capacity, 0);
  });

  test('gives staking a larger boost than holding and burning a larger boost than staking', () => {
    const amount = 100_000;
    const liquid = diminishingBoostBps(amount, DRAFT_ENERGY_SIMULATOR_POLICY.liquid);
    const staked = diminishingBoostBps(amount, DRAFT_ENERGY_SIMULATOR_POLICY.staked);
    const burned = diminishingBoostBps(amount, DRAFT_ENERGY_SIMULATOR_POLICY.burned);
    assert.ok(liquid < staked);
    assert.ok(staked < burned);
  });

  test('uses diminishing returns and explicit component caps', () => {
    const policy = DRAFT_ENERGY_SIMULATOR_POLICY.liquid;
    const small = diminishingBoostBps(10_000, policy);
    const large = diminishingBoostBps(1_000_000, policy);
    assert.ok(small / 10_000 > large / 1_000_000);
    assert.equal(diminishingBoostBps(1e15, policy), policy.maxBoostBps);
  });

  test('splits fees 50/50 and calculates pro-rata staker rewards', () => {
    const result = simulateFeeSplit({
      weeklyFeesFrens: 100_000,
      stakerShareBps: 5_000,
      totalStakedFrens: 5_000_000,
      accountStakedFrens: 100_000,
    });
    assert.equal(result.projectFrensPerWeek, 50_000);
    assert.equal(result.stakerPoolFrensPerWeek, 50_000);
    assert.equal(result.accountSharePercent, 2);
    assert.equal(result.accountFrensPerWeek, 1_000);
    assert.equal(result.simpleAnnualRewardPercent, 52);
  });

  test('retains the staker half as pending when nobody is staked', () => {
    const result = simulateFeeSplit({
      weeklyFeesFrens: 100_000,
      stakerShareBps: 5_000,
      totalStakedFrens: 0,
      accountStakedFrens: 0,
    });
    assert.equal(result.projectFrensPerWeek, 50_000);
    assert.equal(result.pendingFrensPerWeek, 50_000);
    assert.equal(result.accountFrensPerWeek, 0);
  });
});
