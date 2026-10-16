import { DatabaseConnection } from '../connection.js';

export interface AccountProfileRow {
  account: string;
  display_name: string;
  x_handle: string;
  updated: number;
}

export interface AccountIdentityRow {
  account: string;
  platform: string;
  subject: string;
  handle: string;
  display_name: string;
  verified: number;
  updated: number;
}

export class AccountRepository {
  constructor(private db: DatabaseConnection) {}

  getProfile(account: string): AccountProfileRow | undefined {
    return this.db.prepare<AccountProfileRow>(
      'SELECT account, display_name, x_handle, updated FROM account_profiles WHERE account=?'
    ).get(account);
  }

  upsertProfile(account: string, displayName: string, xHandle: string, updated: number): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO account_profiles(account, display_name, x_handle, updated) VALUES(?, ?, ?, ?)'
    ).run(account, displayName, xHandle, updated);
  }

  deleteProfile(account: string): void {
    this.db.prepare('DELETE FROM account_profiles WHERE account=?').run(account);
  }

  getIdentities(account: string): AccountIdentityRow[] {
    return this.db.prepare<AccountIdentityRow>(
      'SELECT account, platform, subject, handle, display_name, verified, updated FROM account_identities WHERE account=? ORDER BY platform, updated'
    ).all(account);
  }

  upsertIdentity(
    account: string,
    platform: string,
    subject: string,
    handle: string,
    displayName: string,
    verified: boolean,
    updated: number
  ): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO account_identities(account, platform, subject, handle, display_name, verified, updated) VALUES(?, ?, ?, ?, ?, ?, ?)'
    ).run(account, platform, subject, handle, displayName, verified ? 1 : 0, updated);
  }

  mergeAccounts(sourceAccount: string, targetAccount: string, nowSeconds: number): void {
    if (sourceAccount === targetAccount) {
      return;
    }

    this.db.transaction(() => {
      const sourceProfile = this.getProfile(sourceAccount);
      const targetProfile = this.getProfile(targetAccount);

      if (targetProfile) {
        const display = (sourceProfile?.display_name || '') || targetProfile.display_name;
        const xHandle = (sourceProfile?.x_handle || '') || targetProfile.x_handle;
        this.upsertProfile(sourceAccount, display, xHandle, nowSeconds);
      }

      this.db.prepare('UPDATE account_identities SET account=? WHERE account=?').run(
        sourceAccount,
        targetAccount
      );
      this.mergeEnergy(sourceAccount, targetAccount, nowSeconds);
      this.deleteProfile(targetAccount);
    })();
  }

  private mergeEnergy(sourceAccount: string, targetAccount: string, nowSeconds: number): void {
    const source = this.db.prepare<{
      rechargeable_milli: number;
      purchased_milli: number;
      rate_version: number;
    }>('SELECT rechargeable_milli, purchased_milli, rate_version FROM player_energy WHERE account=?')
      .get(sourceAccount);
    const target = this.db.prepare<{
      rechargeable_milli: number;
      purchased_milli: number;
    }>('SELECT rechargeable_milli, purchased_milli FROM player_energy WHERE account=?')
      .get(targetAccount);

    this.db.prepare('UPDATE energy_ledger SET account=? WHERE account=?').run(
      sourceAccount,
      targetAccount
    );
    if (!target) return;

    if (!source) {
      this.db.prepare('UPDATE player_energy SET account=?, updated_at=? WHERE account=?').run(
        sourceAccount,
        nowSeconds,
        targetAccount
      );
      return;
    }

    const rechargeable = Math.max(source.rechargeable_milli, target.rechargeable_milli);
    const purchased = source.purchased_milli + target.purchased_milli;
    if (!Number.isSafeInteger(purchased)) {
      throw new Error('Merged purchased Energy exceeds safe integer range');
    }

    this.db.prepare(
      'UPDATE player_energy SET rechargeable_milli=?, purchased_milli=?, updated_at=? WHERE account=?'
    ).run(rechargeable, purchased, nowSeconds, sourceAccount);
    this.db.prepare('DELETE FROM player_energy WHERE account=?').run(targetAccount);
    this.db.prepare(
      `INSERT INTO energy_ledger(
         account, rechargeable_delta_milli, purchased_delta_milli,
         rechargeable_balance_milli, purchased_balance_milli,
         reason, ref_type, ref_id, rate_version, created
       ) VALUES(?, ?, ?, ?, ?, 'account_merge', 'account', ?, ?, ?)`
    ).run(
      sourceAccount,
      rechargeable - source.rechargeable_milli,
      target.purchased_milli,
      rechargeable,
      purchased,
      targetAccount,
      source.rate_version,
      nowSeconds
    );
  }
}
