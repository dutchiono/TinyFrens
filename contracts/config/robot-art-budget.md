# Detailed robot artwork budget

Measured October 12, 2026. This artwork is a preview/source revision, not a replacement for deployed testnet metadata.

| Measurement | Earlier preview | Detailed animated scenery |
| --- | ---: | ---: |
| Art renderer runtime bytes | 16,072 | 21,607 |
| Remaining below 24,576-byte runtime limit | 8,504 | 2,969 |
| SVG bytes, fork-minted tokens 1–6 | 4,142–4,658 | 4,651–6,499 |
| Stored tokenURI bytes, same tokens | 8,177–9,105 | 9,209–12,513 |
| Single creator-mint execution gas, same tokens | 2,969,116–3,177,890 | 3,351,583–4,434,588 |

Detailed measurements include the Robots v1 collection identity and Series/Edition metadata traits, the native 128-pixel scene grid, Pilot Helmet and redesigned Cloud Terrace. Cloud Terrace is the first detailed scene pass; the other five scenes retain their earlier compositions at the larger grid size.

The detailed SVG sweep covers all 4,608 palette/expression/accessory/habitat/motion combinations with the largest era marker and evolution decorations. Sizes range from 4,769 to 6,660 bytes, averaging 5,430 bytes. Stored metadata is larger because the SVG is base64 encoded inside JSON, which is then base64 encoded again.

Background tiles use compact seven-byte coordinate/color records in contract code. Consecutive tiles sharing a fill are emitted as one SVG path. Character tiles use compact paths on integer pixel coordinates. Opposite limbs share keyframes with half-cycle offsets; scenery also reuses CSS keyframes rather than storing rendered video frames. Walking remains 15% slower than the first refined preview.

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
