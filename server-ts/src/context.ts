import { Config } from './config.js';
import { DatabaseConnection } from './db/connection.js';

export interface AppContext {
  config: Config;
  db: DatabaseConnection;
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
  return {
    config,
    db,
    now,
    random: overrides?.random ?? Math.random,
    startTime: overrides?.startTime ?? now(),
    ...overrides,
  };
}
