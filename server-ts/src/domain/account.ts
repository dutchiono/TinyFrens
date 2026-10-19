import crypto from 'node:crypto';
import { DatabaseConnection } from '../db/connection.js';
import { AppContext } from '../context.js';
import { userProfile } from '../integrations/telegram.js';

export class AccountLinkRequiredError extends Error {
  constructor(platform: 'Discord' | 'Telegram') {
    super(`${platform} is not linked to a TinyFrens account. Open TinyFrens Account, create a sync code, then use /link and approve the request.`);
    this.name = 'AccountLinkRequiredError';
  }
}

export function cleanName(value: unknown): string {
  const cleaned = String(value || '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned && (cleaned.length < 1 || cleaned.length > 32)) {
    throw new Error('Display name must be 1 to 32 characters');
  }
  return cleaned;
}

export function mintPet(
  db: DatabaseConnection,
  petProfile: unknown
): { id: string; token: string; code: string } {
  const pid = crypto.randomBytes(16).toString('hex');
  const token = crypto.randomBytes(32).toString('base64url');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  let code = '';
  while (true) {
    code = Array.from({ length: 8 }, () => alphabet[crypto.randomInt(0, alphabet.length)]).join('');
    const existing = db.prepare<{ id: string }>('SELECT id FROM pets WHERE code=?').get(code);
    if (!existing) {
      break;
    }
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('INSERT INTO pets(id, code, token, profile) VALUES(?, ?, ?, ?)').run(
    pid,
    code,
    tokenHash,
    JSON.stringify(petProfile)
  );

  return { id: pid, token, code };
}

export function reissueToken(
  db: DatabaseConnection,
  pid: string
): { token: string; code: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('UPDATE pets SET token=? WHERE id=?').run(tokenHash, pid);
  const row = db.prepare<{ code: string }>('SELECT code FROM pets WHERE id=?').get(pid);
  return { token, code: row?.code || '' };
}

export function tokenPet(
  contextOrDb: AppContext | DatabaseConnection,
  token: unknown
): string {
  if (typeof token !== 'string' || token.length > 200 || !token) {
    throw new Error('Device credential not recognized');
  }
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  if ('repos' in contextOrDb) {
    const pet = contextOrDb.repos.pets.findByToken(tokenHash);
    if (!pet) {
      throw new Error('Device credential not recognized');
    }
    return pet.id;
  }
  const row = contextOrDb.prepare<{ id: string }>('SELECT id FROM pets WHERE token=?').get(tokenHash);
  if (!row) {
    throw new Error('Device credential not recognized');
  }
  return row.id;
}

export interface AccountProfileResult {
  displayName: string;
  xHandle: string;
  xHandleSource: string | null;
  identities: Array<{
    platform: string;
    handle: string;
    displayName: string;
    verified: boolean;
  }>;
}

export function telegramIdentity(
  context: AppContext,
  pid: string,
  user: Record<string, unknown>
): string {
  const account = context.repos.deviceSync.ensureAccount(pid);
  const subject = String(user.id || '');
  if (!subject) {
    throw new Error('Telegram user is missing');
  }
  const handle = String(user.username || '').slice(0, 32);
  const rawDisplayName = [user.first_name, user.last_name].filter(Boolean).join(' ');
  const displayName = cleanName(rawDisplayName);
  const now = Math.floor(context.now());

  context.repos.accounts.upsertIdentity(
    account,
    'telegram',
    subject,
    handle,
    displayName,
    true,
    now
  );
  return account;
}

export function discordIdentity(
  context: AppContext,
  pid: string,
  user: Record<string, unknown>
): string {
  const account = context.repos.deviceSync.ensureAccount(pid);
  const subject = String(user.id || '');
  if (!subject) throw new Error('Discord user is missing');
  const handle = String(user.username || '').slice(0, 32);
  const displayName = cleanName(user.global_name || user.display_name || handle || 'Fren');
  context.repos.accounts.upsertIdentity(
    account,
    'discord',
    subject,
    handle,
    displayName,
    true,
    Math.floor(context.now())
  );
  return account;
}

export function discordPet(
  context: AppContext,
  user: Record<string, unknown>,
  allowCreateForLink = false
): { id: string; code: string } {
  const userId = String(user.id || '');
  if (!userId) throw new Error('No Discord user in request');
  const existingPetId = context.repos.telegram.getPetIdForDcUser(userId);
  const existing = existingPetId ? context.repos.pets.findById(existingPetId) : undefined;
  let pid: string;
  let code: string;
  if (existingPetId && existing) {
    pid = existingPetId;
    code = existing.code || '';
  } else if (allowCreateForLink) {
    const displayName = cleanName(user.global_name || user.display_name || user.username || 'Fren');
    const minted = mintPet(context.db, {
      platform: 'discord',
      userId,
      username: String(user.username || ''),
      displayName,
    });
    pid = minted.id;
    code = minted.code;
    context.repos.telegram.linkDcUser(userId, pid, Math.floor(context.now()));
  } else {
    throw new AccountLinkRequiredError('Discord');
  }
  const account = context.repos.deviceSync.getAccountForDevice(pid);
  const linked = account && (
    context.repos.deviceSync.getDevicesForAccount(account).length > 1 ||
    context.repos.wallets.getAccountWallets(account).length > 0
  );
  if (!allowCreateForLink && !linked) throw new AccountLinkRequiredError('Discord');
  discordIdentity(context, pid, user);
  return { id: pid, code };
}

export function readAccountProfile(
  context: AppContext,
  pid: string
): AccountProfileResult {
  const account = context.repos.deviceSync.ensureAccount(pid);
  const profileRow = context.repos.accounts.getProfile(account);
  const identitiesRows = context.repos.accounts.getIdentities(account);

  const identities = identitiesRows.map(r => ({
    platform: r.platform,
    handle: r.handle,
    displayName: r.display_name,
    verified: Boolean(r.verified),
  }));

  const xIdentity = identities.find(item => item.platform === 'x' && item.verified);
  let xHandle = xIdentity ? xIdentity.handle : '';
  let source: string | null = xIdentity ? 'verified-identity' : null;

  if (!xIdentity) {
    const wallets = context.repos.wallets.getAccountWallets(account);
    for (const wallet of wallets) {
      const social = context.repos.wallets.getSocialProfile(wallet);
      if (social?.x_handle && social.source === 'bankr-verified') {
        xHandle = social.x_handle;
        source = 'bankr';
        break;
      }
    }
  }

  return {
    displayName: profileRow?.display_name || '',
    xHandle,
    xHandleSource: source,
    identities,
  };
}

export function telegramPet(
  context: AppContext,
  user: Record<string, unknown>,
  issueToken = false,
  allowCreateForLink = false
): { id: string; token: string | null; code: string } {
  const tgId = String(user.id || '');
  if (!tgId) {
    throw new Error('No Telegram user in request');
  }

  const existingPetId = context.repos.telegram.getPetIdForTgUser(tgId);
  const petExists = existingPetId
    ? context.repos.pets.findById(existingPetId) !== undefined
    : false;

  let pid = '';
  let token: string | null = null;
  let code = '';

  if (existingPetId && petExists) {
    pid = existingPetId;
    if (issueToken) {
      const reissued = reissueToken(context.db, pid);
      token = reissued.token;
      code = reissued.code;
    } else {
      const pet = context.repos.pets.findById(pid);
      code = pet?.code || '';
    }
  } else if (allowCreateForLink) {
    const profile = userProfile(user);
    const minted = mintPet(context.db, profile);
    pid = minted.id;
    token = minted.token;
    code = minted.code;
    const now = Math.floor(context.now());
    context.repos.telegram.linkTgUser(tgId, pid, now);
  } else {
    throw new AccountLinkRequiredError('Telegram');
  }

  const account = context.repos.deviceSync.getAccountForDevice(pid);
  const linked = account && (
    context.repos.deviceSync.getDevicesForAccount(account).length > 1 ||
    context.repos.wallets.getAccountWallets(account).length > 0
  );
  if (!allowCreateForLink && !linked) throw new AccountLinkRequiredError('Telegram');
  telegramIdentity(context, pid, user);
  return { id: pid, token, code };
}
