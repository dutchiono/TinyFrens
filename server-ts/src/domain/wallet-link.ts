import crypto from 'node:crypto';
import { AppContext } from '../context.js';
import { tokenPet } from './account.js';
import { toChecksumAddress, recoverPersonalSigner } from '../crypto/signatures.js';
import {
  HOOD_TURTLE_COLLECTION,
  HOOD_TURTLE_CHAIN_ID,
  PAIRING_TTL,
  turtleId,
} from './turtle-ownership.js';
import { verifyHandle } from '../integrations/bankr.js';
import { TurtlePairingRow } from '../db/repositories/device-sync.js';

export function linkedWallets(context: AppContext, pid: string): string[] {
  return context.repos.wallets.getLinkedWallets(pid);
}

export function walletDevices(context: AppContext, pid: string): string[] {
  const hasMembersTable = context.db
    .prepare<{ 1: number }>("SELECT 1 FROM sqlite_master WHERE name='device_sync_members'")
    .get();
  if (!hasMembersTable) return [pid];

  const account = context.repos.deviceSync.getAccountForDevice(pid);
  if (!account) return [pid];
  const devices = context.repos.deviceSync.getDevicesForAccount(account);
  return devices.length > 0 ? devices : [pid];
}

export function addWallet(context: AppContext, pid: string, address: string): void {
  const addresses = linkedWallets(context, pid);
  if (!addresses.some(a => a.toLowerCase() === address.toLowerCase()) && addresses.length >= 10) {
    throw new Error('Up to 10 wallets can be linked. Remove one first.');
  }

  const checksum = toChecksumAddress(address);
  const now = Math.floor(context.now());
  const devices = walletDevices(context, pid);

  context.db.transaction(() => {
    for (const device of devices) {
      context.repos.wallets.linkWallet(device, checksum, now);
    }
  })();
}

export function removeWallet(context: AppContext, pid: string, address?: string | null): void {
  const devices = walletDevices(context, pid);
  const hasPairings = Boolean(
    context.db.prepare<{ 1: number }>("SELECT 1 FROM sqlite_master WHERE name='turtle_pairings'").get()
  );
  const hasChallenges = Boolean(
    context.db.prepare<{ 1: number }>("SELECT 1 FROM sqlite_master WHERE name='wallet_link_challenges'").get()
  );
  const hasCodes = Boolean(
    context.db.prepare<{ 1: number }>("SELECT 1 FROM sqlite_master WHERE name='device_sync_codes'").get()
  );

  context.db.transaction(() => {
    for (const device of devices) {
      if (!address) {
        context.repos.wallets.unlinkAllWallets(device);
      } else {
        context.repos.wallets.unlinkWallet(device, toChecksumAddress(address));
      }
      if (hasPairings) {
        context.repos.deviceSync.deleteTurtlePairingForPet(device);
      }
      if (hasChallenges) {
        context.repos.wallets.deleteChallenge(device);
      }
      if (hasCodes) {
        context.repos.deviceSync.deleteCodesForDevice(device);
      }
    }
  })();
}

function getValidPairing(context: AppContext, rawCode: unknown): { code: string; row: TurtlePairingRow } {
  const code = String(rawCode ?? '').replace(/[- ]/g, '').toUpperCase();
  const row = context.repos.deviceSync.getTurtlePairing(code);
  if (!row || row.expires <= context.now()) {
    throw new Error('Pairing expired or not found. Start again on your phone.');
  }
  return { code, row };
}

export function startTurtlePairing(
  context: AppContext,
  token: unknown,
  renew = false
): { code: string; expires: number } {
  const pid = tokenPet(context, token);
  const now = context.now();

  const existing = context.repos.deviceSync.getActiveTurtlePairingForPet(pid, now);
  if (existing && !renew) {
    return existing;
  }

  context.rateLimiter.limit(`turtle-pair-start:${pid}`, 10, 3600, now);

  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  while (true) {
    let candidate = '';
    for (let i = 0; i < 12; i++) {
      candidate += alphabet[Math.floor(context.random() * alphabet.length)];
    }
    if (!context.repos.deviceSync.getTurtlePairing(candidate)) {
      code = candidate;
      break;
    }
  }

  const expires = now + PAIRING_TTL;
  context.repos.deviceSync.createTurtlePairing(code, pid, expires, now);
  return { code, expires };
}

export async function challengeTurtlePairing(
  context: AppContext,
  body: Record<string, unknown>
): Promise<{ challengeId: string; message: string; expires: number }> {
  let { code, row } = getValidPairing(context, body.code);
  if (row.verified || row.challenge_id) {
    throw new Error('Pairing already has a wallet request. Start again on your phone.');
  }

  const addressStr = String(body.address ?? '');
  if (!/^0x[0-9a-fA-F]{40}$/.test(addressStr)) {
    throw new Error('Valid Ethereum wallet address required');
  }
  const address = toChecksumAddress(addressStr);

  const tid = body.tokenId !== undefined && body.tokenId !== null ? turtleId(body.tokenId) : null;
  const challengeId = crypto.randomBytes(24).toString('base64url');
  const scope = tid !== null ? String(tid) : 'All supported collections';

  let handle = String(body.xHandle ?? '').trim();
  if (handle.startsWith('@')) handle = handle.slice(1);

  if (handle) {
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
      throw new Error('Invalid X handle');
    }
    await verifyHandle(handle, address, context.config.BANKR_API_URL);

    const fresh = getValidPairing(context, body.code);
    code = fresh.code;
    row = fresh.row;
    if (row.verified || row.challenge_id) {
      throw new Error('Pairing already has a wallet request. Start again on your phone.');
    }
  }

  const social = handle ? `X handle: @${handle} (Bankr verified)\n` : '';
  const message =
    `TinyFrens read-only phone pairing\n` +
    `Domain: tinyfrens.lol\n` +
    `Wallet: ${address}\n` +
    `Collection: ${HOOD_TURTLE_COLLECTION}\n` +
    `Chain ID: ${HOOD_TURTLE_CHAIN_ID}\n` +
    `${social}Token: ${scope}\n` +
    `Pairing: ${code}\n` +
    `Nonce: ${challengeId}\n` +
    `Expires: ${Math.floor(row.expires)}\n\n` +
    `Connect this wallet to the waiting TinyFrens device only after it accepts. ` +
    `This does not authorize transactions, transfers, approvals, or spending.`;

  context.repos.deviceSync.updateTurtlePairingChallenge(code, challengeId, address, tid, message);
  return { challengeId, message, expires: row.expires };
}

export async function confirmTurtlePairing(
  context: AppContext,
  body: Record<string, unknown>
): Promise<{ verified: boolean; wallet: string; tokenId: number | null; next: string }> {
  const { code, row } = getValidPairing(context, body.code);
  if (row.verified || !row.challenge_id || body.challengeId !== row.challenge_id) {
    throw new Error('Wallet request is missing or already used');
  }

  const signature = body.signature;
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new Error('Valid personal_sign signature required');
  }

  let signer: string;
  try {
    signer = await recoverPersonalSigner({
      message: row.message!,
      signature,
    });
  } catch {
    throw new Error('Signature could not be verified');
  }

  if (signer.toLowerCase() !== row.address!.toLowerCase()) {
    throw new Error('Signature does not match the selected wallet');
  }

  if (row.token_id !== null) {
    const data = await context.turtleOwnership.read(row.address!, row.token_id, true);
    if (!data.active) {
      throw new Error('This wallet does not currently own that Hood Turtle');
    }
  }

  const changed = context.repos.deviceSync.verifyTurtlePairing(code, row.challenge_id, context.now());
  if (!changed) {
    throw new Error('Pairing expired or already used');
  }

  return {
    verified: true,
    wallet: row.address!,
    tokenId: row.token_id,
    next: 'Return to the waiting phone and accept the wallet and turtle.',
  };
}

export function statusTurtlePairing(
  context: AppContext,
  body: Record<string, unknown>
): { verified: boolean; wallet: string | null; tokenId: number | null; expires: number } {
  const pid = tokenPet(context, body.token);
  const { row } = getValidPairing(context, body.code);
  if (row.pet_id !== pid) {
    throw new Error('Pairing belongs to a different device');
  }

  return {
    verified: Boolean(row.verified),
    wallet: row.verified ? row.address : null,
    tokenId: row.verified ? row.token_id : null,
    expires: row.expires,
  };
}

export function fromDeviceTurtlePairing(
  context: AppContext,
  body: Record<string, unknown>
): { verified: boolean; wallet: string } {
  const source = tokenPet(context, body.token);
  const { code, row } = getValidPairing(context, body.code);

  if (row.pet_id === source || row.verified || row.challenge_id) {
    throw new Error('Use a fresh code from the other device');
  }

  const addressStr = String(body.address ?? '');
  const linked = linkedWallets(context, source);
  if (!linked.some(a => a.toLowerCase() === addressStr.toLowerCase())) {
    throw new Error('This wallet is not linked to the approving device');
  }

  const checksum = toChecksumAddress(addressStr);
  context.repos.deviceSync.verifyTurtlePairingWithAddress(code, checksum);
  return { verified: true, wallet: checksum };
}

export function acceptTurtlePairing(
  context: AppContext,
  body: Record<string, unknown>
): { linked: boolean; address: string; addresses: string[]; tokenId: number | null } {
  const pid = tokenPet(context, body.token);
  const { code, row } = getValidPairing(context, body.code);

  if (row.pet_id !== pid || !row.verified || !row.address) {
    throw new Error('This device has no verified pairing to accept');
  }

  const address = row.address;
  const tokenId = row.token_id;

  context.db.transaction(() => {
    addWallet(context, pid, address);

    const socialMatch = (row.message ?? '').match(/^X handle: @([A-Za-z0-9_]{1,15}) \((Bankr verified|wallet assertion)\)$/m);
    if (socialMatch) {
      const handle = socialMatch[1];
      const source = socialMatch[2] === 'Bankr verified' ? 'bankr-verified' : 'wallet-signed';
      context.repos.wallets.upsertSocialProfile(address, handle, source, Math.floor(context.now()));
    }

    context.repos.deviceSync.deleteTurtlePairing(code);
    context.repos.wallets.deleteChallenge(pid);
  })();

  return {
    linked: true,
    address,
    addresses: linkedWallets(context, pid),
    tokenId,
  };
}

export function statusWalletLink(
  context: AppContext,
  token: unknown
): { linked: boolean; address: string | null; addresses: string[] } {
  const pid = tokenPet(context, token);
  const addresses = linkedWallets(context, pid);
  return {
    linked: addresses.length > 0,
    address: addresses[0] ?? null,
    addresses,
  };
}

export function challengeWalletLink(
  context: AppContext,
  token: unknown,
  addressRaw: unknown
): { message: string; expires: number } {
  const pid = tokenPet(context, token);
  const addressStr = String(addressRaw ?? '');
  if (!/^0x[0-9a-fA-F]{40}$/.test(addressStr)) {
    throw new Error('Valid Ethereum wallet address required');
  }
  const address = toChecksumAddress(addressStr);

  const issued = Math.floor(context.now());
  const expires = issued + 300;
  const nonce = crypto.randomBytes(16).toString('hex');

  const message =
    `TinyFrens read-only wallet link\n` +
    `Domain: tinyfrens.lol\n` +
    `Wallet: ${address}\n` +
    `Fren: ${pid}\n` +
    `Nonce: ${nonce}\n` +
    `Issued: ${issued}\n` +
    `Expires: ${expires}\n\n` +
    `This signature only links your public address for supported NFT discovery. ` +
    `It does not authorize transactions, transfers, approvals, or spending.`;

  context.repos.wallets.setChallenge(pid, address, message, expires);
  return { message, expires };
}

export async function confirmWalletLink(
  context: AppContext,
  token: unknown,
  signature: unknown
): Promise<{ linked: boolean; address: string; addresses: string[] }> {
  const pid = tokenPet(context, token);
  if (typeof signature !== 'string' || !/^0x[a-fA-F0-9]{130}$/.test(signature)) {
    throw new Error('Valid wallet signature required');
  }

  const row = context.repos.wallets.getChallenge(pid);
  if (!row || row.expires < context.now()) {
    throw new Error('Link request expired. Start again.');
  }

  let recovered: string;
  try {
    recovered = await recoverPersonalSigner({
      message: row.message,
      signature,
    });
  } catch {
    throw new Error('Signature could not be verified');
  }

  if (recovered.toLowerCase() !== row.address.toLowerCase()) {
    throw new Error('Signature does not match the selected wallet');
  }

  context.db.transaction(() => {
    addWallet(context, pid, row.address);
    context.repos.deviceSync.deleteTurtlePairingForPet(pid);
    context.repos.wallets.deleteChallenge(pid);
  })();

  return {
    linked: true,
    address: row.address,
    addresses: linkedWallets(context, pid),
  };
}

export function disconnectWalletLink(
  context: AppContext,
  token: unknown,
  address?: unknown
): { linked: boolean; addresses: string[] } {
  const pid = tokenPet(context, token);
  removeWallet(context, pid, address ? String(address) : null);
  const addresses = linkedWallets(context, pid);
  return {
    linked: addresses.length > 0,
    addresses,
  };
}
