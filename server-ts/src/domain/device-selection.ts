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

export function validateCompanionSelection(value: unknown): CompanionSelectionItem[] {
  if (!Array.isArray(value) || value.length > 5) {
    throw new Error('Choose up to five companions');
  }

  const result: CompanionSelectionItem[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') {
      throw new Error('Invalid companion');
    }

    const chain = Number(item.chainId);
    const address = String(item.originalAddress ?? '').toLowerCase();
    const token = item.tokenId;

    const motion = (item.motion && typeof item.motion === 'object' ? item.motion : {}) as Record<string, unknown>;
    const mode = motion.mode ?? 'roam';
    const speed = motion.speed ?? 60;
    const size = motion.size ?? 80;

    const collectionKey = `${chain}:${address}`;
    if (
      !SUPPORTED_DEVICE_COLLECTIONS.has(collectionKey) ||
      typeof token !== 'number' ||
      !Number.isInteger(token) ||
      token < 1 ||
      token > 10000
    ) {
      throw new Error('Unsupported companion');
    }

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
      chainId: chain,
      originalAddress: address,
      tokenId: token,
      motion: { mode, speed, size },
    };

    const isDuplicate = result.some(
      existing =>
        existing.chainId === chain &&
        existing.originalAddress === address &&
        existing.tokenId === token
    );

    if (isDuplicate) {
      throw new Error('Duplicate companion');
    }

    result.push(cleanItem);
  }

  return result;
}
