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
