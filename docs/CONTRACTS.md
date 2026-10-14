# Custom Contracts

TinyFrens uses a mix of custom Solidity contracts (Foundry) to power ownership checks, asset references, and on-chain features. All contracts live under `contracts/`.

## Key contracts

| Contract | Purpose |
|---|---|
| `TinyFrensNFT.sol` | Core NFT contract for TinyFrens collections/NFTs. Handles minting/ownership logic and token URI references. |
| `TinyFrensArt.sol` | Art/metadata-related logic for TinyFrens assets. |
| `TinyFrensSprite.sol` | Sprite/animation asset references for companion rendering. |
| `NetIntegratedERC721A.sol` | ERC721A variant with Net Protocol integration. Extends ERC721A to work with Net-based URIs/asset references. |
| `testnet/*` | Testnet deployment scripts, rehearsals, and test tokens (`TestFRENS`, etc.). |
| `test/*` | Foundry tests covering Treasury, JackpotVault, DepositRouter, CollectionVote, etc. |

## Net integration

- **NetIntegratedERC721A**: Custom extension integrating with Net Protocol for token URIs/asset resolution. This keeps media/metadata references verifiable and content-addressed.
- **Storage alignment**: Token URIs point to Net-stored JSON/ media (see [Storage](STORAGE.md)).
- **Custom vs standard**: Using custom contracts lets us tightly couple Net references and TinyFrens-specific behavior while leveraging ERC721A where appropriate.

## On-chain economy

TinyFrens also has on-chain FRENS economy components (Treasury, JackpotVault, DepositRouter, CollectionVote, testnet tokens). See [ONCHAIN-ECONOMY.md](../ONCHAIN-ECONOMY.md) for economic design and [GAMEPLAY.md](../GAMEPLAY.md) for how it intersects with care/gameplay.

## Building/testing

- Foundry (`foundry.toml`): build/test via `forge build`, `forge test`.
- Testnet scripts in `contracts/testnet/script/` for rehearsals/deploys.
- Verification artifacts in `web/robots-launch/*.json` for published contracts.

For deployment details (networks, verification), see [Deployment](DEPLOYMENT.md). For deep dev workflow, see [DEVELOPER.md](DEVELOPER.md).
