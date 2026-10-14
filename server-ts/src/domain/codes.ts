export const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeCode(raw: unknown): string {
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return '';
  }
  return String(raw)
    .replace(/-/g, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function generateRandomCode(
  length: number,
  randomFn: () => number = Math.random
): string {
  let result = '';
  const alphabetLength = PAIRING_ALPHABET.length;
  for (let i = 0; i < length; i++) {
    const index = Math.floor(randomFn() * alphabetLength);
    result += PAIRING_ALPHABET[index % alphabetLength];
  }
  return result;
}

export function isValidCode(code: string, expectedLength?: number): boolean {
  if (!code) return false;
  if (expectedLength !== undefined && code.length !== expectedLength) {
    return false;
  }
  for (let i = 0; i < code.length; i++) {
    if (!PAIRING_ALPHABET.includes(code[i])) {
      return false;
    }
  }
  return true;
}
