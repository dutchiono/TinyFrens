# TinyFrens collections

TinyFrens is the app and umbrella brand. Each NFT collection is a distinct series and edition.

| Field | First planned robot edition |
| --- | --- |
| Collection name | TinyFrens: Robots v1 |
| Symbol | TFROB1 |
| Stable editorial ID | tinyfrens-robots-v1 |
| Series / Edition traits | Robots / v1 |
| Default token name | TinyFrens Robot v1 #1 |

`web/robot-collection.mjs` defines the browser/export identity. Matching constants in `contracts/TinyFrensNFT.sol` define the next deployment's immutable identity. Tests reject differences. The contract provides collection-level `contractURI()` metadata and includes Series/Edition traits even when an owner renames their robot.

## Naming and version rules

- Use `TinyFrens: <Series> v<Edition>` for collection names. New series start at v1 independently.
- An edition identifies an NFT release, not an app release or every prelaunch artwork adjustment. Freeze its identity, supply, trait rules and renderer when approving deployment.
- A later NFT edition gets a new editorial ID, symbol and contract address. Never overwrite an earlier edition's deployment record or make its gallery show a later edition's artwork.
- Testnet rehearsals and mainnet releases have separate deployment records and visible network labels, even when they rehearse the same planned edition name.
- NFT ownership identity is `(chain ID, contract address, token ID)`. Token number, symbol, display name and editorial ID alone are insufficient. Companion renderers and collection support must resolve the chain/contract to the correct collection-specific rules.
- Keep collection identity separate from the FRENS fungible token. Changing robot collection names does not rename FRENS, the app, or supported third-party NFT collections.

## Historical testnet record

`testnet-nft.json` records the already-deployed robot rehearsal at `0x091FB40292925E822849BA415599939eec078b62` on Base Sepolia (84532). Its actual on-chain name is `TinyFrens`, symbol `FREN`, and default token names are `TinyFren #<id>`. The live testnet gallery is a snapshot of that deployment, not the Robots v1 preview. Preserve those facts; source edits cannot rename or replace its immutable renderer.

For each future release, record the series/edition, network/chain, NFT address, renderer addresses, source commit, deployment transaction and verification results before marking it live. No mainnet Robots v1 deployment is recorded yet.
