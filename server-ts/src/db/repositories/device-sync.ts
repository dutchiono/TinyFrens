import crypto from 'node:crypto';
import { DatabaseConnection } from '../connection.js';

export interface DeviceSyncAccountRow {
  account: string;
  revision: number;
  selection: string;
  telegram_selection: string;
}

export interface DeviceSyncCodeRow {
  code: string;
  device: string;
  expires: number;
  requester: string | null;
  request_id: string | null;
  label: string | null;
}

export interface TurtlePairingRow {
  code: string;
  pet_id: string;
  expires: number;
  challenge_id: string | null;
  address: string | null;
  token_id: number | null;
  message: string | null;
  verified: number;
}

export class DeviceSyncRepository {
  constructor(private db: DatabaseConnection) {}

  // Account & Device membership
  getAccountForDevice(deviceId: string): string | undefined {
    const row = this.db.prepare<{ account: string }>(
      'SELECT account FROM device_sync_members WHERE device=?'
    ).get(deviceId);
    return row?.account;
  }

  getDevicesForAccount(account: string): string[] {
    const rows = this.db.prepare<{ device: string }>(
      'SELECT device FROM device_sync_members WHERE account=?'
    ).all(account);
    return rows.map(r => r.device);
  }

  ensureAccount(deviceId: string): string {
    const existing = this.getAccountForDevice(deviceId);
    if (existing) {
      return existing;
    }

    const newAccountId = crypto.randomBytes(18).toString('base64url');
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO device_sync_members(device, account) VALUES(?, ?)').run(
        deviceId,
        newAccountId
      );
      this.db.prepare(
        'INSERT INTO device_sync_accounts(account, revision, selection, telegram_selection) VALUES(?, 0, ?, ?)'
      ).run(newAccountId, '[]', '[]');
    })();
    return newAccountId;
  }

  getAccountState(account: string): DeviceSyncAccountRow | undefined {
    return this.db.prepare<DeviceSyncAccountRow>(
      'SELECT account, revision, selection, telegram_selection FROM device_sync_accounts WHERE account=?'
    ).get(account);
  }

  updateAccountSelection(
    account: string,
    selectionJson: string,
    expectedRevision: number
  ): boolean {
    return this.updateAccountSelections(account, selectionJson, null, expectedRevision);
  }

  updateAccountSelections(
    account: string,
    selectionJson: string | null,
    telegramSelectionJson: string | null,
    expectedRevision: number
  ): boolean {
    const result = this.db.prepare(
      `UPDATE device_sync_accounts
       SET selection=COALESCE(?, selection), telegram_selection=COALESCE(?, telegram_selection), revision=revision+1
       WHERE account=? AND revision=?`
    ).run(selectionJson, telegramSelectionJson, account, expectedRevision);
    return result.changes > 0;
  }

  transferDeviceMemberships(sourceAccount: string, targetAccount: string): void {
    this.db.prepare('UPDATE device_sync_members SET account=? WHERE account=?').run(
      sourceAccount,
      targetAccount
    );
  }

  deleteAccount(account: string): void {
    this.db.prepare('DELETE FROM device_sync_accounts WHERE account=?').run(account);
  }

  // Device Sync Codes
  getActiveCodeForDevice(deviceId: string, nowSeconds: number): { code: string; expires: number } | undefined {
    return this.db.prepare<{ code: string; expires: number }>(
      'SELECT code, expires FROM device_sync_codes WHERE device=? AND expires>?'
    ).get(deviceId, nowSeconds);
  }

  createSyncCode(code: string, deviceId: string, expires: number, nowSeconds: number): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM device_sync_codes WHERE device=? OR expires<=?').run(
        deviceId,
        nowSeconds
      );
      this.db.prepare(
        'INSERT INTO device_sync_codes(code, device, expires) VALUES(?, ?, ?)'
      ).run(code, deviceId, expires);
    })();
  }

  getSyncCode(code: string): DeviceSyncCodeRow | undefined {
    const cleanCode = code.replace(/[- ]/g, '').toUpperCase();
    return this.db.prepare<DeviceSyncCodeRow>(
      'SELECT code, device, expires, requester, request_id, label FROM device_sync_codes WHERE code=?'
    ).get(cleanCode);
  }

  attachSyncRequest(
    code: string,
    requesterDeviceId: string,
    requestId: string,
    label: string
  ): boolean {
    const cleanCode = code.replace(/[- ]/g, '').toUpperCase();
    const result = this.db.prepare(
      'UPDATE device_sync_codes SET requester=?, request_id=?, label=? WHERE code=?'
    ).run(requesterDeviceId, requestId, label.slice(0, 40), cleanCode);
    return result.changes > 0;
  }

  deleteSyncCodesForDevice(deviceId: string): void {
    this.db.prepare('DELETE FROM device_sync_codes WHERE device=? OR requester=?').run(
      deviceId,
      deviceId
    );
  }

  // Turtle Pairings
  getTurtlePairing(code: string): TurtlePairingRow | undefined {
    const cleanCode = code.replace(/[- ]/g, '').toUpperCase();
    return this.db.prepare<TurtlePairingRow>(
      'SELECT code, pet_id, expires, challenge_id, address, token_id, message, verified FROM turtle_pairings WHERE code=?'
    ).get(cleanCode);
  }

  getActiveTurtlePairingForPet(petId: string, nowSeconds: number): { code: string; expires: number } | undefined {
    return this.db.prepare<{ code: string; expires: number }>(
      'SELECT code, expires FROM turtle_pairings WHERE pet_id=? AND expires>?'
    ).get(petId, nowSeconds);
  }

  createTurtlePairing(code: string, petId: string, expires: number, nowSeconds: number): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM turtle_pairings WHERE expires<=? OR pet_id=?').run(nowSeconds, petId);
      this.db.prepare(
        'INSERT INTO turtle_pairings(code, pet_id, expires) VALUES(?, ?, ?)'
      ).run(code, petId, expires);
    })();
  }

  updateTurtlePairingChallenge(
    code: string,
    challengeId: string,
    address: string,
    tokenId: number | null,
    message: string
  ): boolean {
    const cleanCode = code.replace(/[- ]/g, '').toUpperCase();
    const result = this.db.prepare(
      'UPDATE turtle_pairings SET challenge_id=?, address=?, token_id=?, message=? WHERE code=?'
    ).run(challengeId, address, tokenId, message, cleanCode);
    return result.changes > 0;
  }

  verifyTurtlePairing(code: string, challengeId: string, nowSeconds?: number): boolean {
    const cleanCode = code.replace(/[- ]/g, '').toUpperCase();
    if (nowSeconds !== undefined) {
      const result = this.db.prepare(
        'UPDATE turtle_pairings SET verified=1 WHERE code=? AND challenge_id=? AND verified=0 AND expires>?'
      ).run(cleanCode, challengeId, nowSeconds);
      return result.changes > 0;
    }
    const result = this.db.prepare(
      'UPDATE turtle_pairings SET verified=1 WHERE code=? AND challenge_id=?'
    ).run(cleanCode, challengeId);
    return result.changes > 0;
  }

  verifyTurtlePairingWithAddress(code: string, address: string): boolean {
    const cleanCode = code.replace(/[- ]/g, '').toUpperCase();
    const result = this.db.prepare(
      'UPDATE turtle_pairings SET address=?, verified=1 WHERE code=?'
    ).run(address, cleanCode);
    return result.changes > 0;
  }

  deleteTurtlePairing(code: string): void {
    const cleanCode = code.replace(/[- ]/g, '').toUpperCase();
    this.db.prepare('DELETE FROM turtle_pairings WHERE code=?').run(cleanCode);
  }

  deleteTurtlePairingForPet(petId: string): void {
    this.db.prepare('DELETE FROM turtle_pairings WHERE pet_id=?').run(petId);
  }

  deleteCodesForDevice(deviceId: string): void {
    this.db.prepare('DELETE FROM device_sync_codes WHERE device=? OR requester=?').run(
      deviceId,
      deviceId
    );
  }
}
