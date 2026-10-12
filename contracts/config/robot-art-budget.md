# Detailed robot artwork budget

Measured October 12, 2026. This artwork is a preview/source revision, not a replacement for deployed testnet metadata.

| Measurement | Earlier preview | Detailed animated scenery |
| --- | ---: | ---: |
| Art renderer runtime bytes | 16,072 | 19,765 |
| Remaining below 24,576-byte runtime limit | 8,504 | 4,811 |
| SVG bytes, fork-minted tokens 1–6 | 4,142–4,658 | 5,484–6,160 |
| Stored tokenURI bytes, same tokens | 8,177–9,105 | 10,685–11,905 |
| Single creator-mint execution gas, same tokens | 2,969,116–3,177,890 | 3,735,323–4,045,153 |

Detailed measurements include the Robots v1 collection identity and Series/Edition metadata traits. Artwork itself is unchanged by the identity update.

The detailed SVG sweep covers all 4,608 palette/expression/accessory/habitat/motion combinations with the largest era marker and evolution decorations. Sizes range from 5,613 to 6,522 bytes, averaging 6,101 bytes. Stored metadata is larger because the SVG is base64 encoded inside JSON, which is then base64 encoded again.

Background tiles use compact seven-byte coordinate/color records in contract code. Consecutive tiles sharing a fill are emitted as one SVG path. Animated layers reuse CSS keyframes rather than storing rendered video frames. Walking remains 15% slower than the first refined preview.

## Reproduce

Run from the repository root:

```powershell
node scripts/sync-robot-scenes.mjs --check
node --test scripts/test-nft-art.mjs
forge build --sizes
forge test --match-contract TinyFrensArtTest -vv
forge script contracts/testnet/script/MeasureRobotArt.s.sol --rpc-url https://sepolia.base.org --fork-block-number 48038475
```

The measurement script runs locally against a Base Sepolia fork at block 48,038,475 using the actual Net Protocol and Net Storage contract code. It does not broadcast, use a private key, or spend funds. Gas numbers measure execution around `mintToCreator(1, creator)`, excluding deployment and transaction intrinsic gas. They are not paid public-mint receipts or ETH price estimates. Later samples benefit from warmed accesses within the simulation.

## Working guards

- Art renderer runtime at most 22,000 bytes, leaving deployment headroom.
- Every tested SVG at most 7,000 bytes, including maximum evolution decorations.
- Fork sample metadata at most 13,000 bytes and creator-mint execution at most 5 million gas.

These are project budgets, not Net Protocol's maximum storage limits. The fork measurement covers six minted tokens, one per habitat; it is not an exhaustive mint/gas sweep. Changes to metadata, vault backing, or collection configuration need new measurements. Browser/Solidity parity fixtures cover all six accessories and habitats and all four expression/motion values. Wallet thumbnail animation remains unverified.
