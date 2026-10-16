import { Config } from './config.js';
import { DatabaseConnection } from './db/connection.js';
import { createRepositories, Repositories } from './db/repositories/index.js';
import { RateLimiter } from './rate-limit.js';
import { TurtleOwnership } from './domain/turtle-ownership.js';
import {
  RobotsVerifier,
  ExtraCompanionsVerifier,
  DefaultRobotsVerifier,
  DefaultExtraCompanionsVerifier,
} from './domain/companion-verifier.js';
import { Robots } from './domain/robots-verifier.js';
import { RobotCare, RobotCareSettings } from './domain/robot-care.js';
import { PlayerEnergy } from './domain/player-energy.js';

import { Economy, AddressPool } from './domain/economy.js';
import { DepositRouterAllocator } from './integrations/deposit-allocator.js';
import { Admin } from './domain/admin.js';
import { MarketQuote } from './domain/market-quote.js';
import { TelegramModeration } from './domain/telegram-moderation.js';
import { FetchTelegramBotApi, TelegramBotApi } from './integrations/telegram-api.js';
import type { RealtimeHub } from './domain/realtime.js';
import { GitHubAuth, GitHubTokenProvider } from './integrations/github-app.js';
import { OperationalAlertSink, TelegramOperationalAlerts } from './domain/operational-alerts.js';

export function getRobotCareSettings(config: Config): RobotCareSettings {
  return {
    dailyAllowance: config.ROBOT_CARE_DAILY_ALLOWANCE,
    gameRewardCredits: config.ROBOT_CARE_GAME_REWARD_CREDITS,
    prices: {
      feed: config.ROBOT_CARE_PRICE_FEED,
      play: config.ROBOT_CARE_PRICE_PLAY,
      rest: config.ROBOT_CARE_PRICE_REST,
      adventure: config.ROBOT_CARE_PRICE_ADVENTURE,
      clean: config.ROBOT_CARE_PRICE_CLEAN,
      vitamin: config.ROBOT_CARE_PRICE_VITAMIN,
      scold: config.ROBOT_CARE_PRICE_SCOLD,
      revive: config.ROBOT_CARE_PRICE_REVIVE,
    },
  };
}

export interface AppContext {
  config: Config;
  db: DatabaseConnection;
  repos: Repositories;
  rateLimiter: RateLimiter;
  now: () => number;
  random: () => number;
  startTime: number;
  turtleOwnership: TurtleOwnership;
  robotsVerifier: RobotsVerifier;
  extraCompanionsVerifier: ExtraCompanionsVerifier;
  economy: Economy;
  depositAllocator?: any;
  robotCare: RobotCare;
  playerEnergy: PlayerEnergy;
  robotCareSettings?: () => RobotCareSettings | null | undefined;
  admin: Admin;
  marketQuote: MarketQuote;
  telegramApi: TelegramBotApi;
  telegramModeration: TelegramModeration;
  githubAuth: GitHubTokenProvider;
  operationalAlerts: OperationalAlertSink;
  realtimeHub?: RealtimeHub;
}

export function createAppContext(
  config: Config,
  db: DatabaseConnection,
  overrides?: Partial<AppContext>
): AppContext {
  const now = overrides?.now ?? (() => Date.now() / 1000);
  const repos = overrides?.repos ?? createRepositories(db);
  const rateLimiter = overrides?.rateLimiter ?? new RateLimiter();

  const ctx: AppContext = {
    config,
    db,
    repos,
    rateLimiter,
    now,
    random: overrides?.random ?? Math.random,
    startTime: overrides?.startTime ?? now(),
    turtleOwnership: null as any,
    robotsVerifier: null as any,
    extraCompanionsVerifier: null as any,
    economy: null as any,
    robotCare: null as any,
    playerEnergy: null as any,
    admin: null as any,
    marketQuote: null as any,
    telegramApi: null as any,
    telegramModeration: null as any,
    githubAuth: null as any,
    operationalAlerts: null as any,
    depositAllocator: overrides?.depositAllocator,
    ...overrides,
  };

  ctx.turtleOwnership = overrides?.turtleOwnership ?? new TurtleOwnership(db, config.ROBINHOOD_RPC_URL, () => ctx.now());
  ctx.robotsVerifier = overrides?.robotsVerifier ?? new Robots(db, config.ROBOTS_RPC_URL, () => ctx.now());
  ctx.extraCompanionsVerifier = overrides?.extraCompanionsVerifier ?? new DefaultExtraCompanionsVerifier(
    db,
    config.ROBINHOOD_RPC_URL,
    config.ROBOTS_RPC_URL,
    () => ctx.now()
  );
  ctx.economy = overrides?.economy ?? new Economy(db, () => ctx.now(), 100);
  ctx.playerEnergy = overrides?.playerEnergy ?? new PlayerEnergy(db, () => ctx.now());
  const admin = overrides?.admin ?? new Admin(db, {
    token: config.ADMIN_TOKEN,
    now: () => ctx.now(),
    initialUser: config.ADMIN_USERNAME,
    initialPassword: config.ADMIN_PASSWORD,
    config,
  });
  ctx.admin = admin;
  ctx.marketQuote = overrides?.marketQuote ?? new MarketQuote(() => ctx.now());
  ctx.telegramApi = overrides?.telegramApi ?? new FetchTelegramBotApi();
  ctx.telegramModeration = overrides?.telegramModeration ?? new TelegramModeration(
    repos.telegram,
    ctx.telegramApi,
    {
      enabled: config.TELEGRAM_MODERATION,
      timeout: config.TELEGRAM_MODERATION_TIMEOUT,
      botUsername: config.TELEGRAM_BOT_USERNAME,
      token: config.TELEGRAM_BOT_TOKEN,
      now: () => ctx.now(),
    }
  );
  ctx.githubAuth = overrides?.githubAuth ?? new GitHubAuth(config, { now: () => ctx.now() });
  ctx.operationalAlerts = overrides?.operationalAlerts ?? new TelegramOperationalAlerts(
    config,
    () => ctx.telegramApi,
    () => ctx.now()
  );
  const careSettings = overrides?.robotCareSettings ?? (() => admin.effectiveSettings());
  ctx.robotCareSettings = careSettings;
  ctx.robotCare = overrides?.robotCare ?? new RobotCare(
    db,
    () => ctx.now(),
    config.ROBOT_CARE_DAILY_ALLOWANCE,
    undefined,
    careSettings,
    ctx.economy
  );

  if (overrides?.depositAllocator !== undefined) {
    ctx.depositAllocator = overrides.depositAllocator;
  } else if (config.DEPOSIT_ROUTER_PROXY && config.GAME_CONTROLLER_PRIVATE_KEY && config.BASE_RPC_URL) {
    try {
      ctx.depositAllocator = new DepositRouterAllocator(
        config.DEPOSIT_ROUTER_PROXY,
        config.GAME_CONTROLLER_PRIVATE_KEY,
        config.CHAIN_ID || 84532,
        config.BASE_RPC_URL,
        { token: config.FRENS_TOKEN }
      );
    } catch {
      ctx.depositAllocator = null;
    }
  } else if (config.DEPOSIT_SESSION_ADDRESSES) {
    const pool = config.DEPOSIT_SESSION_ADDRESSES.split(',').map(a => a.trim()).filter(Boolean);
    if (pool.length > 0) {
      ctx.depositAllocator = new AddressPool(db, pool);
    } else {
      ctx.depositAllocator = null;
    }
  } else {
    ctx.depositAllocator = null;
  }

  return ctx;
}

