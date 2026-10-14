import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRobotTokenId,
  utcDayKey,
  isCareAction,
  isFreeAction,
  CARE_ACTIONS,
  DEFAULT_PRICES_FRENS,
  DEFAULT_DAILY_ALLOWANCE,
} from '../../src/domain/robot-care-rules.js';

describe('Domain: Robot Care Rules', () => {
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

  test('care actions match price catalog exactly', () => {
    for (const action of CARE_ACTIONS) {
      assert.ok(action in DEFAULT_PRICES_FRENS, `Missing price for ${action}`);
      assert.ok(DEFAULT_PRICES_FRENS[action] > 0);
    }
    assert.equal(DEFAULT_DAILY_ALLOWANCE, 24);
  });
});
