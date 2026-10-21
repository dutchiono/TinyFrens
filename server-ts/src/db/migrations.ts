import crypto from 'node:crypto';
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
 * Promotes legacy device wallet links into the account identity boundary. The oldest link wins if
 * the same address appears on unrelated accounts; the ambiguity is recorded for manual recovery.
 */
export function migrateAccountWallets(db: DatabaseConnection): void {
  const links = db.prepare<{ pet_id: string; address: string; created: number }>(
    'SELECT pet_id, address, created FROM wallet_links ORDER BY created, pet_id, address'
  ).all();
  const findMembership = db.prepare<{ account: string }>(
    'SELECT account FROM device_sync_members WHERE device=?'
  );
  const insertMembership = db.prepare(
    'INSERT INTO device_sync_members(device, account) VALUES(?, ?)'
  );
  const insertAccount = db.prepare(
    "INSERT INTO device_sync_accounts(account, revision, selection, telegram_selection) VALUES(?, 0, '[]', '[]')"
  );
  const findOwner = db.prepare<{ account: string }>(
    'SELECT account FROM account_wallets WHERE chain_id=8453 AND address=? COLLATE NOCASE AND revoked_at IS NULL'
  );
  const insertWallet = db.prepare(
    `INSERT OR IGNORE INTO account_wallets(
       account, chain_id, address, provider, role, verification_method, verified_at, created_at, revoked_at
     ) VALUES(?, 8453, ?, 'external', 'owner', 'legacy_verified', ?, ?, NULL)`
  );
  const insertConflict = db.prepare(
    `INSERT OR IGNORE INTO account_wallet_conflicts(
       chain_id, address, chosen_account, conflicting_account, detected_at, resolved_at
     ) VALUES(8453, ?, ?, ?, ?, NULL)`
  );

  db.transaction(() => {
    for (const link of links) {
      let account = findMembership.get(link.pet_id)?.account;
      if (!account) {
        account = crypto.randomBytes(18).toString('base64url');
        insertAccount.run(account);
        insertMembership.run(link.pet_id, account);
      }

      const owner = findOwner.get(link.address);
      if (!owner || owner.account === account) {
        insertWallet.run(account, link.address, link.created, link.created);
      } else {
        insertConflict.run(link.address, owner.account, account, link.created);
      }
    }
  })();
}

/** Adds immutable purchase quotes without converting any historical credit deposits. */
export function migrateEnergyPurchases(db: DatabaseConnection): void {
  const sessionColumns = db.prepare<TableColumnInfo>('PRAGMA table_info(deposit_sessions)').all();
  if (!sessionColumns.some(column => column.name === 'energy_milli')) {
    db.exec('ALTER TABLE deposit_sessions ADD COLUMN energy_milli INTEGER NOT NULL DEFAULT 0 CHECK(energy_milli >= 0);');
  }
  if (!sessionColumns.some(column => column.name === 'purchase_kind')) {
    db.exec("ALTER TABLE deposit_sessions ADD COLUMN purchase_kind TEXT NOT NULL DEFAULT 'legacy_credit';");
  }

  const depositColumns = db.prepare<TableColumnInfo>('PRAGMA table_info(deposits)').all();
  if (!depositColumns.some(column => column.name === 'account')) {
    db.exec('ALTER TABLE deposits ADD COLUMN account TEXT;');
  }
  if (!depositColumns.some(column => column.name === 'energy_milli')) {
    db.exec('ALTER TABLE deposits ADD COLUMN energy_milli INTEGER NOT NULL DEFAULT 0 CHECK(energy_milli >= 0);');
  }
  if (!depositColumns.some(column => column.name === 'purchase_kind')) {
    db.exec("ALTER TABLE deposits ADD COLUMN purchase_kind TEXT NOT NULL DEFAULT 'legacy_credit';");
  }
}

/** Keeps one editable deployment card per subscribed Telegram chat. */
export function migrateDeployNotificationCards(db: DatabaseConnection): void {
  const columns = db.prepare<TableColumnInfo>('PRAGMA table_info(deploy_notification_chats)').all();
  if (!columns.some(column => column.name === 'message_id')) {
    db.exec('ALTER TABLE deploy_notification_chats ADD COLUMN message_id INTEGER;');
  }
  if (!columns.some(column => column.name === 'last_state')) {
    db.exec("ALTER TABLE deploy_notification_chats ADD COLUMN last_state TEXT NOT NULL DEFAULT '';");
  }
  db.exec(
    'CREATE TABLE IF NOT EXISTS deployment_component_status(component TEXT PRIMARY KEY, revision TEXT NOT NULL, verified_at INTEGER NOT NULL);'
  );
  db.exec(
    `INSERT OR IGNORE INTO deployment_component_status(component, revision, verified_at)
     SELECT 'website', last_revision, updated FROM deploy_notification_chats
     WHERE length(last_revision)=40 ORDER BY updated DESC LIMIT 1`
  );
}

/** Adds persisted Scrap Run choices without invalidating active legacy lobbies. */
export function migrateScrapGameLoop(db: DatabaseConnection): void {
  const columns = db.prepare<TableColumnInfo>('PRAGMA table_info(tg_scrap_runs)').all();
  if (!columns.some(column => column.name === 'search_mode')) {
    db.exec('ALTER TABLE tg_scrap_runs ADD COLUMN search_mode TEXT;');
  }
  if (!columns.some(column => column.name === 'booster_used')) {
    db.exec('ALTER TABLE tg_scrap_runs ADD COLUMN booster_used INTEGER NOT NULL DEFAULT 0;');
  }
}

/**
 * Applies all schema definitions and backward-compatible data migrations.
 */
export function runMigrations(db: DatabaseConnection): void {
  initSchema(db);
  migrateWalletLinks(db);
  migrateDeviceSyncTelegramSelection(db);
  migrateAccountWallets(db);
  migrateEnergyPurchases(db);
  migrateDeployNotificationCards(db);
  migrateScrapGameLoop(db);
}
