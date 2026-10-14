export const MARKET_TOKEN = '0x1a96226727a1d0a46334b3a4b3878b32b7659ba3';
export const MARKET_WETH = '0x4200000000000000000000000000000000000006';
export const MARKET_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

export function positiveNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) {
    return num;
  }
  return null;
}

export function cleanFloatString(val: number): string {
  return parseFloat(val.toPrecision(12)).toString();
}

export interface DexPair {
  chainId?: string;
  pairAddress?: string;
  baseToken?: { address?: string };
  quoteToken?: { address?: string };
  priceNative?: string | number;
  priceUsd?: string | number;
  marketCap?: string | number;
  fdv?: string | number;
  liquidity?: { usd?: string | number };
}

export function bestPair(pairs: unknown[], base: string, quote: string): DexPair {
  const baseLower = base.toLowerCase();
  const quoteLower = quote.toLowerCase();

  const candidates = (pairs || []).filter((p): p is DexPair => {
    if (!p || typeof p !== 'object') return false;
    const pair = p as DexPair;
    return (
      pair.chainId === 'base' &&
      (pair.baseToken?.address || '').toLowerCase() === baseLower &&
      (pair.quoteToken?.address || '').toLowerCase() === quoteLower &&
      positiveNumber(pair.priceNative) !== null &&
      positiveNumber(pair.priceUsd) !== null &&
      positiveNumber(pair.liquidity?.usd) !== null
    );
  });

  if (candidates.length === 0) {
    throw new Error('No liquid Base pair available for the configured token');
  }

  return candidates.reduce((best, curr) => {
    const bestLiq = positiveNumber(best.liquidity?.usd) ?? 0;
    const currLiq = positiveNumber(curr.liquidity?.usd) ?? 0;
    return currLiq > bestLiq ? curr : best;
  });
}

export interface MarketCalculationResult {
  frensEth: string;
  ethUsd: string;
  priceUsd: string;
  frensPerCent: string;
  frensPerDollar: string;
  marketCapUsd: string | null;
  fdvUsd: string | null;
  liquidityUsd: string;
  pairAddress?: string;
  ethPairAddress?: string;
}

export function calculateMarketQuote(
  frensPairs: unknown[],
  ethPairs: unknown[]
): MarketCalculationResult {
  const pair = bestPair(frensPairs, MARKET_TOKEN, MARKET_WETH);
  const ethPair = bestPair(ethPairs, MARKET_WETH, MARKET_USDC);

  const ethPrice = positiveNumber(ethPair.priceUsd)!;
  const native = positiveNumber(pair.priceNative)!;
  const price = native * ethPrice;

  const frensPerCent = cleanFloatString(0.01 / price);
  const frensPerDollar = cleanFloatString(1.0 / price);

  const mcap = positiveNumber(pair.marketCap);
  const fdv = positiveNumber(pair.fdv);
  const liquidity = positiveNumber(pair.liquidity?.usd)!;

  return {
    frensEth: cleanFloatString(native),
    ethUsd: cleanFloatString(ethPrice),
    priceUsd: cleanFloatString(price),
    frensPerCent,
    frensPerDollar,
    marketCapUsd: mcap !== null ? cleanFloatString(mcap) : null,
    fdvUsd: fdv !== null ? cleanFloatString(fdv) : null,
    liquidityUsd: cleanFloatString(liquidity),
    pairAddress: pair.pairAddress,
    ethPairAddress: ethPair.pairAddress,
  };
}
