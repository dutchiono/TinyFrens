# Robot artwork and Base mainnet budget

Measured October 12, 2026. Source/preview revision only; deployed testnet metadata is unchanged.

Six detailed 128-pixel habitats use foreground props, layered silhouettes, ground texture and scene-specific stepped light pools. Camera zoom has been removed. Clouds travel ten pixels with 4/6/8/10-second drift variants. Stars fade fully out and brighten with four independent twinkle timings. Crown, halo, bow tie and orb have been redrawn; halo/orb float independently. Era indicators are integrated into the casing rather than floating in the sky.

## Motion traits

Walking retains its existing four variants. Eight separate two-bit environmental values are packed into a deterministic per-token uint16 ambience trait, generated as (tokenId * 7919 + 104729) modulo 65536. Cloud Drift, Star Twinkle, Falling Leaves, Foliage Sway, Light Cycle, Neon Glow, Layer Drift and Accessory Float have separate timings. Metadata only lists traits relevant to the token's habitat/accessory. Browser artwork, gallery, sample exports and Solidity use the same timing and label definitions. These are artwork traits rather than device preferences.

## Limits and measurements

Working guards: each production contract runtime at most 24,000 bytes (576 below EIP-170), each tested SVG at most 8,500 bytes, fork-sampled tokenURI at most 16,000 bytes and public-mint execution at most 6 million gas. These intentionally replace the earlier 22,000 / 7,000 / 13,000 / 5 million project guards to allow richer art. They are not Net Protocol storage limits. Packed tile records and shared SVG paths encode scenery and accessories; fixed animation CSS/timing definitions live in the existing sprite renderer.

| Measurement | Result |
| --- | ---: |
| Art renderer runtime | 15,413 bytes |
| Sprite renderer runtime | 16,808 bytes |
| NFT runtime | 19,336 bytes |
| SVG sweep: 18,432 artwork/motion-profile combinations, max decorations | 6,864–8,014 bytes; mean 7,473 |
| Six fork samples: SVG | 6,745–7,441 bytes |
| Six fork samples: stored tokenURI | 13,169–14,481 bytes |
| Public mint execution gas | 4,720,277–5,011,842 |
| Three-contract deployment execution gas | 10,838,594 |

Five Node artwork tests and 22 targeted Solidity tests pass. Six browser/Solidity parity fixtures cover all accessories/habitats and varied environmental values. The full 2,664-token set has unique visible art. A stored-metadata test checks actual motion labels against the rendered CSS. Browser checks confirm four distinct timing profiles, stars fading from opacity 0 to 1, no zoom, pause/reduced-motion support and no mobile overflow.

## Reproduce

```powershell
node --test scripts/test-nft-art.mjs
node scripts/sync-robot-scenes.mjs --check
forge test --match-contract 'TinyFrens(Art|NFT)Test' -vv
forge script contracts/testnet/script/MeasureRobotArt.s.sol --rpc-url https://mainnet.base.org --fork-block-number 52529190
```

The script accepts Base Mainnet (8453) or Base Sepolia (84532). It runs locally against actual Net Protocol and Net Storage contract code, without a private key, broadcasting or spending funds. Six standard ETH mints cover one token per habitat. Mint gas excludes transaction intrinsic gas; later samples benefit from warmed accesses within the simulation. Deployment measures three constructors together, excluding intrinsic gas. These are not paid receipts or an exhaustive mint/gas sweep.

## Illustrative fees

At Base mainnet block 52,529,190, base fee was 5,000,000 wei (0.005 gwei); the sampled RPC gas-price quote was 6,000,000 wei (0.006 gwei). The Base oracle returned an L1 fee upper bound of 2,262,155,383 wei for an assumed 200-byte signed mint transaction. The combined deployment L1 bound was 525,604,940,980 wei, using each creation bytecode length plus 200 bytes for constructor arguments and transaction overhead.

Using ETH around $2,462 and the sampled 0.006 gwei quote, mint execution plus the L1 bound is about $0.070–$0.074 per NFT. Allow roughly $0.07–$0.08 including intrinsic gas. Three-contract deployment execution plus the L1 bound is about $0.161; a practical allowance including intrinsic/initcode gas is approximately $0.20–$0.25. Fees vary with congestion and ETH price. The configured 0.001 ETH mint purchase price is separate; Bankr service fees are excluded and unverified. Viewing/animating stored SVG requires no further blockchain transactions. No mainnet contracts have been deployed.

Fee model: https://docs.base.org/specifications/transactions/network-fees
