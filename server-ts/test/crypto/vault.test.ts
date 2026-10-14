import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { frenVaultAddressAndKey } from '../../src/crypto/vault.js';

describe('Crypto: Deterministic Fren Vault Derivation', () => {
  test('derives identical address and private key matching Python reference vector', () => {
    // Generated via Python:
    // digest = hashlib.sha256(b"test-seed:test-pet").digest()
    // acct = Account.from_key(digest)
    // -> address: 0x5dA18b0D346b201d5c81b90c92699ECF44F6CC3B
    // -> privateKey: 0x7e850e18eec1b120b16fa43014f42b312a45e0b50b5654aba114946e8f14e9fe
    const keys = frenVaultAddressAndKey('test-pet', 'test-seed');
    assert.equal(keys.address, '0x5dA18b0D346b201d5c81b90c92699ECF44F6CC3B');
    assert.equal(
      keys.privateKey,
      '0x7e850e18eec1b120b16fa43014f42b312a45e0b50b5654aba114946e8f14e9fe'
    );
  });

  test('different pet IDs yield distinct vault keys', () => {
    const k1 = frenVaultAddressAndKey('pet-1');
    const k2 = frenVaultAddressAndKey('pet-2');
    assert.notEqual(k1.address, k2.address);
    assert.notEqual(k1.privateKey, k2.privateKey);
  });
});
