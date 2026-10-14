import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  creditsFromWei,
  weiFromFrens,
  getPackages,
  CREDITS_PER_FRENS,
} from '../../src/domain/economy-math.js';

describe('Domain: Economy Math & Token Conversions', () => {
  test('calculates credits from wei accurately using BigInt', () => {
    // 1 FRENS = 10^18 wei -> 100 credits
    const oneFrensWei = 10n ** 18n;
    assert.equal(creditsFromWei(oneFrensWei), 100n);

    // 10 FRENS -> 1000 credits
    const tenFrensWei = 10n * (10n ** 18n);
    assert.equal(creditsFromWei(tenFrensWei), 1000n);

    // Partial FRENS: 0.5 FRENS (5 * 10^17 wei) -> 50 credits
    const halfFrensWei = 5n * (10n ** 17n);
    assert.equal(creditsFromWei(halfFrensWei), 50n);

    // Tiny amount: < 0.01 FRENS rounds down
    const smallWei = 10n ** 15n; // 0.001 FRENS
    assert.equal(creditsFromWei(smallWei), 0n);
  });

  test('throws on negative wei amount', () => {
    assert.throws(() => creditsFromWei(-100n), /amount must be >= 0/);
  });

  test('converts FRENS to wei string correctly', () => {
    assert.equal(weiFromFrens(1), 1000000000000000000n);
    assert.equal(weiFromFrens(10), 10000000000000000000n);
  });

  test('generates deposit packages matching specification (10, 50, 100 FRENS)', () => {
    const packages = getPackages(100);
    assert.equal(packages.length, 3);
    assert.deepEqual(packages, [
      { frens: 10, amountWei: '10000000000000000000', credits: 1000 },
      { frens: 50, amountWei: '50000000000000000000', credits: 5000 },
      { frens: 100, amountWei: '100000000000000000000', credits: 10000 },
    ]);
  });
});
