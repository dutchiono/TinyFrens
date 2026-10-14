# Admin overview

The relay-only `/admin` page groups economy overview, care settings, activity,
and operator access. Market data is authenticated through `/api/admin/market`.

Registered devices counts credential records in the legacy `pets` table;
sync accounts counts distinct groups in `device_sync_members`. Neither metric
counts NFTs, active users, or online devices. Missing database metrics return
null and display unavailable, rather than reporting an invented zero.
FRENS balance converts the credit-account total using `creditsPerFrens`.

Indicative market data uses the [DEX Screener token-pairs API](https://docs.dexscreener.com/api/reference).
Only production FRENS on Base (8453) is supported. The highest-liquidity
matching FRENS/WETH and WETH/USDC pools supply FRENS/ETH and ETH/USD;
their product supplies FRENS/USD. USD conversions use Decimal arithmetic.
Market cap and FDV are separately labeled provider-reported values, not
inferred circulating supply. The provider may lag trades; fetchedAt records
our retrieval time, not the time of the last trade.

One shared lazy cache refreshes at most every 300 seconds, including concurrent
admin sessions. Failed requests back off for 60 seconds. Previous quotes are
explicitly stale; an initial outage supplies no prices. Two HTTP reads refresh
the quote; no blockchain RPC calls or background polling are added.
This is not a settlement oracle and does not change FRENS-denominated care prices.
