import { DatabaseConnection } from './connection.js';
import { initSchema } from './schema.js';

interface TableColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

/**
 * Migration helper to ensure wallet_links table supports composite (pet_id, address) primary key,
 * matching Python turtle_connect.migrate_wallet_links behavior.
 */
export function migrateWalletLinks(db: DatabaseConnection): void {
  const tableCheck = db.prepare<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='wallet_links'"
  ).get();
  if (!tableCheck) {
    return;
  }

  const columns = db.prepare<TableColumnInfo>('PRAGMA table_info(wallet_links)').all();
  // Check if address is already part of the composite primary key (pk > 0)
  const isAddressCompositePk = columns.some(col => col.name === 'address' && col.pk > 0);
  if (isAddressCompositePk) {
    db.exec('DROP TABLE IF EXISTS wallet_links_next;');
    return;
  }

  db.transaction(() => {
    db.exec(`
      DROP TABLE IF EXISTS wallet_links_next;
      CREATE TABLE wallet_links_next(
        pet_id TEXT NOT NULL,
        address TEXT COLLATE NOCASE NOT NULL,
        created INTEGER NOT NULL,
        PRIMARY KEY(pet_id, address)
      );
      INSERT OR IGNORE INTO wallet_links_next (pet_id, address, created)
        SELECT pet_id, address, created FROM wallet_links;
      DROP TABLE wallet_links;
      ALTER TABLE wallet_links_next RENAME TO wallet_links;
    `);
  })();
}

/** Adds independent Telegram display slots while preserving the old /show order once. */
export function migrateDeviceSyncTelegramSelection(db: DatabaseConnection): void {
  const columns = db.prepare<TableColumnInfo>('PRAGMA table_info(device_sync_accounts)').all();
  if (columns.some(column => column.name === 'telegram_selection')) return;

  db.exec("ALTER TABLE device_sync_accounts ADD COLUMN telegram_selection TEXT NOT NULL DEFAULT '[]';");
  const rows = db.prepare<{ account: string; selection: string }>(
    'SELECT account, selection FROM device_sync_accounts'
  ).all();
  const update = db.prepare(
    'UPDATE device_sync_accounts SET telegram_selection=? WHERE account=?'
  );
  db.transaction(() => {
    for (const row of rows) {
      let selection: Array<Record<string, unknown>> = [];
      try {
        const parsed = JSON.parse(row.selection);
        if (Array.isArray(parsed)) selection = parsed;
      } catch {
        // Invalid legacy state remains unselected instead of blocking startup.
      }
      const telegramSelection = selection
        .filter(item => item && typeof item === 'object')
        .slice(0, 5)
        .map((item, index) => ({
          chainId: item.chainId,
          originalAddress: item.originalAddress,
          tokenId: item.tokenId,
          slot: index + 1,
        }));
      update.run(JSON.stringify(telegramSelection), row.account);
    }
  })();
}

/**
 * Applies all schema definitions and backward-compatible data migrations.
 */
export function runMigrations(db: DatabaseConnection): void {
  initSchema(db);
  migrateWalletLinks(db);
  migrateDeviceSyncTelegramSelection(db);
}
