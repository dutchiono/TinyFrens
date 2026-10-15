import crypto from 'node:crypto';
import { DatabaseConnection } from '../db/connection.js';
import { Config } from '../config.js';
import {
  CareAction,
  CARE_ACTIONS,
  DEFAULT_PRICES_FRENS,
  DEFAULT_DAILY_ALLOWANCE,
  DEFAULT_GAME_REWARD_CREDITS,
  isCareAction,
} from './robot-care-rules.js';

export class DisabledError extends Error {
  constructor(message = 'Admin is disabled') {
    super(message);
    this.name = 'DisabledError';
  }
}

export class UnauthorizedError extends Error {
  constructor(message = 'Missing bearer authorization') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class BadRequestError extends Error {
  constructor(message = 'Bad request') {
    super(message);
    this.name = 'BadRequestError';
  }
}

export const INT_KEYS = ['dailyAllowance', 'gameRewardCredits'] as const;
export const PRICE_KEYS = CARE_ACTIONS.map(action => `price_${action}` as const);
export const ALLOWED_KEYS = new Set<string>([...INT_KEYS, ...PRICE_KEYS]);
export const MAX_ALLOWANCE = 100_000;
export const MAX_GAME_REWARD = 10 ** 12;
export const MAX_PRICE = 10 ** 15;

export function hashPassword(password: string, salt: Buffer): string {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
}

export function verifyPassword(password: string, saltHex: string, hashHex: string): boolean {
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const computed = hashPassword(password, salt);
    const bufA = Buffer.from(computed, 'utf-8');
    const bufB = Buffer.from(hashHex, 'utf-8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function constantTimeEqual(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'utf-8');
    const bufB = Buffer.from(b, 'utf-8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function clampInt(value: unknown, low: number, high: number): number {
  if (typeof value === 'boolean') {
    throw new BadRequestError('Expected a whole number');
  }
  if (value === null || value === undefined) {
    throw new BadRequestError('Expected a whole number');
  }
  let num: number;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new BadRequestError('Expected a whole number');
    }
    num = Math.trunc(value);
  } else if (typeof value === 'string') {
    if (!/^-?\d+$/.test(value.trim())) {
      throw new BadRequestError('Expected a whole number');
    }
    num = parseInt(value.trim(), 10);
  } else {
    throw new BadRequestError('Expected a whole number');
  }
  if (num < low || num > high) {
    throw new BadRequestError('Value out of range');
  }
  return num;
}

export function overridesOnly(db: DatabaseConnection): Record<string, number> {
  const stored: Record<string, number> = {};
  const rows = db.prepare<{ key: string; value: string }>('SELECT key, value FROM app_settings').all();
  for (const row of rows) {
    if (!ALLOWED_KEYS.has(row.key)) continue;
    try {
      const parsed = JSON.parse(row.value);
      if (typeof parsed === 'boolean') continue;
      const num = Number(parsed);
      if (Number.isFinite(num)) {
        stored[row.key] = Math.trunc(num);
      }
    } catch {
      continue;
    }
  }
  return stored;
}

export function shapeOverrides(stored: Record<string, number>): Record<string, any> {
  const shaped: Record<string, any> = {};
  for (const key of INT_KEYS) {
    if (key in stored) {
      shaped[key] = stored[key];
    }
  }
  const prices: Partial<Record<CareAction, number>> = {};
  for (const action of CARE_ACTIONS) {
    const k = `price_${action}`;
    if (k in stored) {
      prices[action] = stored[k];
    }
  }
  if (Object.keys(prices).length > 0) {
    shaped.prices = prices;
  }
  return shaped;
}

export interface EffectiveSettingsResult {
  dailyAllowance: number;
  gameRewardCredits: number;
  prices: Record<CareAction, number>;
}

export function effectiveSettings(
  db: DatabaseConnection,
  config?: Partial<Config>
): EffectiveSettingsResult {
  const stored = overridesOnly(db);

  let allowance = stored.dailyAllowance;
  if (allowance === undefined) {
    allowance = config?.ROBOT_CARE_DAILY_ALLOWANCE ?? DEFAULT_DAILY_ALLOWANCE;
  }

  let reward = stored.gameRewardCredits;
  if (reward === undefined) {
    reward = config?.ROBOT_CARE_GAME_REWARD_CREDITS ?? DEFAULT_GAME_REWARD_CREDITS;
  }

  const prices: Record<CareAction, number> = {} as any;
  for (const action of CARE_ACTIONS) {
    const key = `price_${action}`;
    let val = stored[key];
    if (val === undefined) {
      const cfgKey = `ROBOT_CARE_PRICE_${action.toUpperCase()}` as keyof Config;
      const cfgVal = config?.[cfgKey];
      val = typeof cfgVal === 'number' ? cfgVal : DEFAULT_PRICES_FRENS[action];
    }
    prices[action] = Math.max(0, Math.trunc(val));
  }

  return {
    dailyAllowance: Math.max(0, Math.trunc(allowance)),
    gameRewardCredits: Math.max(0, Math.trunc(reward)),
    prices,
  };
}

export function careSettings(
  db: DatabaseConnection,
  config?: Partial<Config>
): () => EffectiveSettingsResult {
  return () => effectiveSettings(db, config);
}

export interface AdminOptions {
  token?: string | null;
  now?: () => number;
  initialUser?: string;
  initialPassword?: string;
  seedDefaultUser?: boolean;
  config?: Partial<Config>;
}

export class Admin {
  public readonly token: string | null;
  public readonly now: () => number;
  private config?: Partial<Config>;

  constructor(
    public readonly db: DatabaseConnection,
    options: AdminOptions = {}
  ) {
    this.token = options.token ? options.token.trim() || null : null;
    this.now = options.now ?? (() => Date.now() / 1000);
    this.config = options.config;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS admin_audit(id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, detail TEXT, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS admin_users(username TEXT PRIMARY KEY, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS admin_sessions(token TEXT PRIMARY KEY, username TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL);
    `);

    if (options.seedDefaultUser !== false) {
      this._ensureInitialUser(
        options.initialUser || this.config?.ADMIN_USERNAME || 'dutch',
        options.initialPassword || this.config?.ADMIN_PASSWORD || 'nottodayjunior'
      );
    }
  }

  private _ensureInitialUser(username: string, password: string): void {
    const row = this.db.prepare<{ count: number }>('SELECT COUNT(*) as count FROM admin_users').get();
    if (!row || row.count === 0) {
      this.createUser(username, password);
    }
  }

  get enabled(): boolean {
    if (Boolean(this.token)) return true;
    const row = this.db.prepare<{ count: number }>('SELECT COUNT(*) as count FROM admin_users').get();
    return Boolean(row && row.count > 0);
  }

  createUser(username: string, password: string): string {
    const userClean = String(username || '').trim().toLowerCase();
    if (!userClean || userClean.length < 3) {
      throw new BadRequestError('Username must be at least 3 characters');
    }
    if (!password || String(password).length < 6) {
      throw new BadRequestError('Password must be at least 6 characters');
    }
    const salt = crypto.randomBytes(16);
    const pwHash = hashPassword(String(password), salt);
    const nowSec = Math.floor(this.now());
    this.db.prepare(
      'INSERT OR REPLACE INTO admin_users(username, salt, password_hash, created, updated) VALUES(?,?,?,?,?)'
    ).run(userClean, salt.toString('hex'), pwHash, nowSec, nowSec);
    this.audit('create_user', { username: userClean });
    return userClean;
  }

  listUsers(): { username: string; created: number }[] {
    return this.db.prepare<{ username: string; created: number }>(
      'SELECT username, created FROM admin_users ORDER BY username ASC'
    ).all();
  }

  authenticate(username: string, password: string): { token: string; username: string; expires: number } {
    const userClean = String(username || '').trim().toLowerCase();
    const row = this.db.prepare<{ username: string; salt: string; password_hash: string }>(
      'SELECT username, salt, password_hash FROM admin_users WHERE username=?'
    ).get(userClean);

    if (!row || !verifyPassword(String(password || ''), row.salt, row.password_hash)) {
      throw new UnauthorizedError('Invalid username or password');
    }

    const sessionToken = crypto.randomBytes(32).toString('base64url');
    const nowSec = Math.floor(this.now());
    const expires = nowSec + 7 * 86400;

    this.db.prepare(
      'INSERT INTO admin_sessions(token, username, created, expires) VALUES(?,?,?,?)'
    ).run(sessionToken, row.username, nowSec, expires);

    this.audit('login', { username: row.username });
    return { token: sessionToken, username: row.username, expires };
  }

  validateSession(tokenStr: string | null | undefined): string | null {
    if (!tokenStr) return null;
    const nowSec = Math.floor(this.now());
    const row = this.db.prepare<{ username: string; expires: number }>(
      'SELECT username, expires FROM admin_sessions WHERE token=?'
    ).get(tokenStr);
    if (!row) return null;
    if (row.expires < nowSec) {
      this.db.prepare('DELETE FROM admin_sessions WHERE token=?').run(tokenStr);
      return null;
    }
    return row.username;
  }

  logoutSession(tokenStr: string | null | undefined): boolean {
    if (!tokenStr) return false;
    const row = this.db.prepare<{ username: string }>(
      'SELECT username FROM admin_sessions WHERE token=?'
    ).get(tokenStr);
    if (row) {
      this.db.prepare('DELETE FROM admin_sessions WHERE token=?').run(tokenStr);
      this.audit('logout', { username: row.username });
      return true;
    }
    return false;
  }

  isValidToken(tokenStr: string | null | undefined): [boolean, string] {
    if (!tokenStr) return [false, ''];
    const user = this.validateSession(tokenStr);
    if (user) return [true, user];
    if (this.token && constantTimeEqual(tokenStr, this.token)) {
      return [true, 'system'];
    }
    return [false, ''];
  }

  audit(action: string, detail?: unknown): void {
    const nowSec = Math.floor(this.now());
    const detailStr = detail === undefined || detail === null ? null : JSON.stringify(detail);
    this.db.prepare(
      'INSERT INTO admin_audit(action, detail, created) VALUES(?,?,?)'
    ).run(action, detailStr, nowSec);
  }

  recentAudit(count: number = 20): { action: string; detail: unknown; created: number }[] {
    const limit = Math.max(1, Math.trunc(count));
    const rows = this.db.prepare<{ action: string; detail: string | null; created: number }>(
      'SELECT action, detail, created FROM admin_audit ORDER BY id DESC LIMIT ?'
    ).all(limit);

    return rows.map(r => {
      let detail: unknown = null;
      if (r.detail) {
        try {
          detail = JSON.parse(r.detail);
        } catch {
          detail = r.detail;
        }
      }
      return { action: r.action, detail, created: r.created };
    });
  }

  save(body: unknown): EffectiveSettingsResult {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestError('Expected an object');
    }
    const b = body as Record<string, unknown>;
    const keys = Object.keys(b);
    const validTopKeys = new Set(['dailyAllowance', 'gameRewardCredits', 'prices']);
    const unknown = keys.filter(k => !validTopKeys.has(k)).sort();
    if (unknown.length > 0) {
      throw new BadRequestError('Unknown setting(s): ' + unknown.join(', '));
    }

    const changed: Record<string, number> = {};
    if ('dailyAllowance' in b) {
      changed.dailyAllowance = clampInt(b.dailyAllowance, 0, MAX_ALLOWANCE);
    }
    if ('gameRewardCredits' in b) {
      changed.gameRewardCredits = clampInt(b.gameRewardCredits, 0, MAX_GAME_REWARD);
    }
    if ('prices' in b) {
      const prices = b.prices;
      if (!prices || typeof prices !== 'object' || Array.isArray(prices)) {
        throw new BadRequestError('prices must be an object');
      }
      for (const [action, value] of Object.entries(prices as Record<string, unknown>)) {
        if (!isCareAction(action)) {
          throw new BadRequestError('Unknown care action: ' + String(action));
        }
        changed[`price_${action}`] = clampInt(value, 0, MAX_PRICE);
      }
    }

    if (Object.keys(changed).length === 0) {
      throw new BadRequestError('No settings to update');
    }

    const ts = Math.floor(this.now());
    for (const [key, value] of Object.entries(changed)) {
      this.db.prepare(
        'INSERT INTO app_settings(key, value, updated) VALUES(?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated=excluded.updated'
      ).run(key, JSON.stringify(value), ts);
    }

    this.audit('settings', changed);
    return effectiveSettings(this.db, this.config);
  }

  effectiveSettings(): EffectiveSettingsResult {
    return effectiveSettings(this.db, this.config);
  }
}
