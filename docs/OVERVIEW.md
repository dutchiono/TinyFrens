# Overview

TinyFrens brings your NFTs out into the world as living companions. They're tamagotchi-like pets that float on your phone, desktop, or in the web app — with care, visits, party rooms, and a growing social/RPG experience.

## What are TinyFrens?

- **Living companions**: Each Fren is tied to an NFT you own. They need care (Feed, Play, Nap, Clean, Vitamin) to stay happy and energetic.
- **Cross-platform**: Runs in the web app, Telegram Mini App, Android (floating overlay), desktop (Windows/Mac), and iOS (home-screen app).
- **Social by design**: Visit other frens, join party rooms, and see your friends' companions in shared spaces.
- **On-chain roots**: Ownership is verified on-chain; supported collections include Hood Turtles, Robots v1, The Nubs, and Bots Computers.

## Game vision

TinyFrens started as a floating pet, but the long-term vision is a playful social RPG:

- **Core loop**: Care, growth, mood, and energy drive how your Fren behaves.
- **Social play**: Visits, party rooms, and live presence keep frens connected.
- **Worldbuilding**: Different collections (Robots, Hood Turtles, etc.) each bring their own vibe.
- **Planned RPG elements**: Quests/adventures, items, abilities, and collection-specific stories. See [Game &amp; RPG](GAME.md).
- **Community-first**: Built around the collections and people who own them.

## How it fits together

- **Web UI (`web/`)**: Shared PWA; powers web, Telegram, and Farcaster contexts.
- **Mobile/Desktop**: Native Android floating overlay, Electron desktop app, iOS shell + widget.
- **Live sync (`server/`)**: Party rooms, live friends, visits, and relay.
- **On-chain (`contracts/`)**: FRENS economy, custom contracts, and ownership checks.
- **Storage (Net Protocol)**: All assets/metadata live via [Net Protocol](STORAGE.md) — content-addressed and verifiable.
- **Custom contracts**: TinyFrens integrates with custom contracts to support its features; see [Contracts](CONTRACTS.md).

For players, start with [How To](HOW-TO.md) or [FAQ](FAQ.md). For devs, see [Architecture](ARCHITECTURE.md) and [Developer Guide](DEVELOPER.md).
