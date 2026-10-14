import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDbConnection, DatabaseConnection } from '../../src/db/connection.js';
import { initSchema } from '../../src/db/schema.js';
import {
  validateRobotTokenId,
  utcDayKey,
  isCareAction,
  isFreeAction,
  CARE_ACTIONS,
  FREE_ACTIONS,
  DEFAULT_PRICES_FRENS,
  DEFAULT_DAILY_ALLOWANCE,
} from '../../src/domain/robot-care-rules.js';
import { RobotCare, UnknownAction } from '../../src/domain/robot-care.js';
import { Economy } from '../../src/domain/economy.js';

class FakeClock {
  constructor(public t = 1_700_000_000) {}
  now = () => this.t;
  advance(seconds: number) {
    this.t += seconds;
  }
}

describe('Domain: Robot Care Rules', () => {
  test('care and free actions are disjoint', () => {
    const careSet = new Set<string>(CARE_ACTIONS);
    const freeSet = new Set<string>(FREE_ACTIONS);
    for (const action of careSet) {
      assert.ok(!freeSet.has(action));
    }
  });

  test('every care action has a price', () => {
    for (const action of CARE_ACTIONS) {
      assert.ok(action in DEFAULT_PRICES_FRENS);
      assert.ok(DEFAULT_PRICES_FRENS[action] >= 0);
    }
  });

  test('validates robot token IDs within 1..2664', () => {
    assert.equal(validateRobotTokenId(1), 1);
    assert.equal(validateRobotTokenId('1'), 1);
    assert.equal(validateRobotTokenId(2664), 2664);
    assert.equal(validateRobotTokenId('1234'), 1234);

    assert.throws(() => validateRobotTokenId(0), /Invalid Robots v1 token number/);
    assert.throws(() => validateRobotTokenId(2665), /Invalid Robots v1 token number/);
    assert.throws(() => validateRobotTokenId(true), /Invalid Robots v1 token number/);
    assert.throws(() => validateRobotTokenId('abc'), /Invalid Robots v1 token number/);
    assert.throws(() => validateRobotTokenId('-5'), /Invalid Robots v1 token number/);
  });

  test('formats UTC day key in YYYY-MM-DD format', () => {
    // 2026-10-14 00:00:00 UTC = 1791936000
    const ts = 1791936000;
    assert.equal(utcDayKey(ts), '2026-10-14');
  });

  test('identifies care and free actions properly', () => {
    assert.ok(isCareAction('feed'));
    assert.ok(isCareAction('revive'));
    assert.ok(!isCareAction('pet'));
    assert.ok(!isCareAction('unknown'));

    assert.ok(isFreeAction('pet'));
    assert.ok(!isFreeAction('feed'));
  });
});

describe('Domain: Robot Care Allowance', () => {
  let db: DatabaseConnection;
  let clock: FakeClock;
  let care: RobotCare;

  beforeEach(() => {
    db = createDbConnection(':memory:');
    initSchema(db);
    clock = new FakeClock();
    care = new RobotCare(db, clock.now, 3);
  });

  test('free uses then requires payment', () => {
    for (let i = 0; i < 3; i++) {
      const r = care.consume('pet-1', 'feed');
      assert.ok(r.allowed);
      assert.ok(r.free);
      assert.equal(r.charged, 0);
      assert.equal(r.allowance.remaining, 2 - i);
    }

    const r = care.consume('pet-1', 'feed');
    assert.ok(!r.allowed);
    assert.ok(r.requiresPayment);
    assert.equal(r.priceFrens, DEFAULT_PRICES_FRENS.feed);
    assert.equal(care.allowanceLeft('pet-1').remaining, 0);
  });

  test('allowance resets next UTC day', () => {
    care.consume('pet-1', 'play');
    clock.advance(86400);
    assert.equal(care.allowanceLeft('pet-1').remaining, 3);
  });

  test('unknown action rejected', () => {
    assert.throws(() => care.consume('pet-1', 'teleport'), UnknownAction);
  });

  test('allowance is per pet', () => {
    care.consume('pet-1', 'feed');
    assert.equal(care.allowanceLeft('pet-2').remaining, 3);
  });

  test('zero allowance never free', () => {
    const zeroCare = new RobotCare(db, clock.now, 0);
    const r = zeroCare.consume('pet-1', 'clean');
    assert.ok(!r.allowed);
    assert.ok(r.requiresPayment);
  });

  test('status shape matches specification', () => {
    const status = care.status('pet-1');
    assert.deepEqual(status.actions, [...CARE_ACTIONS]);
    assert.deepEqual(status.freeActions, [...FREE_ACTIONS]);
    assert.equal(status.allowance.limit, 3);
    assert.deepEqual(Object.keys(status.prices).sort(), [...CARE_ACTIONS].sort());
  });

  test('overrides replace default prices', () => {
    const customCare = new RobotCare(db, clock.now, undefined, { feed: 7 });
    assert.equal(customCare.status('pet-1').prices.feed, 7);
    assert.equal(customCare.status('pet-1').prices.play, DEFAULT_PRICES_FRENS.play);
  });

  test('settings callable is read live', () => {
    const policy = { dailyAllowance: 1, prices: { feed: 5 } };
    const liveCare = new RobotCare(db, clock.now, undefined, undefined, () => policy);

    assert.equal(liveCare.status('pet-1').allowance.limit, 1);
    assert.equal(liveCare.status('pet-1').prices.feed, 5);

    // Retune live
    policy.dailyAllowance = 4;
    policy.prices.feed = 8;
    assert.equal(liveCare.status('pet-1').allowance.limit, 4);
    assert.equal(liveCare.status('pet-1').prices.feed, 8);
  });
});

describe('Domain: Robot Paid Care', () => {
  let db: DatabaseConnection;
  let clock: FakeClock;
  let economy: Economy;
  let care: RobotCare;

  beforeEach(() => {
    db = createDbConnection(':memory:');
    initSchema(db);
    clock = new FakeClock();
    economy = new Economy(db, clock.now, 100);
    care = new RobotCare(db, clock.now, 1, undefined, undefined, economy);
  });

  test('free use does not touch the ledger', () => {
    economy.grant('pet-1', 1000);
    const r = care.consume('pet-1', 'feed');
    assert.ok(r.free);
    assert.equal(economy.balance('pet-1'), 1000);
    assert.deepEqual(
      economy.history('pet-1').map(h => h.reason),
      ['grant']
    );
  });

  test('paid use charges price times rate', () => {
    care.consume('pet-1', 'feed'); // spend free allowance
    const expected = DEFAULT_PRICES_FRENS.feed * economy.creditsPerFrens;
    economy.grant('pet-1', expected + 5000);

    const r = care.consume('pet-1', 'feed');
    assert.ok(r.allowed);
    assert.ok(!r.free);
    assert.equal(r.priceFrens, DEFAULT_PRICES_FRENS.feed);
    assert.equal(r.charged, expected);
    assert.equal(r.balance, 5000);
    assert.equal(economy.history('pet-1')[0].reason, 'care');
  });

  test('insufficient balance reports shortfall and charges nothing', () => {
    care.consume('pet-1', 'feed');
    economy.grant('pet-1', 10);

    const r = care.consume('pet-1', 'feed');
    assert.ok(!r.allowed);
    assert.ok(r.requiresPayment);
    assert.equal(r.charged, 0);
    assert.equal(r.balance, 10);
    assert.ok((r.shortfall ?? 0) > 0);
    assert.equal(economy.balance('pet-1'), 10);
  });

  test('paid revive charges revive price', () => {
    care.consume('pet-1', 'feed');
    const price = DEFAULT_PRICES_FRENS.revive;
    economy.grant('pet-1', price * economy.creditsPerFrens);

    const r = care.consume('pet-1', 'revive');
    assert.ok(r.allowed);
    assert.equal(r.charged, price * economy.creditsPerFrens);
    assert.equal(economy.balance('pet-1'), 0);
  });

  test('status reports rate and balance', () => {
    economy.grant('pet-1', 250);
    const status = care.status('pet-1');
    assert.equal(status.creditsPerFrens, economy.creditsPerFrens);
    assert.equal(status.balance, 250);
  });

  test('without economy paid branch cannot charge', () => {
    const noEconCare = new RobotCare(db, clock.now, 0);
    const r = noEconCare.consume('pet-1', 'feed');
    assert.ok(!r.allowed);
    assert.ok(r.requiresPayment);
    assert.equal(r.charged, 0);
  });
});
