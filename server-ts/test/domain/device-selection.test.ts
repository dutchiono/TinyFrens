import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateCompanionSelection } from '../../src/domain/device-selection.js';

describe('Domain: Device Companion Selection', () => {
  const validItem = {
    chainId: 8453,
    originalAddress: '0x8d446c126d4873bfa3eb195b7f0094acc1187a75',
    tokenId: 123,
    motion: { mode: 'roam', speed: 60, size: 80 },
  };

  test('validates and accepts valid companion selections', () => {
    const res = validateCompanionSelection([validItem]);
    assert.equal(res.length, 1);
    assert.equal(res[0].tokenId, 123);
    assert.equal(res[0].motion.mode, 'roam');
  });

  test('rejects lists larger than 5 companions', () => {
    const list = Array(6).fill(validItem);
    assert.throws(() => validateCompanionSelection(list), /Choose up to five companions/);
  });

  test('rejects unsupported collection addresses or chains', () => {
    assert.throws(
      () =>
        validateCompanionSelection([
          { ...validItem, originalAddress: '0x1111111111111111111111111111111111111111' },
        ]),
      /Unsupported companion/
    );
  });

  test('rejects duplicate companions in the same selection', () => {
    assert.throws(
      () => validateCompanionSelection([validItem, { ...validItem }]),
      /Duplicate companion/
    );
  });

  test('rejects invalid motion settings (speeds outside 20..140, sizes outside 48..128)', () => {
    assert.throws(
      () =>
        validateCompanionSelection([
          { ...validItem, motion: { mode: 'roam', speed: 10, size: 80 } },
        ]),
      /Invalid companion settings/
    );
    assert.throws(
      () =>
        validateCompanionSelection([
          { ...validItem, motion: { mode: 'fly', speed: 60, size: 80 } },
        ]),
      /Invalid companion settings/
    );
  });
});
