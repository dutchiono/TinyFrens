import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_INVENTORY } from '../../src/config.js';
import { SCHEMA_STATEMENTS } from '../../src/db/schema.js';

describe('Parity Manifest & Inventory Verification', () => {
  const CHECKLIST_TABLES = [
    'account_identities',
    'account_profiles',
    'admin_audit',
    'admin_sessions',
    'admin_users',
    'app_settings',
    'pets',
    'friends',
    'requests',
    'push_subs',
    'device_sync_accounts',
    'device_sync_codes',
    'device_sync_members',
    'pet_wallets',
    'wallet_links',
    'wallet_link_challenges',
    'account_wallets',
    'account_wallet_challenges',
    'account_wallet_conflicts',
    'wallet_social_profiles',
    'magic_links',
    'fren_nfts',
    'frens_burn_log',
    'collection_suggestions',
    'collection_votes',
    'credit_accounts',
    'credit_ledger',
    'deposit_sessions',
    'deposits',
    'treasury_transfers',
    'indexer_state',
    'robot_care_daily',
    'robot_discovery',
    'robot_owner_inventory',
    'robot_ownership',
    'robot_gallery_art',
    'robot_gallery_events',
    'robot_gallery_owners',
    'robot_gallery_state',
    'extra_companion_inventory',
    'extra_companion_ownership',
    'turtle_ownership',
    'turtle_pairings',
    'tg_users',
    'tg_media_cache',
    'tg_filters',
    'tg_blocklist',
    'tg_strikes',
    'tg_challenges',
    'tg_suspected_bots',
    'tg_moderation_warnings',
    'tg_fren_game',
    'deploy_notification_chats',
    'dc_users',
    'github_issue_chats',
  ];

  test('all parity-checklist tables are present in schema statements', () => {
    const definedTables = new Set(SCHEMA_STATEMENTS.map(s => s.table));
    for (const table of CHECKLIST_TABLES) {
      assert.ok(definedTables.has(table), `Manifest missing checklist table: ${table}`);
    }
  });

  test('all configuration keys in checklist are classified in config inventory', () => {
    const inventoryKeys = new Set(CONFIG_INVENTORY.map(k => k.key));
    const requiredKeys = [
      'HOST',
      'PORT',
      'DB_PATH',
      'PET_DOMAIN',
      'ALLOWED_ORIGINS',
      'ALLOW_NATIVE_ORIGIN',
      'TRUST_PROXY',
      'DEPLOY_NOTIFY_SECRET',
      'GEMINI_API_KEY',
      'GOOGLE_API_KEY',
      'GEMINI_MODEL',
      'BANKR_API_KEY',
      'BANKR_API_URL',
      'BANKR_PARTNER_KEY',
      'BASE_RPC_URL',
      'CHAIN_ID',
      'TINYFRENS_NFT_ADDRESS',
      'TINYFRENS_NFT_MINT_PRICE_WEI',
      'ALLOW_TESTNET_FREE_MINT',
      'FREN_VAULT_SEED',
      'FRENS_PER_VAULT_MINT',
      'SAVE_CHANGES_FEE_FRENS',
      'ROBOTS_RPC_URL',
      'ECONOMY_MODE',
      'ECONOMY_DEPOSITS',
      'ECONOMY_INDEXER_SECRET',
      'DEPOSIT_ROUTER_PROXY',
      'INDEXER_ENABLED',
      'INDEXER_LOOKBACK',
      'INDEXER_POLL_SECONDS',
      'FRENS_TOKEN',
      'FRENS_TREASURY',
      'FRENS_TREASURY_INDEXER',
      'ROBOT_CARE_DAILY_ALLOWANCE',
      'NEYNAR_API_KEY',
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_DEPLOY_OWNER_ID',
      'GITHUB_TOKEN',
      'DISCORD_CLIENT_ID',
      'VAPID_PUBLIC_KEY',
      'ADMIN_TOKEN',
    ];

    for (const key of requiredKeys) {
      assert.ok(inventoryKeys.has(key), `Manifest missing configuration key: ${key}`);
    }
  });
});
