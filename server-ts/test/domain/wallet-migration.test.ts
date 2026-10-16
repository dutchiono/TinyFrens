import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import { createAppContext } from '../../src/context.js';
import { loadConfig } from '../../src/config.js';
import { addWallet, linkedWallets, removeWallet } from '../../src/domain/wallet-link.js';
import { toChecksumAddress } from '../../src/crypto/signatures.js';

describe('Wallet Migration (server/test_wallet_migration.py)', () => {
  test('existing link survives migration and removal survives restart', () => {
    const db = createDbConnection(':memory:');

    // Create legacy table where pet_id was the single primary key
    db.prepare('CREATE TABLE wallet_links(pet_id TEXT PRIMARY KEY, address TEXT, created INTEGER)').run();

    const first = toChecksumAddress('0x' + 'a'.repeat(40));
    const second = toChecksumAddress('0x' + 'b'.repeat(40));

    db.prepare('INSERT INTO wallet_links VALUES(?, ?, ?)').run('device', first, 1);

    // Run migration
    runMigrations(db);
    assert.strictEqual(
      db.prepare<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='wallet_links_next'").get(),
      undefined
    );

    const config = loadConfig();
    const context = createAppContext(config, db);

    assert.deepStrictEqual(linkedWallets(context, 'device'), [first]);

    addWallet(context, 'device', second);
    addWallet(context, 'device', second.toUpperCase().replace('0X', '0x'));

    assert.strictEqual(linkedWallets(context, 'device').length, 2);
    assert.deepStrictEqual(linkedWallets(context, 'another-device'), []);

    removeWallet(context, 'device', first);

    runMigrations(db);
    assert.strictEqual(linkedWallets(context, 'device').length, 1);

    db.close();
  });
});
