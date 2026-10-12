---
name: tinyfrens-robots-v1
description: "Prepare, deploy, and verify TinyFrens: Robots v1, the robot-only BNKR pixel NFT collection, on a supported EVM chain with Net Protocol integration."
metadata: {"bankr":{"emoji":"🐾","requires":{"bins":["forge","cast"]}}}
---

# TinyFrens: Robots v1

The source of truth is this repository's `contracts/TinyFrensNFT.sol`, `contracts/TinyFrensArt.sol`, `contracts/TinyFrensSprite.sol`, and `contracts/NetIntegratedERC721A.sol`. Use those exact files and the pinned dependencies in `lib/`; never copy an older embedded contract from a skill response. `web/nft-art.mjs` powers the preview gallery. Minted `tokenURI` and `art()` are authoritative.

| Parameter | Value |
|---|---|
| Brand | TinyFrens |
| Collection | TinyFrens: Robots v1 (`TFROB1`) |
| Collection ID | `tinyfrens-robots-v1` |
| Default token name | TinyFrens Robot v1 #1 |
| Supply | 2,664 total robot NFTs across three 888-token eras |
| Mint price | 0.001 ETH |
| Wallet limit | 20 |
| Creator reserve | 20 |
| Art | On-chain 128×128 pixel scene with integer-grid character tiles, animated body and alternating feet |
| Traits | 8 palettes, 4 expressions, 6 accessories, 6 habitats, 4 motion timings, 3 eras |

SVG is the on-chain file format. The geometry is drawn on an integer pixel grid with crisp edges. CSS animation in SVG works in the browser gallery; marketplace thumbnail and animation support must be checked against an actual mint before claiming compatibility.

Collection naming and edition rules are in `contracts/config/COLLECTIONS.md`. Confirm `name()`, `symbol()`, `COLLECTION_ID()`, `COLLECTION_VERSION()`, `contractURI()`, and stored token metadata match the selected edition after deployment. Earlier testnet deployments retain their original identity; this source revision does not rename them. A future collection needs its own explicit identity and deployment, not a repurposed robot contract.

## Prepare

1. Confirm the user's target chain and launch parameters. Do not infer them from the inspiration tweet.
2. Run `forge test --match-contract TinyFrensNFTTest` and `forge build`.
3. Review the robot-only preview at `web/gallery.html` and sample media from `node scripts/generate-permutations.mjs`.
4. Check full-size images, thumbnail silhouettes, all four motion timings, reduced-motion behavior, rare palette contrast, and accessory clipping.
5. Obtain explicit approval of final art and transaction costs before any deployment, premint, or paid action.

## Testnet rehearsal

Use `contracts/testnet/script/DeployTinyFrensNFT.s.sol` and the instructions in `contracts/testnet/TESTNET-POWERSHELL.md`. That script can mint the creator reserve during deployment; set `MINT_CREATOR_RESERVE=0` to skip it. Record the actual contract address and transaction hashes. The server needs `TINYFRENS_NFT_ADDRESS` and `BASE_RPC_URL` for gallery on-chain mode.

Inspect `tokenURI(1)`, `tokenURI(888)`, `tokenURI(889)`, and `tokenURI(1777)`, robot pixel art, metadata attributes, and the animation in a browser. Test mint, transfer, rename, evolve, Net Storage sync, and a full wallet-limit boundary. Do not claim marketplace animation based on a local SVG preview.

## Mainnet launch

Only after the rehearsal and owner approval, deploy and verify the compiled repository contract on the agreed chain. The collection posts mint and transfer events through Net Protocol. A fresh deployment is required for this robot-only assignment; previously deployed contracts cannot be changed by editing these source files. Record deployment address, explorer verification, mint transaction receipts, resolved metadata, and marketplace rendering.

## Hood Turtles featured access

The Wallet tab asks for one read-only EIP-191 signature to link the user's own public address and remembers it for later NFT scans; it does not create a fren wallet. Hood Turtles at `0xca28587b61eac19a87dfcfd9420870867a916675` on Robinhood Chain (chain ID 4663) is the first supported external collection. `web/hood-turtles.html` loads the original on-chain artwork only while the linked wallet currently owns that token. The relay derives the wallet from the signed link, not a client-provided address. There is no certificate, mint, transfer, approval, or gas for this featured display. Access is app-level and ends when ownership changes or the wallet is unlinked. This display is currently web-stage-only, not desktop/Android floating-pet integration.

Before launch, test wallet linking, Hood Turtle discovery, load, transfer invalidation, wallet unlinking, and linking a different wallet with a real token. `ROBINHOOD_RPC_URL` optionally overrides the official RPC. The contract source need not be deployed or verified for this app-level integration.
