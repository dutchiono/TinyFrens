---
name: tinyfrens-robots-v1
description: "Mint TinyFrens: Robots v1 NFTs from the live Base collection using Bankr."
metadata: {"bankr":{"emoji":"🤖"}}
---

# TinyFrens: Robots v1

Skill: https://www.tinyfrens.lol/robots/skill.md
Compiled package manifest: https://www.tinyfrens.lol/robots/launch/manifest.json

**Status: live on Base (chain 8453).**
NFT contract: `0xd745d8005a1ad8f783b97bf55e0d0e6a920ea8ff`
Art renderer: `0x45ad3ea421fea0dab3878be03b2209c8952f4dce`
Live minted gallery: https://www.tinyfrens.lol/web/gallery.html

The deployed contract was read on Base to confirm name, symbol, collection ID/version, price, supply cap, wallet limit, creator and art renderer. Mint from this existing deployment; do not launch another collection. Reading this skill does not authorize spending.

## Collection and minting model

| Parameter | Value |
|---|---|
| Name / symbol | TinyFrens: Robots v1 / TFROB1 |
| Collection ID / version | tinyfrens-robots-v1 / 1 |
| Supply | 2,664 robots, three 888-token eras |
| Public price / wallet limit | 0.001 ETH each / 20 |
| Optional creator reserve | 20; no purchase price, but gas and storage still cost |
| Art | Animated 128×128 SVG pixel scenes with independent movement traits |

Deploy once; customers mint on demand. Do not mint all 2,664 during launch. Mint transactions write artwork and metadata to Net Storage. Viewing and animation need no recurring transaction. Creator reserve uses `mintToCreator(uint256 amount,address to)` from `creator()`; never assume the factory is the creator.

## Mint after a verified launch

Use **Base (8453), NFT contract `0xd745d8005a1ad8f783b97bf55e0d0e6a920ea8ff`**. Do not use historical testnet contracts or the art renderer as a mint target.

1. Confirm the edition identity and read price, supply, wallet allowance and requested quantity from the verified deployment. Burned NFTs do not restore total-minted caps or wallet allowance.
2. Call `mint(uint256 amount)` from the customer's Bankr wallet. NFT recipient is the caller. No FRENS transfer/approval or vault deposit is required.
3. **Bankr agent native amounts use whole ETH units**: one robot attaches `0.001` ETH, plus gas. **Wallet REST `/wallet/submit` uses wei**: the same attachment is `1000000000000000`. Never pass a wei amount as the agent's whole-unit value. Explicitly state the ETH amount when asking Bankr to submit.
4. Disclose quantity, price and current fees before purchase. Confirm receipt, Transfer IDs, `ownerOf()` and stored `tokenURI()`. Inspect a pending hash before retrying.
5. To pair/import onto a device, use https://www.tinyfrens.lol/import/skill.md. Robots v1 is supported for companion import. Minting does not pair a device; link the minting wallet on the destination device, refresh My NFTs, then choose Show companion. Native Android and desktop require the robot-support update.

Browser SVG animation works in the gallery. Wallet thumbnails/marketplace animation have not been confirmed for this revision. Future collections need their own identities and deployments.

## Maintainer preparation (outside Bankr)

Build with `node scripts/package-robots-launch.mjs` after local Foundry installation (`FORGE_BIN` may specify its path). Validate with `node scripts/package-robots-launch.mjs --check`, targeted Foundry tests, and the local-only `RehearseBankrPackage` Base fork script. No private key or broadcast is needed for these checks. Keep the hosted bytecode and source hashes synchronized: the maintainer `--check` rejects stale source, and the site build verifies published package hashes.
