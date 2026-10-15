import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, getAllowedOrigins, CONFIG_INVENTORY } from '../src/config.js';

describe('Configuration Ledger & Parser', () => {
  test('loads default configuration matching Python defaults', () => {
    const config = loadConfig({});
    assert.equal(config.HOST, '0.0.0.0');
    assert.equal(config.PORT, 8080);
    assert.equal(config.DB_PATH, 'tinyfrens.db');
    assert.equal(config.DB_READ_ONLY, false);
    assert.equal(config.CHAIN_ID, 84532);
    assert.equal(config.FREN_VAULT_SEED, 'tinyfrens-master-vault-seed-v1');
    assert.equal(config.ALLOW_NATIVE_ORIGIN, false);
    assert.equal(config.TRUST_PROXY, false);
    assert.equal(config.ROBOT_CARE_DAILY_ALLOWANCE, 24);
    assert.equal(config.ROBOT_CARE_PRICE_FEED, 1000);
    assert.equal(config.ECONOMY_MODE, 'off');
    assert.equal(config.TELEGRAM_ISSUE_HISTORY, 25);
  });

  test('parses environment overrides and coercions', () => {
    const config = loadConfig({
      PORT: '9000',
      ALLOW_NATIVE_ORIGIN: 'true',
      TRUST_PROXY: 'true',
      CHAIN_ID: '8453',
      ALLOWED_ORIGINS: 'https://foo.com, https://bar.com',
      ROBOT_CARE_DAILY_ALLOWANCE: '48',
      DB_READ_ONLY: 'true',
    });

    assert.equal(config.PORT, 9000);
    assert.equal(config.ALLOW_NATIVE_ORIGIN, true);
    assert.equal(config.TRUST_PROXY, true);
    assert.equal(config.CHAIN_ID, 8453);
    assert.equal(config.ROBOT_CARE_DAILY_ALLOWANCE, 48);
    assert.equal(config.DB_READ_ONLY, true);

    const origins = getAllowedOrigins(config);
    assert.ok(origins.has('https://foo.com'));
    assert.ok(origins.has('https://bar.com'));
    assert.ok(origins.has('null'));
  });

  test('inventory classifies all expected configuration keys', () => {
    assert.ok(CONFIG_INVENTORY.length >= 60, `Inventory has ${CONFIG_INVENTORY.length} keys`);
    for (const item of CONFIG_INVENTORY) {
      assert.ok(item.key.length > 0);
      assert.ok(
        ['secret', 'public', 'optional', 'required', 'deprecated', 'documentation-only'].includes(
          item.classification
        ),
        `Invalid classification for ${item.key}`
      );
    }
  });
});
