import { DatabaseConnection } from '../db/connection.js';
import {
  CareAction,
  CARE_ACTIONS,
  FREE_ACTIONS,
  DEFAULT_PRICES_FRENS,
  DEFAULT_DAILY_ALLOWANCE,
  DEFAULT_GAME_REWARD_CREDITS,
  isCareAction,
  utcDayKey,
} from './robot-care-rules.js';
import { Economy, InsufficientCredits } from './economy.js';

export class UnknownAction extends Error {
  constructor(action: string) {
    super(`Unknown care action: ${action}`);
    this.name = 'UnknownAction';
  }
}

export class NotLinked extends Error {
  constructor(message = 'Link your wallet first') {
    super(message);
    this.name = 'NotLinked';
  }
}

export interface RobotCareSettings {
  dailyAllowance?: number;
  prices?: Partial<Record<CareAction, number>>;
  gameRewardCredits?: number;
}

export interface AllowanceInfo {
  day: string;
  limit: number;
  used: number;
  remaining: number;
}

export interface RobotCareStatus {
  allowance: AllowanceInfo;
  prices: Record<CareAction, number>;
  actions: CareAction[];
  freeActions: string[];
  creditsPerFrens: number | null;
  balance: number | null;
}

export interface CareActionResult {
  allowed: boolean;
  free: boolean;
  charged: number;
  action: string;
  allowance: AllowanceInfo;
  priceFrens?: number;
  requiresPayment?: boolean;
  balance?: number;
  creditsPerFrens?: number;
  shortfall?: number;
}

export class RobotCare {
  private _allowance: number;
  private _prices: Record<CareAction, number>;
  private _settings?: () => RobotCareSettings | null | undefined;
  private _economy?: Economy | null;

  constructor(
    private db: DatabaseConnection,
    private now: () => number = () => Date.now() / 1000,
    allowance: number = DEFAULT_DAILY_ALLOWANCE,
    prices?: Partial<Record<CareAction, number>>,
    settings?: () => RobotCareSettings | null | undefined,
    economy?: Economy | null
  ) {
    this._allowance = Math.max(0, Math.floor(allowance));
    this._prices = { ...DEFAULT_PRICES_FRENS };
    if (prices) {
      for (const [action, p] of Object.entries(prices)) {
        if (isCareAction(action) && p !== undefined) {
          this._prices[action] = Math.max(0, Math.floor(p));
        }
      }
    }
    this._settings = settings;
    this._economy = economy;
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS robot_care_daily(pet_id TEXT NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL, PRIMARY KEY(pet_id, day));'
    );
  }

  private _policy(): [number, Record<CareAction, number>] {
    if (!this._settings) {
      return [this._allowance, { ...this._prices }];
    }
    const raw = this._settings() || {};
    let allowance = this._allowance;
    if (raw.dailyAllowance !== undefined && raw.dailyAllowance !== null) {
      const parsed = Number(raw.dailyAllowance);
      if (!Number.isNaN(parsed)) {
        allowance = Math.max(0, Math.floor(parsed));
      }
    }

    const prices: Record<CareAction, number> = { ...DEFAULT_PRICES_FRENS };
    if (raw.prices) {
      for (const [action, p] of Object.entries(raw.prices)) {
        if (isCareAction(action) && p !== undefined && p !== null) {
          const parsed = Number(p);
          if (!Number.isNaN(parsed)) {
            prices[action] = Math.max(0, Math.floor(parsed));
          }
        }
      }
    }
    return [allowance, prices];
  }

  private _used(petId: string, day: string): number {
    const row = this.db.prepare<{ used: number }>(
      'SELECT used FROM robot_care_daily WHERE pet_id=? AND day=?'
    ).get(petId, day);
    return row?.used ?? 0;
  }

  private _left(petId: string, allowance: number, ts?: number): AllowanceInfo {
    const day = utcDayKey(ts !== undefined && ts !== null ? ts : this.now());
    const used = this._used(petId, day);
    return {
      day,
      limit: allowance,
      used,
      remaining: Math.max(0, allowance - used),
    };
  }

  allowanceLeft(petId: string, ts?: number): AllowanceInfo {
    const [allowance] = this._policy();
    return this._left(petId, allowance, ts);
  }

  status(petId: string, ts?: number): RobotCareStatus {
    const [allowance, prices] = this._policy();
    const pricesResult: Record<CareAction, number> = {} as any;
    for (const a of CARE_ACTIONS) {
      pricesResult[a] = prices[a] ?? 0;
    }
    return {
      allowance: this._left(petId, allowance, ts),
      prices: pricesResult,
      actions: [...CARE_ACTIONS],
      freeActions: [...FREE_ACTIONS],
      creditsPerFrens: this._economy ? this._economy.creditsPerFrens : null,
      balance: this._economy ? this._economy.balance(petId) : null,
    };
  }

  consume(petId: string, action: string, ts?: number): CareActionResult {
    if (!isCareAction(action)) {
      throw new UnknownAction(action);
    }
    const [allowance, prices] = this._policy();
    const nowTs = ts !== undefined && ts !== null ? ts : this.now();
    const day = utcDayKey(nowTs);
    const used = this._used(petId, day);

    if (used < allowance) {
      this.db.prepare(
        `INSERT INTO robot_care_daily(pet_id, day, used, updated) VALUES(?, ?, ?, ?)
         ON CONFLICT(pet_id, day) DO UPDATE SET used=excluded.used, updated=excluded.updated`
      ).run(petId, day, used + 1, Math.floor(nowTs));

      return {
        allowed: true,
        free: true,
        charged: 0,
        action,
        allowance: this._left(petId, allowance, nowTs),
      };
    }

    const price = prices[action] ?? 0;
    if (!price) {
      return {
        allowed: true,
        free: true,
        charged: 0,
        action,
        allowance: this._left(petId, allowance, nowTs),
      };
    }

    return this._charge(petId, action, price, allowance, nowTs);
  }

  private _charge(
    petId: string,
    action: CareAction,
    price: number,
    allowance: number,
    ts: number
  ): CareActionResult {
    const result: CareActionResult = {
      allowed: false,
      free: false,
      charged: 0,
      action,
      priceFrens: price,
      allowance: this._left(petId, allowance, ts),
    };

    if (!this._economy) {
      result.requiresPayment = true;
      return result;
    }

    const perFrens = this._economy.creditsPerFrens;
    const credits = price * perFrens;

    try {
      this._economy.spend(petId, credits, 'care', 'care', action);
    } catch (err) {
      if (err instanceof InsufficientCredits) {
        const balance = this._economy.balance(petId);
        result.allowed = false;
        result.charged = 0;
        result.requiresPayment = true;
        result.balance = balance;
        result.creditsPerFrens = perFrens;
        result.shortfall = Math.max(0, credits - balance);
        return result;
      }
      throw err;
    }

    result.allowed = true;
    result.charged = credits;
    result.requiresPayment = false;
    result.balance = this._economy.balance(petId);
    result.creditsPerFrens = perFrens;
    return result;
  }
}
