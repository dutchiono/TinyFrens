import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateMarketQuote,
  bestPair,
  MARKET_TOKEN,
  MARKET_WETH,
  MARKET_USDC,
} from '../../src/domain/market-quote-math.js';

describe('Domain: Market Quote Calculation', () => {
  const mockFrensPair = {
    chainId: 'base',
    pairAddress: '0xfrensPair1',
    baseToken: { address: MARKET_TOKEN },
    quoteToken: { address: MARKET_WETH },
    priceNative: '0.000005', // FRENS/ETH
    priceUsd: '0.015',
    marketCap: '150000',
    fdv: '150000',
    liquidity: { usd: '50000' },
  };

  const mockEthPair = {
    chainId: 'base',
    pairAddress: '0xethPair1',
    baseToken: { address: MARKET_WETH },
    quoteToken: { address: MARKET_USDC },
    priceNative: '3000',
    priceUsd: '3000', // ETH/USD
    liquidity: { usd: '10000000' },
  };

  test('selects best pair based on liquidity', () => {
    const lowLiqPair = {
      ...mockFrensPair,
      pairAddress: '0xlowLiq',
      liquidity: { usd: '100' },
    };
    const pair = bestPair([lowLiqPair, mockFrensPair], MARKET_TOKEN, MARKET_WETH);
    assert.equal(pair.pairAddress, '0xfrensPair1');
  });

  test('calculates derived FRENS USD price and quantities', () => {
    const quote = calculateMarketQuote([mockFrensPair], [mockEthPair]);

    assert.equal(quote.frensEth, '0.000005');
    assert.equal(quote.ethUsd, '3000');
    // price = 0.000005 * 3000 = 0.015
    assert.equal(quote.priceUsd, '0.015');
    assert.equal(quote.pairAddress, '0xfrensPair1');
    assert.equal(quote.ethPairAddress, '0xethPair1');
    assert.equal(quote.liquidityUsd, '50000');
  });

  test('throws if no valid pair exists', () => {
    assert.throws(
      () => bestPair([], MARKET_TOKEN, MARKET_WETH),
      /No liquid Base pair available/
    );
  });
});
