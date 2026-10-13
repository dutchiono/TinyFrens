---
name: tinyfrens-robots-v1
description: "Prepare a TinyFrens: Robots v1 NFT launch using compiled bytecode and Bankr contract tools, or mint from its published verified deployment."
metadata: {"bankr":{"emoji":"🤖"}}
---

# TinyFrens: Robots v1

Skill: https://www.tinyfrens.lol/robots/skill.md
Art preview: https://www.tinyfrens.lol/web/robot-preview.html
Compiled package manifest: https://www.tinyfrens.lol/robots/launch/manifest.json

**Status: compiled launch candidate, not deployed. Bankr execution remains unverified.** No current mainnet address exists for this revision. Do not use historical testnet addresses. Reading this skill does not authorize a deployment or purchase.

## Use Bankr's actual capabilities

Bankr documents custom deployment from **compiled creation bytecode in Bankr Files**, using its CREATE2 deployment tool. This skill supplies those bytes; **Bankr does not need Foundry, Solidity compilation, a local checkout, or shell access**.

First check whether this session exposes custom-bytecode deployment and can access the package files. A website skill alone does not grant tools. If unavailable, report exactly that limitation and stop before spending; do not replace these NFTs with a fungible token or standard NFT template. Do not invent a deployment API or factory address.

Official references:
- https://github.com/BankrBot/skills/blob/main/bankr/references/arbitrary-transaction.md
- https://docs.bankr.bot/agent/files/

The documented file ingestion route is the Bankr website's Files panel upload (or `bankr files upload` from an authenticated local CLI). Download the files below and upload them if this session cannot import them using an available tool. **Automatic URL-to-Files ingestion and custom deployment from X have not been verified.** Do not promise that a tweet alone completes launch.

## Compiled files

All files are under https://www.tinyfrens.lol/robots/launch/:

| Order | Creation bytecode | Constructor arguments |
|---|---|---|
| 1 | [TinyFrensSprite.bytecode.txt](https://www.tinyfrens.lol/robots/launch/TinyFrensSprite.bytecode.txt) | None |
| 2 | [TinyFrensArt.bytecode.txt](https://www.tinyfrens.lol/robots/launch/TinyFrensArt.bytecode.txt) | `address spriteRenderer_`: confirmed address from step 1 |
| 3 | [TinyFrensNFT.bytecode.txt](https://www.tinyfrens.lol/robots/launch/TinyFrensNFT.bytecode.txt) | `address artRenderer_`: confirmed address from step 2; `address creator_`: authenticated launch owner's wallet |

Each contract also has `<Contract>.abi.json` and `<Contract>.verification.json` (Solidity standard JSON input). Manifest lists SHA-256 hashes, exact source hashes, compiler/settings, byte sizes, and constructor schemas. Bytecode files contain creation code **without appended constructor arguments**. Supply ABI-encoded constructor arguments exactly once using Bankr's tool. `NetIntegratedERC721A` is abstract and already included in NFT bytecode; it is not a fourth deployment.

Compiler: `0.8.28+commit.7893614a`, optimizer 200 runs, viaIR, Cancun. Sources and pinned dependencies are embedded in verification inputs. Review PR: https://github.com/dutchiono/TinyFrens/pull/11. The source base commit in the manifest may precede the package commit; embedded source bytes/hashes identify the actual compiled revision.

## Launch once

1. Confirm target chain and authenticated creator wallet. This candidate targets **Base, chain 8453**. Check Net Protocol code at `0x00000000B24D62781dB359b07880a105cD0b64e6` and Net Storage code at `0x00000000DB40fcB9f4466330982372e27Fd7Bbf5`. Do not silently substitute storage. Base Sepolia support in this Bankr session is not established.
2. Read the manifest, load the three creation-code files into Bankr Files, and validate hashes using an available file tool. Do not reproduce long bytecode through conversational transcription. If file integrity cannot be checked, stop and report it.
3. Prepare three sequential CREATE2 deployments, each with **zero attached ETH**, using the constructors above. Record factory, salts, expected addresses, and estimates from the actual tool. The explicit creator argument prevents the factory from receiving creator permissions or mint revenue. Confirm final art and disclose total current fees; obtain owner approval before submitting. A local generic CREATE2 fork rehearsal is not a live Bankr or testnet deployment.
4. Submit in order, inspect each receipt and deployed code before using its address in the next constructor. A hash means a submission may already exist: inspect it before retrying. Never duplicate a deployment on timeout.
5. Verify each contract using the corresponding standard JSON input, compiler version, fully qualified contract name (`contracts/<Contract>.sol:<Contract>`) and actual constructor arguments. Confirm `creator()` equals the owner's wallet and `artRenderer()`/`spriteRenderer()` match the deployed dependencies.
6. Confirm `name()`, `symbol()`, `COLLECTION_ID()`, `COLLECTION_VERSION()`, `price()`, `maxSupply()` and `maxMintsPerWallet()`. Publish the verified chain, addresses and transaction hashes before enabling mint instructions. No premint unless explicitly requested.

Deployment and marketplace display require live rehearsal/confirmation before describing this edition as launch-ready. Current source was locally tested; Bankr's actual factory and wallet execution still need verification.

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

There is **no verified current deployment address published here yet**. Until one exists, report that the collection has not launched.

1. Confirm the edition identity and read price, supply, wallet allowance and requested quantity from the verified deployment. Burned NFTs do not restore total-minted caps or wallet allowance.
2. Call `mint(uint256 amount)` from the customer's Bankr wallet. NFT recipient is the caller. No FRENS transfer/approval or vault deposit is required.
3. **Bankr agent native amounts use whole ETH units**: one robot attaches `0.001` ETH, plus gas. **Wallet REST `/wallet/submit` uses wei**: the same attachment is `1000000000000000`. Never pass a wei amount as the agent's whole-unit value. Explicitly state the ETH amount when asking Bankr to submit.
4. Disclose quantity, price and current fees before purchase. Confirm receipt, Transfer IDs, `ownerOf()` and stored `tokenURI()`. Inspect a pending hash before retrying.
5. To pair/import onto a device, use https://www.tinyfrens.lol/import/skill.md. Minting does not pair a device or enable a collection in the companion registry.

Browser SVG animation works in the gallery. Wallet thumbnails/marketplace animation have not been confirmed for this revision. Future collections need their own identities and deployments.

## Maintainer preparation (outside Bankr)

Build with `node scripts/package-robots-launch.mjs` after local Foundry installation (`FORGE_BIN` may specify its path). Validate with `node scripts/package-robots-launch.mjs --check`, targeted Foundry tests, and the local-only `RehearseBankrPackage` Base fork script. No private key or broadcast is needed for these checks. Keep the hosted bytecode and source hashes synchronized: the maintainer `--check` rejects stale source, and the site build verifies published package hashes.
