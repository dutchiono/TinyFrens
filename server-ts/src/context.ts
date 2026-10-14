import { Config } from './config.js';
import { DatabaseConnection } from './db/connection.js';
import { createRepositories, Repositories } from './db/repositories/index.js';
import { RateLimiter } from './rate-limit.js';

export interface AppContext {
  config: Config;
  db: DatabaseConnection;
  repos: Repositories;
  rateLimiter: RateLimiter;
  now: () => number;
  random: () => number;
  startTime: number;
}

export function createAppContext(
  config: Config,
  db: DatabaseConnection,
  overrides?: Partial<AppContext>
): AppContext {
  const now = overrides?.now ?? (() => Date.now() / 1000);
  const repos = overrides?.repos ?? createRepositories(db);
  const rateLimiter = overrides?.rateLimiter ?? new RateLimiter();
  return {
    config,
    db,
    repos,
    rateLimiter,
    now,
    random: overrides?.random ?? Math.random,
    startTime: overrides?.startTime ?? now(),
    ...overrides,
  };
}

