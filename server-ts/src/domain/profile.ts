export const VALID_SHAPES = new Set([
  'cat',
  'blob',
  'robot',
  'bunny',
  'duck',
  'pig',
  'frog',
  'turtle',
  'dog',
  'bear',
]);

export interface PetProfile {
  name: string;
  shape: string;
  color: string;
  expression?: string;
  accessory?: string;
  tokenId?: number;
}

export function normalizeProfile(raw: unknown): PetProfile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid pet');
  }

  const obj = { ...(raw as Record<string, unknown>) };
  if (obj.shape === 'mascot') {
    obj.shape = 'robot';
  }

  const rawName = String(obj.name ?? '');
  // Remove ASCII control characters and 0x7f DEL, collapse multiple whitespace
  const sanitizedName = rawName
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);

  const shape = String(obj.shape ?? '');
  const color = String(obj.color ?? '');

  if (
    !sanitizedName ||
    !VALID_SHAPES.has(shape) ||
    !/^#[a-fA-F0-9]{6}$/.test(color)
  ) {
    throw new Error('Invalid pet');
  }

  const result: PetProfile = {
    name: sanitizedName,
    shape,
    color,
  };

  if (obj.expression) {
    result.expression = String(obj.expression).slice(0, 20);
  }

  if (obj.accessory) {
    result.accessory = String(obj.accessory).slice(0, 20);
  }

  if (obj.tokenId !== undefined && obj.tokenId !== null) {
    const parsedId = Number(obj.tokenId);
    if (Number.isInteger(parsedId) && !Number.isNaN(parsedId)) {
      result.tokenId = parsedId;
    }
  }

  return result;
}
