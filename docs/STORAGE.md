# Storage (Net Protocol)

All TinyFrens assets and metadata are stored using the **Net Protocol** — decentralized, content-addressed storage.

## What this means

- **Content-addressed**: Each file (image, animation, JSON metadata) is identified by a cryptographic hash (CID). If content changes, the CID changes.
- **Verifiable**: Anyone can fetch by CID and verify it matches what was referenced.
- **Portable**: No single centralized host owns the content reference; retrieval works via Net gateways.
- **Resilient**: Content-addressing reduces reliance on any one origin server.

## How TinyFrens uses it

- **Token metadata &amp; media**: NFT token URIs and associated media point to content stored via Net Protocol.
- **Collection assets**: Sprites, previews, and related media are referenced via Net CIDs where applicable.
- **Decoupled from app host**: Assets persist independent of tinyfrens.lol hosting changes.
- **Long-term accessibility**: Using content addressing helps keep Fren assets accessible over time.

## Retrieval

- Token URIs resolve to Net content (JSON). That JSON references media (images/animations) via Net references.
- Clients fetch via Net gateways; exact gateway configuration is handled in-app where needed.

## Why Net Protocol

We chose Net Protocol to keep ownership-aligned asset references verifiable and portable. This matches TinyFrens' goal: your NFT's art/metadata stays tied to verifiable content, not just a mutable HTTP endpoint.

For contract-level details on how URIs are structured, see [Contracts](CONTRACTS.md).
