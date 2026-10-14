import {
  MARKET_TOKEN,
  MARKET_WETH,
  calculateMarketQuote,
  MarketCalculationResult,
} from './market-quote-math.js';

const API_BASE = 'https://api.dexscreener.com/token-pairs/v1/base/';

export interface MarketQuoteStatus {
  status: 'available' | 'stale' | 'unavailable';
  error: string | null;
  source: string;
  oracle: string;
  cacheSeconds: number;
  token: string;
  chainId: number;
  fetchedAt?: number;
  frensEth?: string;
  ethUsd?: string;
  priceUsd?: string;
  frensPerCent?: string;
  frensPerDollar?: string;
  marketCapUsd?: string | null;
  fdvUsd?: string | null;
  liquidityUsd?: string;
  pairAddress?: string;
  ethPairAddress?: string;
}

export class MarketQuote {
  public readonly now: () => number;
  public readonly fetchFn: () => Promise<[unknown[], unknown[]]>;
  private cached: (MarketCalculationResult & { fetchedAt: number }) | null = null;
  private nextAttempt = 0;
  private error: string | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(
    now: () => number = () => Date.now() / 1000,
    fetchFn?: () => Promise<[unknown[], unknown[]]>
  ) {
    this.now = now;
    this.fetchFn = fetchFn || this._defaultFetch.bind(this);
  }

  private async _defaultFetch(): Promise<[unknown[], unknown[]]> {
    const fetchPair = async (address: string): Promise<unknown[]> => {
      const res = await fetch(API_BASE + address, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }
      const data = await res.json();
      if (!Array.isArray(data)) {
        throw new Error('Invalid market response');
      }
      return data;
    };
    return Promise.all([fetchPair(MARKET_TOKEN), fetchPair(MARKET_WETH)]);
  }

  async get(settings: { chainId?: number; frensToken?: string | null }): Promise<MarketQuoteStatus> {
    if (
      settings.chainId !== 8453 ||
      String(settings.frensToken || '').toLowerCase() !== MARKET_TOKEN.toLowerCase()
    ) {
      return {
        status: 'unavailable',
        error: 'Market quotes support the production FRENS token on Base only.',
        source: 'DEX Screener · Base pools',
        oracle: 'No settlement price oracle configured',
        cacheSeconds: 300,
        token: MARKET_TOKEN,
        chainId: 8453,
      };
    }

    if (this.now() >= this.nextAttempt) {
      if (!this.inFlight) {
        this.inFlight = (async () => {
          try {
            const [frensPairs, ethPairs] = await this.fetchFn();
            const calc = calculateMarketQuote(frensPairs, ethPairs);
            this.cached = { ...calc, fetchedAt: Math.floor(this.now()) };
            this.error = null;
            this.nextAttempt = this.now() + 300;
          } catch {
            this.error = 'Market provider unavailable; retry in one minute.';
            this.nextAttempt = this.now() + 60;
          } finally {
            this.inFlight = null;
          }
        })();
      }
      await this.inFlight;
    }

    const status: 'available' | 'stale' | 'unavailable' = this.cached
      ? (this.error ? 'stale' : 'available')
      : 'unavailable';

    return {
      ...(this.cached || {}),
      status,
      error: this.error,
      source: 'DEX Screener · Base pools',
      oracle: 'No settlement price oracle configured',
      cacheSeconds: 300,
      token: MARKET_TOKEN,
      chainId: 8453,
    };
  }
}
