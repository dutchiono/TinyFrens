import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDbConnection } from '../../src/db/connection.js';
import { getAllTableNames, SCHEMA_STATEMENTS } from '../../src/db/schema.js';
import {
  migrateAccountWallets,
  migrateDeviceSyncTelegramSelection,
  migrateDeployNotificationCards,
  migrateEnergyPurchases,
  migrateWalletLinks,
  runMigrations,
} from '../../src/db/migrations.js';

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

  test('migrates legacy device wallets once per account and records cross-account conflicts', () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);
    const shared = '0x1111111111111111111111111111111111111111';
    db.prepare('INSERT INTO device_sync_accounts VALUES(?, 0, ?, ?)').run('account-a', '[]', '[]');
    db.prepare('INSERT INTO device_sync_accounts VALUES(?, 0, ?, ?)').run('account-b', '[]', '[]');
    db.prepare('INSERT INTO device_sync_members VALUES(?, ?)').run('device-a1', 'account-a');
    db.prepare('INSERT INTO device_sync_members VALUES(?, ?)').run('device-a2', 'account-a');
    db.prepare('INSERT INTO device_sync_members VALUES(?, ?)').run('device-b', 'account-b');
    db.prepare('INSERT INTO wallet_links VALUES(?, ?, ?)').run('device-a1', shared, 100);
    db.prepare('INSERT INTO wallet_links VALUES(?, ?, ?)').run('device-a2', shared, 110);
    db.prepare('INSERT INTO wallet_links VALUES(?, ?, ?)').run('device-b', shared, 120);

    migrateAccountWallets(db);
    migrateAccountWallets(db);

    const wallets = db.prepare<{ account: string }>(
      'SELECT account FROM account_wallets WHERE address=? AND revoked_at IS NULL'
    ).all(shared);
    assert.deepEqual(wallets, [{ account: 'account-a' }]);
    const conflicts = db.prepare<{ chosen_account: string; conflicting_account: string }>(
      'SELECT chosen_account, conflicting_account FROM account_wallet_conflicts WHERE address=?'
    ).all(shared);
    assert.deepEqual(conflicts, [{ chosen_account: 'account-a', conflicting_account: 'account-b' }]);
    db.close();
  });

  test('adds Energy purchase metadata without converting historical credit deposits', () => {
    const db = createDbConnection(':memory:');
    db.exec(`
      CREATE TABLE deposit_sessions(
        id TEXT PRIMARY KEY, pet_id TEXT NOT NULL, address TEXT NOT NULL, token TEXT,
        expected_amount TEXT NOT NULL, credits INTEGER NOT NULL, status TEXT NOT NULL,
        chain_id INTEGER, tx_hash TEXT, created INTEGER NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE deposits(
        id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, pet_id TEXT NOT NULL,
        chain_id INTEGER NOT NULL, tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL,
        amount TEXT NOT NULL, credits INTEGER NOT NULL, created INTEGER NOT NULL,
        UNIQUE(chain_id, tx_hash, log_index)
      );
    `);
    db.prepare(
      'INSERT INTO deposit_sessions VALUES(?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)'
    ).run('session-1', 'pet-1', '0xabc', '10', 1000, 'confirmed', 84532, '0xtx', 100, 200);
    db.prepare(
      'INSERT INTO deposits(session_id, pet_id, chain_id, tx_hash, log_index, amount, credits, created) VALUES(?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('session-1', 'pet-1', 84532, '0xtx', 0, '10', 1000, 100);

    migrateEnergyPurchases(db);
    migrateEnergyPurchases(db);

    const session = db.prepare<{ credits: number; energy_milli: number; purchase_kind: string }>(
      'SELECT credits, energy_milli, purchase_kind FROM deposit_sessions WHERE id=?'
    ).get('session-1');
    const deposit = db.prepare<{ credits: number; energy_milli: number; purchase_kind: string; account: string | null }>(
      'SELECT credits, energy_milli, purchase_kind, account FROM deposits WHERE session_id=?'
    ).get('session-1');
    assert.deepEqual(session, { credits: 1000, energy_milli: 0, purchase_kind: 'legacy_credit' });
    assert.deepEqual(deposit, {
      credits: 1000,
      energy_milli: 0,
      purchase_kind: 'legacy_credit',
      account: null,
    });
    db.close();
  });

  test('adds persistent Telegram deployment cards without losing subscriptions', () => {
    const db = createDbConnection(':memory:');
    db.exec(`CREATE TABLE deploy_notification_chats(
      chat_id TEXT PRIMARY KEY, username TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      last_revision TEXT NOT NULL DEFAULT '', updated INTEGER NOT NULL
    );`);
    db.prepare('INSERT INTO deploy_notification_chats VALUES(?, ?, 1, ?, ?)')
      .run('-100123', 'owner', 'a'.repeat(40), 123);

    migrateDeployNotificationCards(db);
    migrateDeployNotificationCards(db);

    const row = db.prepare<{ last_revision: string; message_id: number | null }>(
      'SELECT last_revision, message_id FROM deploy_notification_chats WHERE chat_id=?'
    ).get('-100123');
    assert.deepEqual(row, { last_revision: 'a'.repeat(40), message_id: null });
    db.close();
  });
});
