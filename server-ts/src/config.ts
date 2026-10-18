import { z } from 'zod';

export type ConfigClassification =
  | 'secret'
  | 'public'
  | 'optional'
  | 'required'
  | 'deprecated'
  | 'documentation-only';

export interface ConfigKeyMeta {
  key: string;
  classification: ConfigClassification;
  description: string;
}

export const CONFIG_INVENTORY: ConfigKeyMeta[] = [
  // Server/network
  { key: 'HOST', classification: 'public', description: 'Bind host for HTTP server' },
  { key: 'PORT', classification: 'public', description: 'Bind port for HTTP server' },
  { key: 'DB_PATH', classification: 'optional', description: 'Path to SQLite database file' },
  { key: 'DB_READ_ONLY', classification: 'public', description: 'Open SQLite without schema or write access' },
  { key: 'PET_DOMAIN', classification: 'public', description: 'Public domain for pet links' },
  { key: 'ALLOWED_ORIGINS', classification: 'public', description: 'Comma-separated allowed CORS origins' },
  { key: 'ALLOW_NATIVE_ORIGIN', classification: 'public', description: 'Allow Origin: null for native mobile/desktop apps' },
  { key: 'TRUST_PROXY', classification: 'public', description: 'Trust X-Forwarded-For headers when behind reverse proxy' },
  { key: 'LOG_LEVEL', classification: 'public', description: 'Fastify structured log level' },
  { key: 'APP_REVISION', classification: 'public', description: 'Deployed Git revision reported by the health endpoint' },

  // AI
  { key: 'GEMINI_API_KEY', classification: 'secret', description: 'Google Gemini API key for conversational AI' },
  { key: 'GOOGLE_API_KEY', classification: 'secret', description: 'Alternative alias for Gemini API key' },
  { key: 'GEMINI_MODEL', classification: 'public', description: 'Default Gemini model for Telegram and chat' },

  // Bankr
  { key: 'BANKR_API_KEY', classification: 'secret', description: 'Bankr API key for bot actions' },
  { key: 'BANKR_API_URL', classification: 'public', description: 'Bankr API base URL' },
  { key: 'BANKR_PARTNER_KEY', classification: 'secret', description: 'Bankr partner API key' },

  // Chain/NFT
  { key: 'BASE_RPC_URL', classification: 'optional', description: 'Base RPC endpoint URL' },
  { key: 'CHAIN_ID', classification: 'public', description: 'Target network Chain ID' },
  { key: 'TINYFRENS_NFT_ADDRESS', classification: 'public', description: 'TinyFrens NFT contract address' },
  { key: 'TINYFRENS_NFT_MINT_PRICE_WEI', classification: 'public', description: 'Mint price in wei for TinyFrens NFT' },
  { key: 'ALLOW_TESTNET_FREE_MINT', classification: 'public', description: 'Allow zero-cost mint on testnets' },
  { key: 'FREN_VAULT_SEED', classification: 'secret', description: 'Deterministic seed for pet vault key derivation' },
  { key: 'FRENS_PER_VAULT_MINT', classification: 'public', description: 'FRENS tokens credited per vault mint' },
  { key: 'SAVE_CHANGES_FEE_FRENS', classification: 'public', description: 'FRENS fee required to save NFT changes' },
  { key: 'ROBOTS_RPC_URL', classification: 'public', description: 'RPC endpoint for Robots companion contract' },
  { key: 'ROBINHOOD_RPC_URL', classification: 'optional', description: 'RPC endpoint for Robinhood chain' },
  { key: 'ROBINHOOD_BLOCKSCOUT_API_URL', classification: 'optional', description: 'Blockscout API endpoint for Robinhood chain' },

  // Economy/deposits
  { key: 'ECONOMY_MODE', classification: 'public', description: 'Economy operational mode (off/testnet/mainnet)' },
  { key: 'ECONOMY_DEPOSITS', classification: 'public', description: 'Enable economy deposit acceptance' },
  { key: 'ECONOMY_INDEXER_SECRET', classification: 'secret', description: 'Shared secret for deposit confirmation callback' },
  { key: 'DEPOSIT_ROUTER_PROXY', classification: 'public', description: 'Address of DepositRouter UUPS proxy' },
  { key: 'DEPOSIT_SESSION_ADDRESSES', classification: 'public', description: 'Fallback comma-separated deposit addresses' },
  { key: 'GAME_CONTROLLER_PRIVATE_KEY', classification: 'secret', description: 'Private key signing DepositRouter.createSession' },
  { key: 'INDEXER_ENABLED', classification: 'public', description: 'Run on-chain deposit indexer (auto/true/false)' },
  { key: 'INDEXER_LOOKBACK', classification: 'public', description: 'Block lookback distance on indexer startup' },
  { key: 'INDEXER_POLL_SECONDS', classification: 'public', description: 'Poll interval in seconds for on-chain indexer' },
  { key: 'TESTNET_ENERGY_MILLI_PER_FRENS', classification: 'public', description: 'Testnet-only purchased Energy quote per FRENS in milli-Energy' },

  // Treasury
  { key: 'FRENS_TOKEN', classification: 'public', description: 'ERC-20 FRENS contract address' },
  { key: 'FRENS_TREASURY', classification: 'public', description: 'Treasury wallet address receiving FRENS' },
  { key: 'FRENS_TREASURY_INDEXER', classification: 'public', description: 'Enable treasury transfer indexer' },
  { key: 'FRENS_TREASURY_MAX_CREDITS', classification: 'public', description: 'Per-transfer credit maximum cap' },
  { key: 'FRENS_TREASURY_CHAIN_ID', classification: 'public', description: 'Chain ID for treasury monitoring' },
  { key: 'FRENS_TREASURY_TOKEN', classification: 'public', description: 'FRENS token address monitored for treasury' },

  // Robot care
  { key: 'ROBOT_CARE_DAILY_ALLOWANCE', classification: 'public', description: 'Free daily care actions per pet' },
  { key: 'ROBOT_CARE_GAME_REWARD_CREDITS', classification: 'public', description: 'Credits rewarded per mini-game completion' },
  { key: 'ROBOT_CARE_PRICE_FEED', classification: 'public', description: 'Price in FRENS for feed action' },
  { key: 'ROBOT_CARE_PRICE_PLAY', classification: 'public', description: 'Price in FRENS for play action' },
  { key: 'ROBOT_CARE_PRICE_REST', classification: 'public', description: 'Price in FRENS for rest action' },
  { key: 'ROBOT_CARE_PRICE_ADVENTURE', classification: 'public', description: 'Price in FRENS for adventure action' },
  { key: 'ROBOT_CARE_PRICE_CLEAN', classification: 'public', description: 'Price in FRENS for clean action' },
  { key: 'ROBOT_CARE_PRICE_VITAMIN', classification: 'public', description: 'Price in FRENS for vitamin action' },
  { key: 'ROBOT_CARE_PRICE_SCOLD', classification: 'public', description: 'Price in FRENS for scold action' },
  { key: 'ROBOT_CARE_PRICE_REVIVE', classification: 'public', description: 'Price in FRENS for revive action' },
  { key: 'ENERGY_POLICY_VERSION', classification: 'public', description: 'Version applied to account Energy rate calculations' },
  { key: 'ENERGY_BASE_PER_DAY', classification: 'public', description: 'Base daily Energy for accounts holding a Robot' },
  { key: 'ENERGY_PER_ROBOT_PER_DAY', classification: 'public', description: 'Additional daily Energy per eligible Robot' },
  { key: 'ENERGY_CAPACITY_DAYS', classification: 'public', description: 'Rechargeable Energy capacity measured in days' },
  { key: 'ROBOT_ENERGY_COST_FEED', classification: 'public', description: 'Energy cost for feeding a Robot' },
  { key: 'ROBOT_ENERGY_COST_PLAY', classification: 'public', description: 'Energy cost for playing with a Robot or starting a mini-game' },
  { key: 'ROBOT_ENERGY_COST_REST', classification: 'public', description: 'Energy cost for changing Robot rest state' },
  { key: 'ROBOT_ENERGY_COST_ADVENTURE', classification: 'public', description: 'Energy cost for sending a Robot on an adventure' },
  { key: 'ROBOT_ENERGY_COST_CLEAN', classification: 'public', description: 'Energy cost for cleaning a Robot' },
  { key: 'ROBOT_ENERGY_COST_VITAMIN', classification: 'public', description: 'Energy cost for giving a Robot a vitamin' },
  { key: 'ROBOT_ENERGY_COST_SCOLD', classification: 'public', description: 'Energy cost for scolding a Robot' },
  { key: 'ROBOT_ENERGY_COST_REVIVE', classification: 'public', description: 'Energy cost for reviving a Robot' },

  // Farcaster/Neynar
  { key: 'NEYNAR_API_KEY', classification: 'secret', description: 'Neynar API key' },
  { key: 'NEYNAR_CLIENT_ID', classification: 'public', description: 'Neynar client identifier' },
  { key: 'FARCASTER_SIGNER_UUID', classification: 'secret', description: 'Approved Farcaster signer UUID' },
  { key: 'SNAPCHAIN_API_URL', classification: 'public', description: 'Snapchain API endpoint' },
  { key: 'NEYNAR_WEBHOOK_URL', classification: 'public', description: 'Neynar webhook URL' },

  // Telegram
  { key: 'TELEGRAM_BOT_TOKEN', classification: 'secret', description: 'Telegram Bot API authentication token' },
  { key: 'TELEGRAM_BOT_USERNAME', classification: 'public', description: 'Telegram Bot username handle' },
  { key: 'TELEGRAM_MINIAPP_URL', classification: 'public', description: 'Telegram Mini App target URL' },
  { key: 'TELEGRAM_MINIAPP_DEEP_LINK', classification: 'public', description: 'Telegram Mini App deep link URL' },
  { key: 'TELEGRAM_WEBHOOK_SECRET', classification: 'secret', description: 'Secret token validating inbound Telegram webhooks' },
  { key: 'TELEGRAM_ISSUE_HISTORY', classification: 'public', description: 'Max buffered chat messages for issue drafting' },
  { key: 'TELEGRAM_MODERATION', classification: 'public', description: 'Enable Telegram gatekeeper/moderation' },
  { key: 'TELEGRAM_MODERATION_TIMEOUT', classification: 'public', description: 'Challenge verification window in seconds' },
  { key: 'TELEGRAM_DEPLOY_OWNER_ID', classification: 'public', description: 'Required owner user ID for privileged Telegram commands; never authorize via username' },
  { key: 'DEPLOY_NOTIFY_SECRET', classification: 'secret', description: 'Loopback deployment notification authentication secret' },

  // GitHub
  { key: 'GITHUB_TOKEN', classification: 'secret', description: 'GitHub Personal Access Token' },
  { key: 'GITHUB_REPO', classification: 'public', description: 'Target GitHub repository (owner/repo)' },
  { key: 'GITHUB_APP_ID', classification: 'public', description: 'TinyFrensAdmin GitHub App ID' },
  { key: 'GITHUB_APP_PRIVATE_KEY_PATH', classification: 'secret', description: 'Path to GitHub App private key PEM file' },
  { key: 'GITHUB_APP_INSTALLATION_ID', classification: 'public', description: 'GitHub App installation ID' },
  { key: 'GITHUB_ISSUE_LABELS', classification: 'public', description: 'Comma-separated labels added to created issues' },
  { key: 'GITHUB_WEBHOOK_SECRET', classification: 'secret', description: 'HMAC secret for inbound GitHub webhooks' },

  // Discord
  { key: 'DISCORD_CLIENT_ID', classification: 'public', description: 'Discord application client ID' },
  { key: 'DISCORD_CLIENT_SECRET', classification: 'secret', description: 'Discord application client secret' },
  { key: 'DISCORD_BOT_TOKEN', classification: 'secret', description: 'Discord Gateway and Bot API authentication token' },
  { key: 'DISCORD_UPDATES_CHANNEL_ID', classification: 'public', description: 'Discord channel for automatic GitHub event announcements' },
  { key: 'DISCORD_ALERT_USER_ID', classification: 'public', description: 'Discord user ID receiving operational failure DMs' },
  { key: 'DISCORD_REDIRECT_URI', classification: 'public', description: 'Discord OAuth redirect URI' },
  { key: 'DISCORD_PUBLIC_KEY', classification: 'secret', description: 'Discord Ed25519 interactions public key' },
  { key: 'DISCORD_MODERATION', classification: 'public', description: 'Enable Discord message moderation and filters' },

  // Push
  { key: 'VAPID_PUBLIC_KEY', classification: 'public', description: 'VAPID public key for Web Push' },
  { key: 'VAPID_PRIVATE_KEY', classification: 'secret', description: 'VAPID private key for Web Push signing' },
  { key: 'VAPID_SUBJECT', classification: 'public', description: 'VAPID mailto or URL subject' },

  // Admin
  { key: 'ADMIN_TOKEN', classification: 'secret', description: 'Shared secret bearer token for admin API' },
  { key: 'ADMIN_USERNAME', classification: 'public', description: 'Bootstrap admin username' },
  { key: 'ADMIN_PASSWORD', classification: 'secret', description: 'Bootstrap admin password' },

  // Documentation-only / indirect keys
  { key: 'TREASURY_PROXY', classification: 'documentation-only', description: 'Documented economy contract proxy' },
  { key: 'JACKPOT_VAULT_PROXY', classification: 'documentation-only', description: 'Documented economy jackpot vault' },
  { key: 'GAME_CONTROLLER', classification: 'documentation-only', description: 'Documented game controller address' },
  { key: 'SSH_ORIGINAL_COMMAND', classification: 'optional', description: 'Restricted web publisher SSH command' },
];

export const ConfigSchema = z.object({
  // Server/network
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(8080),
  DB_PATH: z.string().default('tinyfrens.db'),
  DB_READ_ONLY: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  PET_DOMAIN: z.string().optional(),
  ALLOWED_ORIGINS: z.string().default('https://tinyfrens.lol,https://www.tinyfrens.lol'),
  ALLOW_NATIVE_ORIGIN: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  LOG_LEVEL: z.string().default('info'),
  APP_REVISION: z.preprocess(
    value => value === '' ? undefined : value,
    z.string().regex(/^[0-9a-f]{40}$/).optional()
  ),

  // AI
  GEMINI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),

  // Bankr
  BANKR_API_KEY: z.string().optional(),
  BANKR_API_URL: z.string().default('https://api.bankr.bot'),
  BANKR_PARTNER_KEY: z.string().optional(),

  // Chain/NFT
  BASE_RPC_URL: z.string().optional(),
  CHAIN_ID: z.coerce.number().int().default(84532),
  TINYFRENS_NFT_ADDRESS: z.string().optional(),
  TINYFRENS_NFT_MINT_PRICE_WEI: z.string().default('1000000000000000'),
  ALLOW_TESTNET_FREE_MINT: z.enum(['true', 'false']).default('true').transform(v => v === 'true'),
  FREN_VAULT_SEED: z.string().default('tinyfrens-master-vault-seed-v1'),
  FRENS_PER_VAULT_MINT: z.string().default('47619047000000000000000000'),
  SAVE_CHANGES_FEE_FRENS: z.string().default('5000000000000000000000'),
  ROBOTS_RPC_URL: z.string().default('https://base-rpc.publicnode.com'),
  ROBINHOOD_RPC_URL: z.string().optional(),
  ROBINHOOD_BLOCKSCOUT_API_URL: z.string().optional(),

  // Economy/deposits
  ECONOMY_MODE: z.string().default('off'),
  ECONOMY_DEPOSITS: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  ECONOMY_INDEXER_SECRET: z.string().optional(),
  DEPOSIT_ROUTER_PROXY: z.string().optional(),
  DEPOSIT_SESSION_ADDRESSES: z.string().optional(),
  GAME_CONTROLLER_PRIVATE_KEY: z.string().optional(),
  INDEXER_ENABLED: z.string().default('auto'),
  INDEXER_LOOKBACK: z.coerce.number().int().default(300),
  INDEXER_POLL_SECONDS: z.coerce.number().int().default(6),
  TESTNET_ENERGY_MILLI_PER_FRENS: z.coerce.number().int().positive()
    .max(Math.floor(Number.MAX_SAFE_INTEGER / 100))
    .default(1000),

  // Treasury
  FRENS_TOKEN: z.string().optional(),
  FRENS_TREASURY: z.string().optional(),
  FRENS_TREASURY_INDEXER: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  FRENS_TREASURY_MAX_CREDITS: z.coerce.number().int().optional(),
  FRENS_TREASURY_CHAIN_ID: z.coerce.number().int().default(8453),
  FRENS_TREASURY_TOKEN: z.string().default('0x1A96226727a1D0a46334b3A4b3878B32B7659ba3'),

  // Robot care
  ROBOT_CARE_DAILY_ALLOWANCE: z.coerce.number().int().default(24),
  ROBOT_CARE_GAME_REWARD_CREDITS: z.coerce.number().int().default(0),
  ROBOT_CARE_PRICE_FEED: z.coerce.number().int().default(1000),
  ROBOT_CARE_PRICE_PLAY: z.coerce.number().int().default(1500),
  ROBOT_CARE_PRICE_REST: z.coerce.number().int().default(500),
  ROBOT_CARE_PRICE_ADVENTURE: z.coerce.number().int().default(1500),
  ROBOT_CARE_PRICE_CLEAN: z.coerce.number().int().default(500),
  ROBOT_CARE_PRICE_VITAMIN: z.coerce.number().int().default(5000),
  ROBOT_CARE_PRICE_SCOLD: z.coerce.number().int().default(250),
  ROBOT_CARE_PRICE_REVIVE: z.coerce.number().int().default(100000),

  // Account Energy
  ENERGY_POLICY_VERSION: z.coerce.number().int().positive().default(1),
  ENERGY_BASE_PER_DAY: z.coerce.number().int().nonnegative().default(18),
  ENERGY_PER_ROBOT_PER_DAY: z.coerce.number().int().nonnegative().default(6),
  ENERGY_CAPACITY_DAYS: z.coerce.number().int().positive().default(3),
  ROBOT_ENERGY_COST_FEED: z.coerce.number().int().positive().default(4),
  ROBOT_ENERGY_COST_PLAY: z.coerce.number().int().positive().default(5),
  ROBOT_ENERGY_COST_REST: z.coerce.number().int().positive().default(4),
  ROBOT_ENERGY_COST_ADVENTURE: z.coerce.number().int().positive().default(7),
  ROBOT_ENERGY_COST_CLEAN: z.coerce.number().int().positive().default(4),
  ROBOT_ENERGY_COST_VITAMIN: z.coerce.number().int().positive().default(6),
  ROBOT_ENERGY_COST_SCOLD: z.coerce.number().int().positive().default(4),
  ROBOT_ENERGY_COST_REVIVE: z.coerce.number().int().positive().default(7),

  // Farcaster/Neynar
  NEYNAR_API_KEY: z.string().optional(),
  NEYNAR_CLIENT_ID: z.string().optional(),
  FARCASTER_SIGNER_UUID: z.string().optional(),
  SNAPCHAIN_API_URL: z.string().default('https://snapchain-api.neynar.com'),
  NEYNAR_WEBHOOK_URL: z.string().optional(),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  TELEGRAM_MINIAPP_URL: z.string().default('https://tinyfrens.lol/web/'),
  TELEGRAM_MINIAPP_DEEP_LINK: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_ISSUE_HISTORY: z.coerce.number().int().default(25),
  TELEGRAM_MODERATION: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  TELEGRAM_MODERATION_TIMEOUT: z.coerce.number().int().default(180),
  TELEGRAM_DEPLOY_OWNER_ID: z.preprocess(
    value => value === '' ? undefined : value,
    z.string().regex(/^[1-9][0-9]*$/).optional()
  ),
  DEPLOY_NOTIFY_SECRET: z.string().optional(),

  // GitHub
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_REPO: z.string().default('dutchiono/TinyFrens'),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY_PATH: z.string().optional(),
  GITHUB_APP_INSTALLATION_ID: z.string().optional(),
  GITHUB_ISSUE_LABELS: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),

  // Discord
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_UPDATES_CHANNEL_ID: z.string().regex(/^\d{15,22}$/).optional().or(z.literal('')),
  DISCORD_ALERT_USER_ID: z.preprocess(
    value => value === '' ? undefined : value,
    z.string().regex(/^[1-9][0-9]*$/).optional()
  ),
  DISCORD_REDIRECT_URI: z.string().optional(),
  DISCORD_PUBLIC_KEY: z.string().optional(),
  DISCORD_MODERATION: z.enum(['true', 'false']).default('true').transform(value => value === 'true'),

  // Push
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),

  // Admin
  ADMIN_TOKEN: z.string().optional(),
  ADMIN_USERNAME: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),

  // Documentation-only / indirect
  TREASURY_PROXY: z.string().optional(),
  JACKPOT_VAULT_PROXY: z.string().optional(),
  GAME_CONTROLLER: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return ConfigSchema.parse(env);
}

export function getAllowedOrigins(config: Config): Set<string> {
  const list = config.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
  const set = new Set(list);
  if (config.ALLOW_NATIVE_ORIGIN) {
    set.add('null');
  }
  return set;
}
