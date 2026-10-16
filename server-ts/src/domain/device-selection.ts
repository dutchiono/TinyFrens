export const SUPPORTED_DEVICE_COLLECTIONS = new Set([
  '4663:0xca28587b61eac19a87dfcfd9420870867a916675',
  '4663:0x34d9e560ee16662d19e44315a822bd51eea0133c',
  '8453:0x8d446c126d4873bfa3eb195b7f0094acc1187a75',
  '8453:0xd745d8005a1ad8f783b97bf55e0d0e6a920ea8ff',
]);

export interface CompanionMotion {
  mode: 'roam' | 'bubble';
  speed: number;
  size: number;
}

export interface CompanionSelectionItem {
  chainId: number;
  originalAddress: string;
  tokenId: number;
  motion: CompanionMotion;
}

export interface TelegramSelectionItem {
  chainId: number;
  originalAddress: string;
  tokenId: number;
  slot: number;
}

function companionIdentity(item: Record<string, unknown>): Omit<TelegramSelectionItem, 'slot'> {
  const chainId = Number(item.chainId);
  const originalAddress = String(item.originalAddress ?? '').toLowerCase();
  const tokenId = item.tokenId;
  if (
    !SUPPORTED_DEVICE_COLLECTIONS.has(`${chainId}:${originalAddress}`) ||
    typeof tokenId !== 'number' ||
    !Number.isInteger(tokenId) ||
    tokenId < 1 ||
    tokenId > 10000
  ) {
    throw new Error('Unsupported companion');
  }
  return { chainId, originalAddress, tokenId };
}

export function validateCompanionSelection(value: unknown): CompanionSelectionItem[] {
  if (!Array.isArray(value) || value.length > 5) {
    throw new Error('Choose up to five companions');
  }

  const result: CompanionSelectionItem[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') {
      throw new Error('Invalid companion');
    }

    const identity = companionIdentity(item as Record<string, unknown>);

    const motion = (item.motion && typeof item.motion === 'object' ? item.motion : {}) as Record<string, unknown>;
    const mode = motion.mode ?? 'roam';
    const speed = motion.speed ?? 60;
    const size = motion.size ?? 80;

    if (
      (mode !== 'roam' && mode !== 'bubble') ||
      typeof speed !== 'number' ||
      !Number.isInteger(speed) ||
      speed < 20 ||
      speed > 140 ||
      typeof size !== 'number' ||
      !Number.isInteger(size) ||
      size < 48 ||
      size > 128
    ) {
      throw new Error('Invalid companion settings');
    }

    const cleanItem: CompanionSelectionItem = {
      ...identity,
      motion: { mode, speed, size },
    };

    const isDuplicate = result.some(
      existing =>
        existing.chainId === identity.chainId &&
        existing.originalAddress === identity.originalAddress &&
        existing.tokenId === identity.tokenId
    );

    if (isDuplicate) {
      throw new Error('Duplicate companion');
    }

    result.push(cleanItem);
  }

  return result;
}

export function validateTelegramSelection(value: unknown): TelegramSelectionItem[] {
  if (!Array.isArray(value) || value.length > 5) throw new Error('Choose up to five Telegram slots');
  const result = value.map(raw => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid Telegram companion');
    const identity = companionIdentity(raw as Record<string, unknown>);
    const slot = (raw as Record<string, unknown>).slot;
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1 || slot > 5) {
      throw new Error('Telegram slots must be numbered 1 through 5');
    }
    return { ...identity, slot };
  });
  const identities = new Set(result.map(item => `${item.chainId}:${item.originalAddress}:${item.tokenId}`));
  const slots = new Set(result.map(item => item.slot));
  if (identities.size !== result.length) throw new Error('Duplicate Telegram companion');
  if (slots.size !== result.length) throw new Error('Duplicate Telegram slot');
  return result.sort((a, b) => a.slot - b.slot);
}
