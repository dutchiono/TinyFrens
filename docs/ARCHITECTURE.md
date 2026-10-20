# Architecture

TinyFrens is a cross-platform floating pet + social app with on-chain ownership checks and Net-based storage.

## High-level diagram

```
[User wallet/NFT] -> (on-chain check) -> [TinyFrens app]
                              |-> Web/PWA (web/)
                              |-> Telegram Mini App
                              |-> Android overlay (android/)
                              |-> Desktop (desktop/)
                              |-> iOS shell+widget (ios/)
                                        |-> Server (party/relay)
                                        |-> Net Protocol (storage)
                                        |-> Contracts (on-chain)
```

## Frontend layers

- **Web app (`web/`)**: Core UI, pet rendering, care actions, visits/party UI, wallet integration, sync logic. Shared across web/Telegram/Farcaster contexts.
- **Navigation**: `web/navigation.js` + `web/navigation.css` provide consistent nav (Frens/Care/Plaza/Games + Community: Gallery/Vote/Updates/Tokenomics/Help/Docs/Get the app; Account lives in the header account button).
- **Site landing (`site/`)**: Marketing/homepage (`index.html`).
- **Platform shells**: Android (Kotlin overlay), Electron desktop, iOS (Swift + widget). All consume shared web logic where possible.

## Backend/services

- **Server (`server/`)**: aiohttp app for live friends, party rooms, relay, chat, Bankr integration, Telegram/Discord hooks. Handles presence/rooms.
- **Live sync**: Party state, visits, and presence kept in sync via server; device-local care state persists per device.
- **Integrations**: Telegram Bot (`server/telegram_bot.py`), Discord integration (planned/partial), Bankr connection flow.

## On-chain

- **Contracts (`contracts/`)**: Custom Solidity (Foundry). Ownership verification, FRENS economy (Treasury/JackpotVault/DepositRouter/CollectionVote), Net integration via `NetIntegratedERC721A`.
- **Ownership checks**: Connection rechecks ownership; renewed every 24 hours while active. Selling NFT expires display after next check.
- **Testnet**: Full testnet scripts/rehearsals under `contracts/testnet/`.

## Storage

- **Net Protocol**: Content-addressed storage for metadata/media (see [Storage](STORAGE.md)). Token URIs point to Net content.
- **Assets**: Sprites, previews, robot scenes (`web/robot-*.mjs`), PIP videos live under `web/`.

## Data flow (ownership)

1. User connects wallet (Bankr or direct) -> signs read-only message.
2. App reads token ownership for supported collections.
3. If owned, loads Fren data (sprites/metadata) from Net-based references.
4. Care/visits run locally+server; ownership revalidated periodically.

## Security/UX notes

- Read-only signatures only (no transfers/approvals/gas).
- Device credentials stay on device; linked accounts sync non-privileged settings.
- Saves local-first; clearing app data can remove local save.

For detailed dev setup, see [DEVELOPER.md](DEVELOPER.md). For server ops, see [server/README.md](../server/README.md).
