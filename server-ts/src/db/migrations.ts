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
      CREATE TABLE IF NOT EXISTS wallet_links_next(
        pet_id TEXT NOT NULL,
        address TEXT COLLATE NOCASE NOT NULL,
        created INTEGER NOT NULL,
        PRIMARY KEY(pet_id, address)
      );
    `);
  })();
}

/**
 * Applies all schema definitions and backward-compatible data migrations.
 */
export function runMigrations(db: DatabaseConnection): void {
  initSchema(db);
  migrateWalletLinks(db);
}
