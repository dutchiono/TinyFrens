import { DatabaseConnection } from '../db/connection.js';
import { EnergyRepository, PlayerEnergyRow } from '../db/repositories/energy.js';

export const MILLI_ENERGY = 1_000;
const SECONDS_PER_DAY = 86_400;

export interface EnergyPolicy {
  version: number;
  accountBasePerDayMilli: number;
  perRobotPerDayMilli: number;
  capacityDays: number;
}

export const DEFAULT_ENERGY_POLICY: EnergyPolicy = {
  version: 1,
  accountBasePerDayMilli: 18 * MILLI_ENERGY,
  perRobotPerDayMilli: 6 * MILLI_ENERGY,
  capacityDays: 3,
};

export interface EnergyStatus {
  account: string;
  eligibleRobots: number;
  rechargeableMilli: number;
  purchasedMilli: number;
  totalMilli: number;
  ratePerDayMilli: number;
  capacityMilli: number;
  rateVersion: number;
  accruedThrough: number;
}

export class InsufficientEnergy extends Error {
  constructor(public readonly availableMilli: number, public readonly requiredMilli: number) {
    super(`Insufficient Energy: ${availableMilli} available, ${requiredMilli} required`);
    this.name = 'InsufficientEnergy';
  }
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function timestampSeconds(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Energy timestamp must be finite');
  return nonNegativeInteger(Math.floor(value), 'Energy timestamp');
}

function accountId(value: string): string {
  const account = value.trim();
  if (!account || account.length > 200) throw new Error('Energy account is invalid');
  return account;
}

function validatePolicy(policy: EnergyPolicy): EnergyPolicy {
  return {
    version: positiveInteger(policy.version, 'Energy policy version'),
    accountBasePerDayMilli: nonNegativeInteger(policy.accountBasePerDayMilli, 'Base Energy rate'),
    perRobotPerDayMilli: nonNegativeInteger(policy.perRobotPerDayMilli, 'Per-Robot Energy rate'),
    capacityDays: positiveInteger(policy.capacityDays, 'Energy capacity days'),
  };
}

export function energyEntitlement(
  eligibleRobots: number,
  rawPolicy: EnergyPolicy = DEFAULT_ENERGY_POLICY
): { ratePerDayMilli: number; capacityMilli: number } {
  const policy = validatePolicy(rawPolicy);
  const robots = nonNegativeInteger(eligibleRobots, 'Eligible Robot count');
  if (robots === 0) return { ratePerDayMilli: 0, capacityMilli: 0 };

  const ratePerDayMilli = policy.accountBasePerDayMilli + policy.perRobotPerDayMilli * robots;
  const capacityMilli = ratePerDayMilli * policy.capacityDays;
  if (!Number.isSafeInteger(ratePerDayMilli) || !Number.isSafeInteger(capacityMilli)) {
    throw new Error('Energy entitlement exceeds safe integer range');
  }
  return { ratePerDayMilli, capacityMilli };
}

export class PlayerEnergy {
  private readonly repo: EnergyRepository;

  constructor(
    private readonly db: DatabaseConnection,
    private readonly now: () => number = () => Date.now() / 1000
  ) {
    this.repo = new EnergyRepository(db);
  }

  status(
    account: string,
    eligibleRobots: number,
    policy: EnergyPolicy = DEFAULT_ENERGY_POLICY,
    timestamp = this.now()
  ): EnergyStatus {
    const id = accountId(account);
    const at = timestampSeconds(timestamp);
    const checkedPolicy = validatePolicy(policy);
    const entitlement = energyEntitlement(eligibleRobots, checkedPolicy);

    return this.db.transaction(() => {
      const row = this.repo.get(id) ?? this.repo.create(id, at, checkedPolicy.version);
      this.accrue(row, at);
      row.rate_per_day_milli = entitlement.ratePerDayMilli;
      row.capacity_milli = entitlement.capacityMilli;
      row.rate_version = checkedPolicy.version;
      row.updated_at = at;
      this.repo.save(row);
      return this.toStatus(row, eligibleRobots);
    })();
  }

  spend(
    account: string,
    eligibleRobots: number,
    amountMilli: number,
    reason: string,
    refType: string | null = null,
    refId: string | null = null,
    policy: EnergyPolicy = DEFAULT_ENERGY_POLICY,
    timestamp = this.now()
  ): EnergyStatus {
    const id = accountId(account);
    const amount = positiveInteger(amountMilli, 'Energy spend');
    return this.db.transaction(() => {
      this.status(id, eligibleRobots, policy, timestamp);
      const row = this.repo.get(id)!;
      const available = row.rechargeable_milli + row.purchased_milli;
      if (available < amount) throw new InsufficientEnergy(available, amount);

      const rechargeableSpent = Math.min(row.rechargeable_milli, amount);
      const purchasedSpent = amount - rechargeableSpent;
      row.rechargeable_milli -= rechargeableSpent;
      row.purchased_milli -= purchasedSpent;
      row.updated_at = timestampSeconds(timestamp);
      this.repo.save(row);
      this.repo.appendLedger(
        row,
        -rechargeableSpent,
        -purchasedSpent,
        reason,
        refType,
        refId,
        row.updated_at
      );
      return this.toStatus(row, eligibleRobots);
    })();
  }

  grantPurchased(
    account: string,
    amountMilli: number,
    reason: string,
    refType: string | null = null,
    refId: string | null = null,
    timestamp = this.now()
  ): void {
    const id = accountId(account);
    const amount = positiveInteger(amountMilli, 'Purchased Energy grant');
    const at = timestampSeconds(timestamp);
    this.db.transaction(() => {
      const row = this.repo.get(id) ?? this.repo.create(id, at, DEFAULT_ENERGY_POLICY.version);
      const next = row.purchased_milli + amount;
      if (!Number.isSafeInteger(next)) throw new Error('Purchased Energy exceeds safe integer range');
      row.purchased_milli = next;
      row.updated_at = at;
      this.repo.save(row);
      this.repo.appendLedger(row, 0, amount, reason, refType, refId, at);
    })();
  }

  history(account: string, limit?: number) {
    return this.repo.history(account, limit);
  }

  private accrue(row: PlayerEnergyRow, timestamp: number): void {
    const elapsed = Math.max(0, timestamp - row.accrued_through);
    if (elapsed === 0) return;

    const numerator = BigInt(elapsed) * BigInt(row.rate_per_day_milli) + BigInt(row.accrual_remainder);
    const generated = numerator / BigInt(SECONDS_PER_DAY);
    const remainder = Number(numerator % BigInt(SECONDS_PER_DAY));
    const headroom = Math.max(0, row.capacity_milli - row.rechargeable_milli);
    const granted = Number(generated < BigInt(headroom) ? generated : BigInt(headroom));

    row.rechargeable_milli += granted;
    row.accrued_through = timestamp;
    row.accrual_remainder = BigInt(granted) < generated || headroom === 0 ? 0 : remainder;
    row.updated_at = timestamp;
    this.repo.save(row);
    if (granted > 0) {
      this.repo.appendLedger(row, granted, 0, 'recharge', null, null, timestamp);
    }
  }

  private toStatus(row: PlayerEnergyRow, eligibleRobots: number): EnergyStatus {
    return {
      account: row.account,
      eligibleRobots,
      rechargeableMilli: row.rechargeable_milli,
      purchasedMilli: row.purchased_milli,
      totalMilli: row.rechargeable_milli + row.purchased_milli,
      ratePerDayMilli: row.rate_per_day_milli,
      capacityMilli: row.capacity_milli,
      rateVersion: row.rate_version,
      accruedThrough: row.accrued_through,
    };
  }
}
