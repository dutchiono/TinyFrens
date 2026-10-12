# Robot artwork and Base mainnet budget

Measured October 12, 2026. Source/preview revision only; deployed testnet metadata is unchanged.

All six habitats now use detailed 128-pixel scenery with foreground props, layered depth, ground texture and scene-specific stepped light pools. Clouds travel ten pixels in twelve seconds. The background zooms 2.5% over twenty seconds while distant silhouettes shift separately. Robot casing highlights change opacity. Animations remain embedded SVG/CSS, with reduced-motion support and no external images or videos.

## Limits

The richer art intentionally uses more of the deployment and metadata budgets. Working guards are now 24,000 art runtime bytes (576 bytes below EIP-170), 8,500 SVG bytes, 16,000 bytes for fork-sampled tokenURI and 6 million gas for fork-sampled public mint execution. These replace the earlier 22,000 / 7,000 / 13,000 / 5 million guards. They are project budgets, not Net Protocol storage limits. Fixed scenery CSS lives in the existing sprite renderer to leave room for scene records in the art renderer.

| Final measurement | Result |
| --- | ---: |
| Art renderer runtime | 23,694 bytes |
| Remaining under EIP-170 | 882 bytes |
| SVG sweep (4,608 combinations, maximum decorations) | 6,734–7,747 bytes; mean 7,243 |
| Fork public-mint samples, SVG | 6,616–7,377 bytes |
| Fork public-mint samples, stored tokenURI | 12,701–14,049 bytes |
| Fork public-mint execution gas | 4,576,115–4,891,041 |
| Combined three-contract deployment execution gas | 11,677,501 |

The five Node artwork tests and 21 targeted Solidity tests pass, including six browser/Solidity parity fixtures and all 2,664 tokens remaining visibly unique. Browser animation seeking verifies cloud drift from -5 to +5 pixels, zoom from 1 to 1.025, distant-layer shift from -1 to +1 pixels, light opacity from .02 to .18 and casing highlight opacity from .65 to 1. Reduced-motion disables every new motion class.

## Reproduce

```powershell
node --test scripts/test-nft-art.mjs
node scripts/sync-robot-scenes.mjs --check
forge test --match-contract 'TinyFrens(Art|NFT)Test' -vv
forge script contracts/testnet/script/MeasureRobotArt.s.sol --rpc-url https://mainnet.base.org --fork-block-number 52529190
```

The script accepts Base Mainnet (8453) or Base Sepolia (84532). It runs locally against actual Net Protocol and Net Storage contract code. It uses no private key, does not broadcast and spends no funds. Six standard ETH mints cover one token per habitat. Gas measures execution around mint(1), excluding transaction intrinsic gas; later samples benefit from warmed accesses within the simulation. Deployment measures the three constructors together, excluding transaction intrinsic gas. Neither is a paid receipt or an exhaustive gas sweep.

## Fee assumptions

At Base mainnet block 52,529,190 the base fee was 5,000,000 wei (0.005 gwei); the sampled RPC gas-price quote was 6,000,000 wei (0.006 gwei). The Base oracle returned a 2,262,155,383 wei L1 fee upper bound for an assumed 200-byte signed mint transaction. Deployment L1 bounds use each contract creation bytecode length plus 200 bytes for constructor arguments and transaction overhead.

At an ETH price around $2,462, multiply execution gas by 0.006 gwei and add L1 fees for the illustrative USD figures. Quotes vary with congestion and ETH price. The configured 0.001 ETH mint purchase price is separate from network gas; Bankr service fees are not included or verified. No mainnet deployment has been made.

At that quote, sampled mint execution plus the L1 bound is approximately $0.068–$0.073 per NFT, before intrinsic gas and any service fees. A practical quiet-network estimate is $0.07–$0.08 per mint. Combined deployment execution plus its 566,163,001,233 wei L1 upper bound is about $0.174; allow approximately $0.20–$0.25 including the three transactions' intrinsic/initcode gas. These are estimates from simulation, not paid receipts or fixed price guarantees. Viewing and running the SVG animations incurs no further blockchain transaction fees.

Fee model: https://docs.base.org/specifications/transactions/network-fees
