import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAIRING_ALPHABET,
  normalizeCode,
  generateRandomCode,
  isValidCode,
} from '../../src/domain/codes.js';

describe('Domain: Pairing Codes', () => {
  test('normalizes codes by removing hyphens and whitespace and uppercasing', () => {
    assert.equal(normalizeCode(' abcd-efgh '), 'ABCDEFGH');
    assert.equal(normalizeCode('k-3-x-9-z'), 'K3X9Z');
    assert.equal(normalizeCode(''), '');
  });

  test('generates valid codes of specified length using only allowed alphabet', () => {
    const code = generateRandomCode(8);
    assert.equal(code.length, 8);
    assert.ok(isValidCode(code, 8));

    for (const char of code) {
      assert.ok(PAIRING_ALPHABET.includes(char), `Disallowed char: ${char}`);
    }
  });

  test('validates code characters and length', () => {
    assert.ok(isValidCode('ABCDEFGH', 8));
    assert.ok(!isValidCode('ABCDEFGH', 12));
    assert.ok(!isValidCode('ABC10O')); // 'O', '0', '1' are not in alphabet
  });
});
