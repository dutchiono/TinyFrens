---
name: tinyfrens-robots-v1
description: "Launch TinyFrens: Robots v1 once, or mint robots on demand from its verified deployment, using the user's Bankr wallet and Net Protocol storage."
metadata: {"bankr":{"emoji":"🤖"}}
---

# TinyFrens: Robots v1

Public skill: `https://www.tinyfrens.lol/robots/skill.md`. Artwork preview: `https://www.tinyfrens.lol/web/robot-preview.html`.

**Status: artwork/source preview; the current Robots v1 revision has no verified mainnet deployment yet.** Do not mint against an older testnet address or describe this edition as live. Publishing this skill does not deploy the collection or register it automatically with Bankr. An end-to-end Bankr launch/mint has not yet been verified.

Repository: `https://github.com/dutchiono/TinyFrens`, current review branch `codex/robot-art-refinement`, PR #11. Resolve and record the exact reviewed commit before compiling; do not silently substitute older main-branch artwork. Compilation requires Foundry. Use the host agent's authenticated Bankr contract-deployment/transaction tools to sign and submit; never ask a user to paste a private key. If compilation or arbitrary contract calls are unavailable, explain the missing capability instead of substituting Bankr's fungible-token launcher.

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
| Creator reserve | Optional 20; no purchase price, but mint/storage gas still applies |
| Art | On-chain 128×128 pixel scene with integer-grid character tiles, animated body and alternating feet |
| Traits | 8 palettes, 4 expressions, 6 accessories, 6 habitats, 4 walk timings, 3 eras; eight separate environmental motion traits with four variants each |

## Minting model

Deploy the sprite renderer, art renderer and NFT collection once. Do not mint all 2,664 NFTs during launch. Skip preminting unless the owner asks for creator-reserve tokens; use `MINT_CREATOR_RESERVE=0` when using the repository deployment script. New NFTs are created when a customer requests a mint, up to the supply/wallet caps. Their SVG and metadata are written to Net Storage during that transaction. Animation and viewing need no recurring blockchain transactions.

## Mint a robot after launch

1. Use the edition's verified deployment address and chain supplied by the owner after launch. Until one is published here, do not invent an address or reuse historical deployments.
2. Read `name()`, `symbol()`, `COLLECTION_ID()`, `COLLECTION_VERSION()`, `price()`, `maxSupply()`, `totalSupply()` and `maxMintsPerWallet()`. Confirm Robots v1 and the requested chain. Check mint capacity with simulation; burned NFTs do not restore the total-minted cap or wallet allowance.
3. For a standard mint, call `mint(uint256 amount)` from the user's authenticated Bankr EVM wallet, with `value = amount * price()`. One robot currently costs 1,000,000,000,000,000 wei (0.001 ETH), plus gas. The NFT goes to the calling wallet. No FRENS transfer/approval or vault deposit is required for this route. Estimate current fees; do not promise a fixed gas price.
4. A user's explicit request to mint the stated quantity at the disclosed price authorizes that purchase, subject to Bankr's normal transaction confirmation. Do not interpret a request to preview, connect a wallet, or read this skill as a mint request.
5. Confirm the receipt, Transfer token IDs, `ownerOf()` and stored `tokenURI()`. On timeout, inspect the original transaction before retrying so the user is not charged for duplicate mints. Report the actual transaction and token IDs, not local preview output.
6. For importing supported NFTs to a device, use `https://www.tinyfrens.lol/import/skill.md`. Minting does not itself pair a phone or prove that this edition has been enabled in the companion collection registry.

SVG is the on-chain file format. The geometry is drawn on an integer pixel grid with crisp edges. CSS animation in SVG works in the browser gallery; marketplace thumbnail and animation support must be checked against an actual mint before claiming compatibility.

Collection naming and edition rules are in `contracts/config/COLLECTIONS.md`. Confirm `name()`, `symbol()`, `COLLECTION_ID()`, `COLLECTION_VERSION()`, `contractURI()`, and stored token metadata match the selected edition after deployment. Earlier testnet deployments retain their original identity; this source revision does not rename them. A future collection needs its own explicit identity and deployment, not a repurposed robot contract.

## Prepare

1. Confirm the user's target chain and launch parameters. Do not infer them from the inspiration tweet.
2. Run `forge test --match-contract 'TinyFrens(Art|NFT)Test'`, `node --test scripts/test-nft-art.mjs` and `forge build`.
3. Review the robot-only preview at `web/gallery.html` and sample media from `node scripts/generate-permutations.mjs`.
4. Check full-size images, thumbnail silhouettes, all four motion timings, reduced-motion behavior, rare palette contrast, and accessory clipping.
5. Obtain explicit approval of final art and transaction costs before any deployment, premint, or paid action.

## Testnet rehearsal

Use `contracts/testnet/script/DeployTinyFrensNFT.s.sol` and the instructions in `contracts/testnet/TESTNET-POWERSHELL.md`. That script can mint the creator reserve during deployment; set `MINT_CREATOR_RESERVE=0` to skip it. Record the actual contract address and transaction hashes. The server needs `TINYFRENS_NFT_ADDRESS` and `BASE_RPC_URL` for gallery on-chain mode.

Inspect `tokenURI(1)`, `tokenURI(888)`, `tokenURI(889)`, and `tokenURI(1777)`, robot pixel art, metadata attributes, and the animation in a browser. Test mint, transfer, rename, evolve, Net Storage sync, and a full wallet-limit boundary. Do not claim marketplace animation based on a local SVG preview.

## Mainnet launch

Only after the rehearsal and owner approval, deploy and verify the compiled repository contract on the agreed chain. The collection posts mint and transfer events through Net Protocol. A fresh deployment is required for this robot-only assignment; previously deployed contracts cannot be changed by editing these source files. Record deployment address, explorer verification, mint transaction receipts, resolved metadata, and marketplace rendering.
