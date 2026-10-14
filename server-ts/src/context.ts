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

import { Economy, AddressPool } from './domain/economy.js';
import { DepositRouterAllocator } from './integrations/deposit-allocator.js';

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
    depositAllocator: overrides?.depositAllocator,
    ...overrides,
  };

  ctx.turtleOwnership = overrides?.turtleOwnership ?? new TurtleOwnership(db, config.ROBINHOOD_RPC_URL, () => ctx.now());
  ctx.robotsVerifier = overrides?.robotsVerifier ?? new DefaultRobotsVerifier(db);
  ctx.extraCompanionsVerifier = overrides?.extraCompanionsVerifier ?? new DefaultExtraCompanionsVerifier(db);
  ctx.economy = overrides?.economy ?? new Economy(db, () => ctx.now(), 100);

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

