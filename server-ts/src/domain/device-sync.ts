import crypto from 'node:crypto';
import { AppContext } from '../context.js';
import { normalizeCode, PAIRING_ALPHABET } from './codes.js';
import { validateCompanionSelection, validateTelegramSelection } from './device-selection.js';

export interface DeviceSyncSnapshot {
  account: string;
  revision: number;
  selection: unknown[];
  telegramSelection: unknown[];
  devices: number;
  addresses: string[];
}

export function getDeviceSyncSnapshot(context: AppContext, pid: string): DeviceSyncSnapshot {
  const aid = context.repos.deviceSync.ensureAccount(pid);
  const accountState = context.repos.deviceSync.getAccountState(aid);
  const revision = accountState?.revision ?? 0;
  const selection = accountState ? JSON.parse(accountState.selection) : [];
  const telegramSelection = accountState ? JSON.parse(accountState.telegram_selection) : [];
  const devices = context.repos.deviceSync.getDevicesForAccount(aid);
  const addresses = context.repos.wallets.getAccountWallets(aid);

  return {
    account: aid,
    revision,
    selection,
    telegramSelection,
    devices: devices.length,
    addresses,
  };
}

export function startDeviceSync(
  context: AppContext,
  pid: string,
  renew = false
): { code: string; expires: number } {
  context.repos.deviceSync.ensureAccount(pid);
  const now = context.now();

  const existing = context.repos.deviceSync.getActiveCodeForDevice(pid, now);
  if (existing && !renew) {
    return { code: existing.code, expires: existing.expires };
  }

  const code = Array.from(
    { length: 12 },
    () => PAIRING_ALPHABET[crypto.randomInt(0, PAIRING_ALPHABET.length)]
  ).join('');
  const expires = now + 600;

  context.repos.deviceSync.createSyncCode(code, pid, expires, now);
  return { code, expires };
}

export function requestSync(
  context: AppContext,
  pid: string,
  rawCode: unknown,
  label = 'TinyFrens device'
): { waiting: boolean; requestId: string } {
  const code = normalizeCode(rawCode);
  const row = context.repos.deviceSync.getSyncCode(code);
  const now = context.now();

  if (!row || row.expires <= now) {
    throw new Error('Code expired or not found. Create a new code.');
  }

  const requesterAccount = context.repos.deviceSync.ensureAccount(pid);
  const targetAccount = context.repos.deviceSync.ensureAccount(row.device);

  if (requesterAccount === targetAccount) {
    throw new Error('This identity is already linked to that TinyFrens account');
  }

  if (row.requester) {
    throw new Error('This code already has a request. Create a new code.');
  }

  const rid = crypto.randomBytes(18).toString('base64url');
  context.repos.deviceSync.attachSyncRequest(code, pid, rid, label);

  return { waiting: true, requestId: rid };
}

export function getDeviceSyncStatus(
  context: AppContext,
  pid: string,
  rawCode: unknown
): { pending: boolean; requestId: string | null; label: string | null; expires: number } {
  const code = normalizeCode(rawCode);
  const row = context.repos.deviceSync.getSyncCode(code);
  const now = context.now();

  if (!row || row.expires <= now) {
    throw new Error('Code expired or not found. Create a new code.');
  }

  if (pid !== row.device && pid !== row.requester) {
    throw new Error('This request belongs to another device');
  }

  return {
    pending: Boolean(row.requester),
    requestId: row.request_id,
    label: row.label,
    expires: row.expires,
  };
}

export function acceptDeviceSync(
  context: AppContext,
  pid: string,
  rawCode: unknown,
  requestId: unknown
): DeviceSyncSnapshot {
  const code = normalizeCode(rawCode);
  const row = context.repos.deviceSync.getSyncCode(code);
  const now = context.now();

  if (!row || row.expires <= now) {
    throw new Error('Code expired or not found. Create a new code.');
  }

  if (row.device !== pid || !row.requester || row.request_id !== requestId) {
    throw new Error('This device has no matching request to approve');
  }

  const source = context.repos.deviceSync.ensureAccount(pid);
  const target = context.repos.deviceSync.ensureAccount(row.requester);
  const sourceDevices = context.repos.deviceSync.getDevicesForAccount(source);
  const targetDevices = context.repos.deviceSync.getDevicesForAccount(target);
  const members = Array.from(new Set([...sourceDevices, ...targetDevices]));
  const addresses = Array.from(new Set([
    ...context.repos.wallets.getAccountWallets(source),
    ...context.repos.wallets.getAccountWallets(target),
  ]));

  const uniqueAddressesLower = new Set(addresses.map(a => a.toLowerCase()));
  if (members.length > 20 || uniqueAddressesLower.size > 10) {
    throw new Error('Sync supports up to 20 devices and 10 wallets');
  }

  const linkedAt: Record<string, number> = {};
  for (const device of members) {
    const rows = context.db.prepare<{ address: string; created: number }>(
      'SELECT address, created FROM wallet_links WHERE pet_id=?'
    ).all(device);
    for (const r of rows) {
      const key = r.address.toLowerCase();
      if (linkedAt[key] === undefined || r.created < linkedAt[key]) {
        linkedAt[key] = r.created;
      }
    }
  }

  const fallback = Math.floor(now);

  context.db.transaction(() => {
    context.repos.accounts.mergeAccounts(source, target, fallback);
    context.db.prepare('UPDATE device_sync_members SET account=? WHERE account=?').run(source, target);
    context.db.prepare('DELETE FROM device_sync_accounts WHERE account=?').run(target);

    for (const device of members) {
      for (const address of addresses) {
        context.db.prepare('INSERT OR IGNORE INTO wallet_links VALUES(?, ?, ?)').run(
          device,
          address,
          linkedAt[address.toLowerCase()] ?? fallback
        );
      }
      context.db.prepare('DELETE FROM turtle_pairings WHERE pet_id=?').run(device);
      context.db.prepare('DELETE FROM wallet_link_challenges WHERE pet_id=?').run(device);
    }

    context.db.prepare('UPDATE device_sync_accounts SET revision=revision+1 WHERE account=?').run(source);
    context.db.prepare(
      'DELETE FROM device_sync_codes WHERE device IN (SELECT device FROM device_sync_members WHERE account=?)'
    ).run(source);
  })();

  return getDeviceSyncSnapshot(context, pid);
}

export function leaveDeviceSync(context: AppContext, pid: string): DeviceSyncSnapshot {
  const old = getDeviceSyncSnapshot(context, pid);

  context.db.transaction(() => {
    context.db.prepare('DELETE FROM device_sync_members WHERE device=?').run(pid);
    context.db.prepare('DELETE FROM device_sync_codes WHERE device=? OR requester=?').run(pid, pid);
  })();

  const aid = context.repos.deviceSync.ensureAccount(pid);

  context.db.transaction(() => {
    context.db.prepare(
      'UPDATE device_sync_accounts SET selection=?, telegram_selection=?, revision=1 WHERE account=?'
    ).run(JSON.stringify(old.selection), JSON.stringify(old.telegramSelection), aid);
  })();

  return getDeviceSyncSnapshot(context, pid);
}

export function updateDeviceSyncSelection(
  context: AppContext,
  pid: string,
  selectionInput: unknown,
  revisionInput: unknown
): { conflict: boolean; snapshot: DeviceSyncSnapshot } {
  return updateDeviceSyncSelections(context, pid, selectionInput, undefined, revisionInput);
}

export function updateDeviceSyncSelections(
  context: AppContext,
  pid: string,
  selectionInput: unknown | undefined,
  telegramSelectionInput: unknown | undefined,
  revisionInput: unknown
): { conflict: boolean; snapshot: DeviceSyncSnapshot } {
  const aid = context.repos.deviceSync.ensureAccount(pid);
  if (selectionInput === undefined && telegramSelectionInput === undefined) {
    throw new Error('No device sync settings supplied');
  }
  const selectionJson = selectionInput === undefined
    ? null
    : JSON.stringify(validateCompanionSelection(selectionInput));
  const telegramSelectionJson = telegramSelectionInput === undefined
    ? null
    : JSON.stringify(validateTelegramSelection(telegramSelectionInput));
  const changed = context.repos.deviceSync.updateAccountSelections(
    aid,
    selectionJson,
    telegramSelectionJson,
    Number(revisionInput)
  );

  const snapshot = getDeviceSyncSnapshot(context, pid);
  if (!changed) {
    return { conflict: true, snapshot };
  }
  return { conflict: false, snapshot };
}
