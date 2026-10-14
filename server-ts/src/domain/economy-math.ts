export const CREDITS_PER_FRENS = 100n;
export const FRENS_DECIMALS = 18n;
export const PACKAGES = [10, 50, 100] as const;

export function creditsFromWei(
  amountWei: bigint | string | number,
  creditsPerFrens: bigint = CREDITS_PER_FRENS
): bigint {
  const wei = BigInt(amountWei);
  if (wei < 0n) {
    throw new Error('amount must be >= 0');
  }
  const divisor = 10n ** FRENS_DECIMALS;
  return (wei * creditsPerFrens) / divisor;
}

export function weiFromFrens(frens: bigint | number): bigint {
  const f = BigInt(frens);
  return f * (10n ** FRENS_DECIMALS);
}

export interface EconomyPackage {
  frens: number;
  amountWei: string;
  credits: number;
}

export function getPackages(creditsPerFrens: number = 100): EconomyPackage[] {
  return PACKAGES.map(f => ({
    frens: f,
    amountWei: weiFromFrens(f).toString(),
    credits: f * creditsPerFrens,
  }));
}

export function parseFrensToCredits(
  amount: unknown,
  creditsPerFrens: number = 100
): { credits: number; cleanAmount: string } {
  let cleanStr: string;

  if (typeof amount === 'number') {
    if (amount <= 0 || Number.isNaN(amount) || !Number.isFinite(amount)) {
      throw new Error('Vote amount must be greater than zero');
    }
    cleanStr = amount.toFixed(18).replace(/\.?0+$/, '');
  } else if (typeof amount === 'string') {
    cleanStr = amount.trim();
  } else {
    throw new Error('Invalid vote amount format');
  }

  if (!/^[0-9]+(?:\.[0-9]{1,18})?$/.test(cleanStr)) {
    throw new Error('Vote amount must be a positive number with up to 18 decimal places');
  }
  if (!/[1-9]/.test(cleanStr)) {
    throw new Error('Vote amount must be greater than zero');
  }

  const parts = cleanStr.split('.');
  const whole = BigInt(parts[0]);
  const fractionStr = (parts[1] || '').padEnd(18, '0').slice(0, 18);
  const amountWei = whole * 10n ** 18n + BigInt(fractionStr);
  const creditsBig = (amountWei * BigInt(creditsPerFrens)) / 10n ** 18n;
  const credits = Number(creditsBig);

  if (credits <= 0) {
    const minFrens = 1 / creditsPerFrens;
    throw new Error(`Vote amount must be at least ${minFrens} FRENS (1 credit)`);
  }
  if (credits > 100_000_000 * creditsPerFrens) {
    throw new Error('Vote amount exceeds maximum allowed per vote');
  }

  return { credits, cleanAmount: cleanStr };
}

