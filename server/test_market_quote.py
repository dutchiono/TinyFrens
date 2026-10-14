import asyncio
from decimal import Decimal
import unittest
from market_quote import TOKEN, WETH, USDC, MarketQuote, calculate


def pair(base, quote, native, usd, liquidity=1000, **extra):
    return dict(chainId='base', baseToken={'address': base}, quoteToken={'address': quote},
                priceNative=native, priceUsd=usd, liquidity={'usd': liquidity}, **extra)


FRENS = [pair(TOKEN, WETH, '0.0000000001', '0.0000002', marketCap=20000)]
ETH = [pair(WETH, USDC, '2000', '2000')]
SETTINGS = {'chainId': 8453, 'frensToken': TOKEN}


class QuoteTests(unittest.IsolatedAsyncioTestCase):
    def test_eth_conversion_and_missing_cap(self):
        quote = calculate(FRENS, ETH)
        self.assertEqual(Decimal(quote['priceUsd']), Decimal('0.0000002'))
        self.assertEqual(Decimal(quote['frensPerCent']), 50000)
        self.assertEqual(Decimal(quote['frensPerDollar']), 5000000)
        self.assertEqual(quote['marketCapUsd'], '20000')
        self.assertIsNone(quote['fdvUsd'])

    def test_reject_wrong_chain_token_quote_and_invalid_prices(self):
        for field, value in [('chainId', 'ethereum'), ('baseToken', {'address': USDC}),
                             ('quoteToken', {'address': USDC}), ('priceNative', '0'),
                             ('priceUsd', 'NaN'), ('priceNative', 'Infinity')]:
            with self.subTest(field=field, value=value):
                broken = dict(FRENS[0], **{field: value})
                with self.assertRaises(ValueError):
                    calculate([broken], ETH)

    def test_most_liquid_matching_pair(self):
        quote = calculate(FRENS + [pair(TOKEN, WETH, '0.01', '20', liquidity=1)], ETH)
        self.assertEqual(Decimal(quote['frensPerCent']), 50000)

    async def test_shared_cache_concurrent_requests_and_expiry(self):
        calls = []
        clock = [1000]
        async def fetch():
            calls.append(1)
            await asyncio.sleep(0)
            return FRENS, ETH
        service = MarketQuote(now=lambda: clock[0], fetch=fetch)
        results = await asyncio.gather(*(service.get(SETTINGS) for _ in range(20)))
        self.assertEqual(len(calls), 1)
        self.assertTrue(all(q['status'] == 'available' for q in results))
        clock[0] += 299
        await service.get(SETTINGS)
        self.assertEqual(len(calls), 1)
        clock[0] += 1
        await service.get(SETTINGS)
        self.assertEqual(len(calls), 2)

    async def test_failure_backoff_and_stale_values_are_explicit(self):
        calls = []
        clock = [1000]
        async def fetch():
            calls.append(1)
            if len(calls) > 1:
                raise OSError('offline')
            return FRENS, ETH
        service = MarketQuote(now=lambda: clock[0], fetch=fetch)
        good = await service.get(SETTINGS)
        clock[0] += 300
        stale = await service.get(SETTINGS)
        self.assertEqual(stale['status'], 'stale')
        self.assertEqual(stale['fetchedAt'], good['fetchedAt'])
        self.assertEqual(stale['priceUsd'], good['priceUsd'])
        for _ in range(10):
            await service.get(SETTINGS)
        self.assertEqual(len(calls), 2)

    async def test_unsupported_chain_never_fetches(self):
        async def fetch():
            self.fail('Unsupported chain must not fetch')
        service = MarketQuote(fetch=fetch)
        result = await service.get(dict(SETTINGS, chainId=84532))
        self.assertEqual(result['status'], 'unavailable')

    async def test_initial_outage_has_no_fabricated_quote(self):
        async def fetch():
            raise OSError('offline')
        result = await MarketQuote(fetch=fetch).get(SETTINGS)
        self.assertEqual(result['status'], 'unavailable')
        self.assertNotIn('priceUsd', result)
