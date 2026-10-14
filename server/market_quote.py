"""Cached, indicative FRENS/ETH × ETH/USD quotes. Never used to settle care charges."""
import asyncio
from decimal import Decimal, InvalidOperation
import time

from aiohttp import ClientSession, ClientTimeout

TOKEN = '0x1a96226727a1d0a46334b3a4b3878b32b7659ba3'
WETH = '0x4200000000000000000000000000000000000006'
USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
API = 'https://api.dexscreener.com/token-pairs/v1/base/'


def positive(value):
    try:
        number = Decimal(str(value))
        return number if number.is_finite() and number > 0 else None
    except (InvalidOperation, ValueError):
        return None


def best_pair(pairs, base, quote):
    candidates = [p for p in pairs if isinstance(p, dict)
                  and p.get('chainId') == 'base'
                  and (p.get('baseToken') or {}).get('address', '').lower() == base
                  and (p.get('quoteToken') or {}).get('address', '').lower() == quote
                  and positive(p.get('priceNative')) and positive(p.get('priceUsd'))
                  and positive((p.get('liquidity') or {}).get('usd'))]
    if not candidates:
        raise ValueError('No liquid Base pair available for the configured token')
    return max(candidates, key=lambda p: positive(p['liquidity']['usd']))


def calculate(frens_pairs, eth_pairs):
    pair = best_pair(frens_pairs, TOKEN, WETH)
    eth_pair = best_pair(eth_pairs, WETH, USDC)
    eth_price = positive(eth_pair['priceUsd'])
    native = positive(pair['priceNative'])
    price = native * eth_price
    return {'frensEth': str(native), 'ethUsd': str(eth_price), 'priceUsd': str(price),
            'frensPerCent': str(Decimal('0.01') / price),
            'frensPerDollar': str(Decimal(1) / price),
            'marketCapUsd': str(positive(pair.get('marketCap'))) if positive(pair.get('marketCap')) else None,
            'fdvUsd': str(positive(pair.get('fdv'))) if positive(pair.get('fdv')) else None,
            'liquidityUsd': str(positive(pair['liquidity']['usd'])),
            'pairAddress': pair.get('pairAddress'), 'ethPairAddress': eth_pair.get('pairAddress')}


class MarketQuote:
    def __init__(self, now=time.time, fetch=None):
        self.now, self.fetch = now, fetch or self._fetch
        self.lock = asyncio.Lock()
        self.cached = None
        self.next_attempt = 0
        self.error = None

    async def _fetch(self):
        async with ClientSession(timeout=ClientTimeout(total=8)) as session:
            async def read(address):
                async with session.get(API + address) as response:
                    response.raise_for_status()
                    result = await response.json()
                    if not isinstance(result, list):
                        raise ValueError('Invalid market response')
                    return result
            return await asyncio.gather(read(TOKEN), read(WETH))

    async def get(self, settings):
        if settings.get('chainId') != 8453 or str(settings.get('frensToken') or '').lower() != TOKEN:
            return {'status': 'unavailable', 'error': 'Market quotes support the production FRENS token on Base only.'}
        async with self.lock:
            if self.now() >= self.next_attempt:
                try:
                    pairs, eth_pairs = await self.fetch()
                    self.cached = {**calculate(pairs, eth_pairs), 'fetchedAt': int(self.now())}
                    self.error = None
                    self.next_attempt = self.now() + 300
                except Exception:
                    self.error = 'Market provider unavailable; retry in one minute.'
                    self.next_attempt = self.now() + 60
            return {**(self.cached or {}), 'status': ('stale' if self.error else 'available') if self.cached else 'unavailable',
                    'error': self.error, 'source': 'DEX Screener · Base pools',
                    'oracle': 'No settlement price oracle configured', 'cacheSeconds': 300,
                    'token': TOKEN, 'chainId': 8453}
