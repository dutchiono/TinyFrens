import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDbConnection } from '../../src/db/connection.js';
import { getAllTableNames, SCHEMA_STATEMENTS } from '../../src/db/schema.js';
import { migrateDeviceSyncTelegramSelection, migrateWalletLinks, runMigrations } from '../../src/db/migrations.js';

describe('Database: Schema & Migrations', () => {
  test('initializes every permanent table and index on a fresh database', () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);

    const tables = getAllTableNames(db);
    assert.strictEqual(tables.length, SCHEMA_STATEMENTS.length);
    assert.ok(!tables.includes('wallet_links_next'));

    for (const statement of SCHEMA_STATEMENTS) {
      assert.ok(
        tables.includes(statement.table),
        `Table ${statement.table} should be present in sqlite_master`
      );
    }

    db.close();
  });

  test('migrates legacy wallet_links table to composite primary key', () => {
    const db = createDbConnection(':memory:');

    // Create legacy table with single PRIMARY KEY (pet_id)
    db.exec('CREATE TABLE wallet_links(pet_id TEXT PRIMARY KEY, address TEXT, created INTEGER);');
    const firstWallet = '0x1111111111111111111111111111111111111111';
    const secondWallet = '0x2222222222222222222222222222222222222222';

    db.prepare('INSERT INTO wallet_links VALUES(?, ?, ?)').run('device-1', firstWallet, 100);

    // Legacy table prevents linking a second wallet to the same device (SQLITE_CONSTRAINT_PRIMARYKEY)
    assert.throws(() => {
      db.prepare('INSERT INTO wallet_links VALUES(?, ?, ?)').run('device-1', secondWallet, 200);
    });

    // Run migration
    migrateWalletLinks(db);

    // Verify existing link survived
    const rows = db.prepare<{ address: string }>('SELECT address FROM wallet_links WHERE pet_id=?').all('device-1');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].address, firstWallet);

    // Verify composite primary key now allows linking second wallet to device-1
    db.prepare('INSERT INTO wallet_links VALUES(?, ?, ?)').run('device-1', secondWallet, 200);
    const updatedRows = db.prepare<{ address: string }>('SELECT address FROM wallet_links WHERE pet_id=?').all('device-1');
    assert.strictEqual(updatedRows.length, 2);
    assert.ok(!getAllTableNames(db).includes('wallet_links_next'));

    // Re-running migration is idempotent
    db.exec('CREATE TABLE wallet_links_next(value TEXT);');
    migrateWalletLinks(db);
    const idempotentRows = db.prepare<{ address: string }>('SELECT address FROM wallet_links WHERE pet_id=?').all('device-1');
    assert.strictEqual(idempotentRows.length, 2);
    assert.ok(!getAllTableNames(db).includes('wallet_links_next'));

    db.close();
  });

  test('transaction rolls back on error and preserves prior state', () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);

    db.prepare('INSERT INTO pets(id, code, token, profile) VALUES(?, ?, ?, ?)').run(
      'pet-1',
      'CODE1',
      'TOKEN1',
      '{}'
    );

    assert.throws(() => {
      db.transaction(() => {
        db.prepare('UPDATE pets SET profile=? WHERE id=?').run('{"updated":true}', 'pet-1');
        // Force an error inside the transaction
        throw new Error('Forced transaction failure');
      })();
    });

    const pet = db.prepare<{ profile: string }>('SELECT profile FROM pets WHERE id=?').get('pet-1');
    assert.strictEqual(pet?.profile, '{}');

    db.close();
  });

  test('migrates existing screen selections into independent Telegram slots once', () => {
    const db = createDbConnection(':memory:');
    db.exec('CREATE TABLE device_sync_accounts(account TEXT PRIMARY KEY, revision INTEGER NOT NULL, selection TEXT NOT NULL);');
    db.prepare('INSERT INTO device_sync_accounts VALUES(?, ?, ?)').run('account-1', 4, JSON.stringify([
      { chainId: 8453, originalAddress: '0x8d446c126d4873bfa3eb195b7f0094acc1187a75', tokenId: 7, motion: { mode: 'roam', speed: 60, size: 80 } },
    ]));

    migrateDeviceSyncTelegramSelection(db);
    migrateDeviceSyncTelegramSelection(db);
    const row = db.prepare<{ revision: number; telegram_selection: string }>(
      'SELECT revision, telegram_selection FROM device_sync_accounts WHERE account=?'
    ).get('account-1');
    assert.equal(row?.revision, 4);
    assert.deepEqual(JSON.parse(row?.telegram_selection || '[]'), [{
      chainId: 8453,
      originalAddress: '0x8d446c126d4873bfa3eb195b7f0094acc1187a75',
      tokenId: 7,
      slot: 1,
    }]);
    db.close();
  });
});
