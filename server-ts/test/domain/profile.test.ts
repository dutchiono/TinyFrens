import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProfile, VALID_SHAPES } from '../../src/domain/profile.js';

describe('Domain: Pet Profile Normalization', () => {
  test('normalizes a valid pet profile', () => {
    const raw = {
      name: '  Sparky \t The Dog  ',
      shape: 'dog',
      color: '#FF5733',
      expression: 'happy',
      accessory: 'hat',
      tokenId: 42,
    };
    const prof = normalizeProfile(raw);
    assert.equal(prof.name, 'Sparky The Dog');
    assert.equal(prof.shape, 'dog');
    assert.equal(prof.color, '#FF5733');
    assert.equal(prof.expression, 'happy');
    assert.equal(prof.accessory, 'hat');
    assert.equal(prof.tokenId, 42);
  });

  test('converts legacy mascot shape to robot', () => {
    const raw = {
      name: 'Robo',
      shape: 'mascot',
      color: '#123456',
    };
    const prof = normalizeProfile(raw);
    assert.equal(prof.shape, 'robot');
  });

  test('strips control characters from name and caps at 20 chars', () => {
    const raw = {
      name: 'Hello\x00\x1fWorld\x7fVeryLongPetNameBeyondLimits',
      shape: 'cat',
      color: '#AABBCC',
    };
    const prof = normalizeProfile(raw);
    assert.equal(prof.name, 'HelloWorldVeryLongPe');
    assert.ok(prof.name.length <= 20);
  });

  test('rejects non-object or empty inputs', () => {
    assert.throws(() => normalizeProfile(null), /Invalid pet/);
    assert.throws(() => normalizeProfile(undefined), /Invalid pet/);
    assert.throws(() => normalizeProfile([]), /Invalid pet/);
    assert.throws(() => normalizeProfile('string'), /Invalid pet/);
  });

  test('rejects unknown shapes and invalid hex colors', () => {
    assert.throws(
      () => normalizeProfile({ name: 'Fren', shape: 'dragon', color: '#112233' }),
      /Invalid pet/
    );
    assert.throws(
      () => normalizeProfile({ name: 'Fren', shape: 'cat', color: 'blue' }),
      /Invalid pet/
    );
    assert.throws(
      () => normalizeProfile({ name: 'Fren', shape: 'cat', color: '#12345' }),
      /Invalid pet/
    );
  });

  test('all 10 documented shapes are valid', () => {
    for (const shape of VALID_SHAPES) {
      const prof = normalizeProfile({ name: 'Pet', shape, color: '#000000' });
      assert.equal(prof.shape, shape);
    }
  });
});
