import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDbConnection } from '../../src/db/connection.js';
import { getAllTableNames, SCHEMA_STATEMENTS } from '../../src/db/schema.js';
import { migrateWalletLinks, runMigrations } from '../../src/db/migrations.js';

describe('Database: Schema & Migrations', () => {
  test('initializes all 50 tables and indexes on fresh database', () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);

    const tables = getAllTableNames(db);
    assert.strictEqual(tables.length, 50);

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

    // Re-running migration is idempotent
    migrateWalletLinks(db);
    const idempotentRows = db.prepare<{ address: string }>('SELECT address FROM wallet_links WHERE pet_id=?').all('device-1');
    assert.strictEqual(idempotentRows.length, 2);

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
});
