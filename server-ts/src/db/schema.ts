import { DatabaseConnection } from './connection.js';

export const SCHEMA_STATEMENTS: { table: string; sql: string }[] = [
  // Core social & pets (server/app.py)
  {
    table: 'pets',
    sql: 'CREATE TABLE IF NOT EXISTS pets(id TEXT PRIMARY KEY, code TEXT UNIQUE, token TEXT UNIQUE, profile TEXT);',
  },
  {
    table: 'friends',
    sql: 'CREATE TABLE IF NOT EXISTS friends(a TEXT, b TEXT, PRIMARY KEY(a,b));',
  },
  {
    table: 'requests',
    sql: 'CREATE TABLE IF NOT EXISTS requests(sender TEXT, receiver TEXT, PRIMARY KEY(sender,receiver));',
  },
  {
    table: 'pet_wallets',
    sql: 'CREATE TABLE IF NOT EXISTS pet_wallets(pet_id TEXT PRIMARY KEY, provider TEXT, wallet_id TEXT, evm_address TEXT, sol_address TEXT, api_key TEXT, nft TEXT, created INTEGER);',
  },
  {
    table: 'wallet_links',
    sql: 'CREATE TABLE IF NOT EXISTS wallet_links(pet_id TEXT PRIMARY KEY, address TEXT NOT NULL, created INTEGER NOT NULL);',
  },
  {
    table: 'wallet_link_challenges',
    sql: 'CREATE TABLE IF NOT EXISTS wallet_link_challenges(pet_id TEXT PRIMARY KEY, address TEXT NOT NULL, message TEXT NOT NULL, expires INTEGER NOT NULL);',
  },
  {
    table: 'account_wallets',
    sql: "CREATE TABLE IF NOT EXISTS account_wallets(account TEXT NOT NULL, chain_id INTEGER NOT NULL, address TEXT COLLATE NOCASE NOT NULL, provider TEXT NOT NULL DEFAULT 'external', role TEXT NOT NULL DEFAULT 'owner', verification_method TEXT NOT NULL, verified_at INTEGER NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER, PRIMARY KEY(account, chain_id, address));",
  },
  {
    table: 'account_wallet_challenges',
    sql: 'CREATE TABLE IF NOT EXISTS account_wallet_challenges(account TEXT PRIMARY KEY, chain_id INTEGER NOT NULL, address TEXT COLLATE NOCASE NOT NULL, message TEXT NOT NULL, expires INTEGER NOT NULL);',
  },
  {
    table: 'account_wallet_conflicts',
    sql: 'CREATE TABLE IF NOT EXISTS account_wallet_conflicts(chain_id INTEGER NOT NULL, address TEXT COLLATE NOCASE NOT NULL, chosen_account TEXT NOT NULL, conflicting_account TEXT NOT NULL, detected_at INTEGER NOT NULL, resolved_at INTEGER, PRIMARY KEY(chain_id, address, conflicting_account));',
  },
  {
    table: 'magic_links',
    sql: 'CREATE TABLE IF NOT EXISTS magic_links(code TEXT PRIMARY KEY, pet_id TEXT, created INTEGER, expires INTEGER);',
  },
  {
    table: 'fren_nfts',
    sql: "CREATE TABLE IF NOT EXISTS fren_nfts(id INTEGER PRIMARY KEY AUTOINCREMENT, pet_id TEXT, token_id INTEGER, name TEXT, traits TEXT, created INTEGER, locked_frens TEXT DEFAULT '0');",
  },
  {
    table: 'frens_burn_log',
    sql: 'CREATE TABLE IF NOT EXISTS frens_burn_log(id INTEGER PRIMARY KEY AUTOINCREMENT, pet_id TEXT, token_id INTEGER, action TEXT, amount_burned TEXT, amount_treasury TEXT, created INTEGER);',
  },
  {
    table: 'tg_users',
    sql: 'CREATE TABLE IF NOT EXISTS tg_users(tg_id TEXT PRIMARY KEY, pet_id TEXT, updated INTEGER);',
  },
  {
    table: 'tg_media_cache',
    sql: 'CREATE TABLE IF NOT EXISTS tg_media_cache(chain INTEGER, collection TEXT, token_id INTEGER, file_id TEXT, updated INTEGER, PRIMARY KEY(chain,collection,token_id));',
  },
  {
    table: 'dc_users',
    sql: 'CREATE TABLE IF NOT EXISTS dc_users(user_id TEXT PRIMARY KEY, pet_id TEXT, updated INTEGER);',
  },
  {
    table: 'push_subs',
    sql: 'CREATE TABLE IF NOT EXISTS push_subs(endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, pid TEXT NOT NULL, created INTEGER);',
  },
  {
    table: 'github_issue_chats',
    sql: 'CREATE TABLE IF NOT EXISTS github_issue_chats(repo TEXT, issue_number INTEGER, chat_id TEXT, PRIMARY KEY(repo,issue_number));',
  },
  {
    table: 'community_chat_messages',
    sql: 'CREATE TABLE IF NOT EXISTS community_chat_messages(platform TEXT NOT NULL, room_id TEXT NOT NULL, message_id TEXT NOT NULL, user_id TEXT NOT NULL, display_name TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(platform, room_id, message_id));',
  },

  // Account profile (server/account_profile.py)
  {
    table: 'account_profiles',
    sql: "CREATE TABLE IF NOT EXISTS account_profiles(account TEXT PRIMARY KEY, display_name TEXT NOT NULL DEFAULT '', x_handle TEXT NOT NULL DEFAULT '', updated INTEGER NOT NULL);",
  },
  {
    table: 'account_identities',
    sql: "CREATE TABLE IF NOT EXISTS account_identities(account TEXT NOT NULL, platform TEXT NOT NULL, subject TEXT NOT NULL, handle TEXT NOT NULL DEFAULT '', display_name TEXT NOT NULL DEFAULT '', verified INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL, PRIMARY KEY(platform,subject));",
  },

  // Admin surface (server/admin.py)
  {
    table: 'app_settings',
    sql: 'CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL);',
  },
  {
    table: 'admin_audit',
    sql: 'CREATE TABLE IF NOT EXISTS admin_audit(id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, detail TEXT, created INTEGER NOT NULL);',
  },
  {
    table: 'admin_users',
    sql: 'CREATE TABLE IF NOT EXISTS admin_users(username TEXT PRIMARY KEY, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL);',
  },
  {
    table: 'admin_sessions',
    sql: 'CREATE TABLE IF NOT EXISTS admin_sessions(token TEXT PRIMARY KEY, username TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL);',
  },

  // Collection suggestions (server/collection_suggestions.py)
  {
    table: 'collection_suggestions',
    sql: 'CREATE TABLE IF NOT EXISTS collection_suggestions(id INTEGER PRIMARY KEY, chain_id INTEGER NOT NULL, address TEXT NOT NULL, name TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE(chain_id,address));',
  },
  {
    table: 'collection_votes',
    sql: 'CREATE TABLE IF NOT EXISTS collection_votes(id INTEGER PRIMARY KEY AUTOINCREMENT, collection_id INTEGER NOT NULL, pet_id TEXT NOT NULL, credits INTEGER NOT NULL, frens_amount TEXT NOT NULL, created INTEGER NOT NULL);',
  },

  // Device sync (server/device_sync.py)
  {
    table: 'device_sync_members',
    sql: 'CREATE TABLE IF NOT EXISTS device_sync_members(device TEXT PRIMARY KEY, account TEXT NOT NULL);',
  },
  {
    table: 'device_sync_accounts',
    sql: "CREATE TABLE IF NOT EXISTS device_sync_accounts(account TEXT PRIMARY KEY, revision INTEGER NOT NULL, selection TEXT NOT NULL, telegram_selection TEXT NOT NULL DEFAULT '[]');",
  },
  {
    table: 'device_sync_codes',
    sql: 'CREATE TABLE IF NOT EXISTS device_sync_codes(code TEXT PRIMARY KEY, device TEXT UNIQUE NOT NULL, expires REAL NOT NULL, requester TEXT, request_id TEXT, label TEXT);',
  },
  {
    table: 'community_link_requests',
    sql: 'CREATE TABLE IF NOT EXISTS community_link_requests(token TEXT PRIMARY KEY, device TEXT NOT NULL, platform TEXT NOT NULL, label TEXT NOT NULL, expires REAL NOT NULL);',
  },

  // Economy & deposits (server/economy.py)
  {
    table: 'deposit_sessions',
    sql: "CREATE TABLE IF NOT EXISTS deposit_sessions(id TEXT PRIMARY KEY, pet_id TEXT NOT NULL, address TEXT NOT NULL, token TEXT, expected_amount TEXT NOT NULL, credits INTEGER NOT NULL, energy_milli INTEGER NOT NULL DEFAULT 0 CHECK(energy_milli >= 0), purchase_kind TEXT NOT NULL DEFAULT 'legacy_credit', status TEXT NOT NULL, chain_id INTEGER, tx_hash TEXT, created INTEGER NOT NULL, expires_at INTEGER NOT NULL);",
  },
  {
    table: 'deposits',
    sql: "CREATE TABLE IF NOT EXISTS deposits(id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, pet_id TEXT NOT NULL, account TEXT, chain_id INTEGER NOT NULL, tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL, amount TEXT NOT NULL, credits INTEGER NOT NULL, energy_milli INTEGER NOT NULL DEFAULT 0 CHECK(energy_milli >= 0), purchase_kind TEXT NOT NULL DEFAULT 'legacy_credit', created INTEGER NOT NULL, UNIQUE(chain_id, tx_hash, log_index));",
  },
  {
    table: 'credit_accounts',
    sql: 'CREATE TABLE IF NOT EXISTS credit_accounts(pet_id TEXT PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);',
  },
  {
    table: 'credit_ledger',
    sql: 'CREATE TABLE IF NOT EXISTS credit_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT, pet_id TEXT NOT NULL, delta INTEGER NOT NULL, balance INTEGER NOT NULL, reason TEXT NOT NULL, ref_type TEXT, ref_id TEXT, created INTEGER NOT NULL);',
  },
  {
    table: 'player_energy',
    sql: 'CREATE TABLE IF NOT EXISTS player_energy(account TEXT PRIMARY KEY, rechargeable_milli INTEGER NOT NULL DEFAULT 0 CHECK(rechargeable_milli >= 0), purchased_milli INTEGER NOT NULL DEFAULT 0 CHECK(purchased_milli >= 0), accrued_through INTEGER NOT NULL, accrual_remainder INTEGER NOT NULL DEFAULT 0 CHECK(accrual_remainder >= 0 AND accrual_remainder < 86400), rate_per_day_milli INTEGER NOT NULL DEFAULT 0 CHECK(rate_per_day_milli >= 0), capacity_milli INTEGER NOT NULL DEFAULT 0 CHECK(capacity_milli >= 0), rate_version INTEGER NOT NULL, updated_at INTEGER NOT NULL);',
  },
  {
    table: 'energy_ledger',
    sql: "CREATE TABLE IF NOT EXISTS energy_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, rechargeable_delta_milli INTEGER NOT NULL DEFAULT 0, purchased_delta_milli INTEGER NOT NULL DEFAULT 0, rechargeable_balance_milli INTEGER NOT NULL CHECK(rechargeable_balance_milli >= 0), purchased_balance_milli INTEGER NOT NULL CHECK(purchased_balance_milli >= 0), reason TEXT NOT NULL, ref_type TEXT, ref_id TEXT, rate_version INTEGER NOT NULL, created INTEGER NOT NULL);",
  },
  {
    table: 'treasury_transfers',
    sql: 'CREATE TABLE IF NOT EXISTS treasury_transfers(id INTEGER PRIMARY KEY AUTOINCREMENT, chain_id INTEGER NOT NULL, tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL, sender TEXT NOT NULL, token TEXT, amount TEXT NOT NULL, pet_id TEXT, credits INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE(chain_id, tx_hash, log_index));',
  },

  // Indexer (server/indexer.py)
  {
    table: 'indexer_state',
    sql: 'CREATE TABLE IF NOT EXISTS indexer_state(key TEXT PRIMARY KEY, value TEXT);',
  },

  // Extra companions (server/extra_companions.py)
  {
    table: 'extra_companion_ownership',
    sql: 'CREATE TABLE IF NOT EXISTS extra_companion_ownership(wallet TEXT, collection TEXT, token INTEGER, checked REAL, payload TEXT, PRIMARY KEY(wallet,collection,token));',
  },
  {
    table: 'extra_companion_inventory',
    sql: 'CREATE TABLE IF NOT EXISTS extra_companion_inventory(collection TEXT PRIMARY KEY, checked REAL, owners TEXT);',
  },

  // Robot care & companion (server/robot_care.py & server/robot_companion.py)
  {
    table: 'robot_care_daily',
    sql: 'CREATE TABLE IF NOT EXISTS robot_care_daily(pet_id TEXT NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL, PRIMARY KEY(pet_id, day));',
  },
  {
    table: 'robot_ownership',
    sql: 'CREATE TABLE IF NOT EXISTS robot_ownership(wallet TEXT, token_id INTEGER, checked REAL, payload TEXT, PRIMARY KEY(wallet,token_id));',
  },
  {
    table: 'robot_discovery',
    sql: 'CREATE TABLE IF NOT EXISTS robot_discovery(wallet TEXT PRIMARY KEY, block INTEGER, ids TEXT);',
  },
  {
    table: 'robot_owner_inventory',
    sql: 'CREATE TABLE IF NOT EXISTS robot_owner_inventory(id INTEGER PRIMARY KEY, checked REAL, owners TEXT);',
  },

  // Robot gallery (server/robot_gallery.py)
  {
    table: 'robot_gallery_owners',
    sql: 'CREATE TABLE IF NOT EXISTS robot_gallery_owners(token INTEGER PRIMARY KEY, wallet TEXT);',
  },
  {
    table: 'robot_gallery_state',
    sql: 'CREATE TABLE IF NOT EXISTS robot_gallery_state(id INTEGER PRIMARY KEY, block INTEGER, checked REAL);',
  },
  {
    table: 'robot_gallery_events',
    sql: 'CREATE TABLE IF NOT EXISTS robot_gallery_events(block INTEGER, position INTEGER, token INTEGER, minted INTEGER, PRIMARY KEY(block,position));',
  },
  {
    table: 'robot_gallery_art',
    sql: 'CREATE TABLE IF NOT EXISTS robot_gallery_art(token INTEGER PRIMARY KEY, metadata TEXT);',
  },

  // Telegram interactive & moderation (server/telegram_interactive.py & server/telegram_moderation.py)
  {
    table: 'tg_fren_game',
    sql: "CREATE TABLE IF NOT EXISTS tg_fren_game(chat_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'Hatchling', level INTEGER NOT NULL DEFAULT 1, xp INTEGER NOT NULL DEFAULT 0, health INTEGER NOT NULL DEFAULT 100, hunger INTEGER NOT NULL DEFAULT 70, energy INTEGER NOT NULL DEFAULT 100, frens_coins INTEGER NOT NULL DEFAULT 50, inventory TEXT NOT NULL DEFAULT '{\"berries\":2,\"snacks\":1}', updated_at INTEGER NOT NULL, PRIMARY KEY(chat_id, user_id));",
  },
  {
    table: 'tg_scrap_runs',
    sql: "CREATE TABLE IF NOT EXISTS tg_scrap_runs(id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, message_id INTEGER, starter_user_id TEXT NOT NULL, starter_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, join_until INTEGER NOT NULL, resolved_at INTEGER, loot_name TEXT, rarity TEXT, reward_each INTEGER);",
  },
  {
    table: 'tg_scrap_members',
    sql: "CREATE TABLE IF NOT EXISTS tg_scrap_members(run_id TEXT NOT NULL, user_id TEXT NOT NULL, pet_id TEXT NOT NULL, display_name TEXT NOT NULL, reward INTEGER NOT NULL DEFAULT 0, joined_at INTEGER NOT NULL, PRIMARY KEY(run_id, pet_id), UNIQUE(run_id, user_id), FOREIGN KEY(run_id) REFERENCES tg_scrap_runs(id));",
  },
  {
    table: 'tg_filters',
    sql: "CREATE TABLE IF NOT EXISTS tg_filters(chat_id TEXT NOT NULL, trigger TEXT NOT NULL, response TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, PRIMARY KEY(chat_id, trigger));",
  },
  {
    table: 'tg_blocklist',
    sql: "CREATE TABLE IF NOT EXISTS tg_blocklist(chat_id TEXT NOT NULL, pattern TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, PRIMARY KEY(chat_id, pattern));",
  },
  {
    table: 'tg_strikes',
    sql: "CREATE TABLE IF NOT EXISTS tg_strikes(chat_id TEXT NOT NULL, user_id TEXT NOT NULL, strikes INTEGER NOT NULL DEFAULT 0, last_violation TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL, PRIMARY KEY(chat_id, user_id));",
  },
  {
    table: 'tg_challenges',
    sql: 'CREATE TABLE IF NOT EXISTS tg_challenges(chat_id TEXT NOT NULL, user_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE, answer INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, expires INTEGER NOT NULL, message_id INTEGER, PRIMARY KEY(chat_id, user_id));',
  },
  {
    table: 'tg_suspected_bots',
    sql: "CREATE TABLE IF NOT EXISTS tg_suspected_bots(chat_id TEXT NOT NULL, user_id TEXT NOT NULL, username TEXT NOT NULL DEFAULT '', display_name TEXT NOT NULL DEFAULT '', flagged_by TEXT NOT NULL, source_message_id INTEGER, flagged_at INTEGER NOT NULL, PRIMARY KEY(chat_id, user_id));",
  },
  {
    table: 'tg_moderation_warnings',
    sql: "CREATE TABLE IF NOT EXISTS tg_moderation_warnings(chat_id TEXT NOT NULL, user_id TEXT NOT NULL, warnings INTEGER NOT NULL DEFAULT 0, last_reason TEXT NOT NULL DEFAULT '', warned_by TEXT NOT NULL DEFAULT '', muted_until INTEGER, source_message_id INTEGER, updated_at INTEGER NOT NULL, PRIMARY KEY(chat_id, user_id));",
  },
  {
    table: 'deploy_notification_chats',
    sql: "CREATE TABLE IF NOT EXISTS deploy_notification_chats(chat_id TEXT PRIMARY KEY, username TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, last_revision TEXT NOT NULL DEFAULT '', last_state TEXT NOT NULL DEFAULT '', message_id INTEGER, updated INTEGER NOT NULL);",
  },
  {
    table: 'deployment_component_status',
    sql: 'CREATE TABLE IF NOT EXISTS deployment_component_status(component TEXT PRIMARY KEY, revision TEXT NOT NULL, verified_at INTEGER NOT NULL);',
  },

  // Turtle connect & wallets (server/turtle_connect.py)
  {
    table: 'turtle_ownership',
    sql: 'CREATE TABLE IF NOT EXISTS turtle_ownership(wallet TEXT, token_id INTEGER, checked REAL, payload TEXT, PRIMARY KEY(wallet,token_id));',
  },
  {
    table: 'turtle_pairings',
    sql: 'CREATE TABLE IF NOT EXISTS turtle_pairings(code TEXT PRIMARY KEY, pet_id TEXT UNIQUE, expires REAL, challenge_id TEXT, address TEXT, token_id INTEGER, message TEXT, verified INTEGER DEFAULT 0);',
  },
  {
    table: 'wallet_social_profiles',
    sql: 'CREATE TABLE IF NOT EXISTS wallet_social_profiles(address TEXT PRIMARY KEY COLLATE NOCASE, x_handle TEXT NOT NULL, source TEXT NOT NULL, updated INTEGER NOT NULL);',
  },
];

export const INDEX_STATEMENTS: string[] = [
  'CREATE INDEX IF NOT EXISTS credit_ledger_pet ON credit_ledger(pet_id, id);',
  'CREATE INDEX IF NOT EXISTS energy_ledger_account ON energy_ledger(account, id);',
  'CREATE UNIQUE INDEX IF NOT EXISTS account_wallets_active_address ON account_wallets(chain_id, address COLLATE NOCASE) WHERE revoked_at IS NULL;',
  'CREATE INDEX IF NOT EXISTS account_wallets_account ON account_wallets(account, chain_id, revoked_at);',
  'CREATE INDEX IF NOT EXISTS deposit_sessions_address ON deposit_sessions(address);',
  'CREATE INDEX IF NOT EXISTS deposit_sessions_pet ON deposit_sessions(pet_id, status);',
  'CREATE INDEX IF NOT EXISTS treasury_transfers_sender ON treasury_transfers(sender);',
  'CREATE INDEX IF NOT EXISTS treasury_transfers_pet ON treasury_transfers(pet_id, id);',
  'CREATE INDEX IF NOT EXISTS collection_votes_collection ON collection_votes(collection_id);',
  'CREATE INDEX IF NOT EXISTS collection_votes_pet ON collection_votes(pet_id);',
  'CREATE INDEX IF NOT EXISTS community_chat_messages_recent ON community_chat_messages(platform, room_id, created_at DESC);',
  "CREATE UNIQUE INDEX IF NOT EXISTS tg_scrap_one_open_run_per_chat ON tg_scrap_runs(chat_id) WHERE status='open';",
  'CREATE INDEX IF NOT EXISTS tg_scrap_members_run ON tg_scrap_members(run_id, joined_at);',
];

export function initSchema(db: DatabaseConnection): void {
  for (const item of SCHEMA_STATEMENTS) {
    db.exec(item.sql);
  }
  for (const indexSql of INDEX_STATEMENTS) {
    db.exec(indexSql);
  }
}

export function getAllTableNames(db: DatabaseConnection): string[] {
  const rows = db.prepare<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all();
  return rows.map(r => r.name);
}
