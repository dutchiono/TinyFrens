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
    ...overrides,
  };

  ctx.turtleOwnership = overrides?.turtleOwnership ?? new TurtleOwnership(db, config.ROBINHOOD_RPC_URL, () => ctx.now());
  ctx.robotsVerifier = overrides?.robotsVerifier ?? new DefaultRobotsVerifier(db);
  ctx.extraCompanionsVerifier = overrides?.extraCompanionsVerifier ?? new DefaultExtraCompanionsVerifier(db);

  return ctx;
}

