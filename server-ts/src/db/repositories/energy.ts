import { DatabaseConnection } from '../connection.js';

export interface PlayerEnergyRow {
  account: string;
  rechargeable_milli: number;
  purchased_milli: number;
  accrued_through: number;
  accrual_remainder: number;
  rate_per_day_milli: number;
  capacity_milli: number;
  rate_version: number;
  updated_at: number;
}

export interface EnergyLedgerRow {
  rechargeable_delta_milli: number;
  purchased_delta_milli: number;
  rechargeable_balance_milli: number;
  purchased_balance_milli: number;
  reason: string;
  ref_type: string | null;
  ref_id: string | null;
  rate_version: number;
  created: number;
}

export class EnergyRepository {
  constructor(private db: DatabaseConnection) {}

  get(account: string): PlayerEnergyRow | undefined {
    return this.db.prepare<PlayerEnergyRow>(
      `SELECT account, rechargeable_milli, purchased_milli, accrued_through,
              accrual_remainder, rate_per_day_milli, capacity_milli, rate_version, updated_at
       FROM player_energy WHERE account=?`
    ).get(account);
  }

  create(account: string, now: number, rateVersion: number): PlayerEnergyRow {
    this.db.prepare(
      `INSERT OR IGNORE INTO player_energy(
         account, rechargeable_milli, purchased_milli, accrued_through,
         accrual_remainder, rate_per_day_milli, capacity_milli, rate_version, updated_at
       ) VALUES(?, 0, 0, ?, 0, 0, 0, ?, ?)`
    ).run(account, now, rateVersion, now);
    return this.get(account)!;
  }

  save(row: PlayerEnergyRow): void {
    this.db.prepare(
      `UPDATE player_energy
       SET rechargeable_milli=?, purchased_milli=?, accrued_through=?, accrual_remainder=?,
           rate_per_day_milli=?, capacity_milli=?, rate_version=?, updated_at=?
       WHERE account=?`
    ).run(
      row.rechargeable_milli,
      row.purchased_milli,
      row.accrued_through,
      row.accrual_remainder,
      row.rate_per_day_milli,
      row.capacity_milli,
      row.rate_version,
      row.updated_at,
      row.account
    );
  }

  appendLedger(
    row: PlayerEnergyRow,
    rechargeableDeltaMilli: number,
    purchasedDeltaMilli: number,
    reason: string,
    refType: string | null,
    refId: string | null,
    created: number
  ): void {
    this.db.prepare(
      `INSERT INTO energy_ledger(
         account, rechargeable_delta_milli, purchased_delta_milli,
         rechargeable_balance_milli, purchased_balance_milli,
         reason, ref_type, ref_id, rate_version, created
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.account,
      rechargeableDeltaMilli,
      purchasedDeltaMilli,
      row.rechargeable_milli,
      row.purchased_milli,
      reason,
      refType,
      refId,
      row.rate_version,
      created
    );
  }

  history(account: string, limit = 100): EnergyLedgerRow[] {
    return this.db.prepare<EnergyLedgerRow>(
      `SELECT rechargeable_delta_milli, purchased_delta_milli,
              rechargeable_balance_milli, purchased_balance_milli,
              reason, ref_type, ref_id, rate_version, created
       FROM energy_ledger WHERE account=? ORDER BY id DESC LIMIT ?`
    ).all(account, Math.max(1, Math.min(500, Math.floor(limit))));
  }
}
