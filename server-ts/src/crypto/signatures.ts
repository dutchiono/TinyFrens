import { createHmac, timingSafeEqual } from 'node:crypto';
import { getAddress, isAddress, recoverMessageAddress } from 'viem';

export function isValidAddress(address: unknown): address is `0x${string}` {
  if (typeof address !== 'string') return false;
  return isAddress(address);
}

export function toChecksumAddress(address: string): `0x${string}` {
  return getAddress(address);
}

export async function recoverPersonalSigner(params: {
  message: string;
  signature: `0x${string}` | string;
}): Promise<`0x${string}`> {
  const { message, signature } = params;
  if (!signature.startsWith('0x')) {
    throw new Error('Signature must start with 0x');
  }
  return await recoverMessageAddress({
    message,
    signature: signature as `0x${string}`,
  });
}

export function verifyGithubWebhookSignature(
  secret: string,
  body: Buffer | Uint8Array,
  signatureHeader: string
): boolean {
  if (!secret || !signatureHeader || !body) return false;
  const [prefix, digest] = signatureHeader.split('=');
  if (prefix?.trim().toLowerCase() !== 'sha256' || !digest) return false;

  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const digestTrimmed = digest.trim().toLowerCase();

  if (expected.length !== digestTrimmed.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(digestTrimmed));
}

export interface TelegramInitDataUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface ValidatedTelegramInitData {
  user?: TelegramInitDataUser;
  auth_date: number;
  start_param?: string;
  chat_instance?: string;
  raw_fields: Record<string, string>;
}

export function validateTelegramInitData(
  initData: string,
  botToken: string,
  maxAge: number = 86400,
  nowSeconds: number = Date.now() / 1000
): ValidatedTelegramInitData {
  if (!initData || typeof initData !== 'string') {
    throw new Error('Missing Telegram initData');
  }
  if (!botToken) {
    throw new Error('Telegram bot is not configured');
  }

  const fields: Record<string, string> = {};
  const pairs: string[] = [];

  for (const chunk of initData.split('&')) {
    if (!chunk.includes('=')) continue;
    const [rawKey, rawValue] = chunk.split('=', 2);
    const key = decodeURIComponent(rawKey);
    const value = decodeURIComponent(rawValue);
    if (key === 'hash') {
      fields['hash'] = value;
      continue;
    }
    pairs.push(`${key}=${value}`);
    fields[key] = value;
  }

  const receivedHash = fields['hash'];
  if (!receivedHash) {
    throw new Error('initData is missing its signature');
  }

  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const computedHash = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (
    computedHash.length !== receivedHash.length ||
    !timingSafeEqual(Buffer.from(computedHash), Buffer.from(receivedHash))
  ) {
    throw new Error('Telegram signature does not match');
  }

  const authDate = parseInt(fields['auth_date'] || '0', 10);
  if (!authDate || nowSeconds - authDate > maxAge) {
    throw new Error('Telegram login has expired');
  }

  let user: TelegramInitDataUser | undefined;
  if (fields['user']) {
    try {
      user = JSON.parse(fields['user']);
    } catch {
      // ignore invalid user JSON
    }
  }

  return {
    user,
    auth_date: authDate,
    start_param: fields['start_param'],
    chat_instance: fields['chat_instance'],
    raw_fields: fields,
  };
}
