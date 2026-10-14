# Deployment

## Contracts (Foundry)

- **Build**: `forge build`
- **Test**: `forge test`
- **Config**: `foundry.toml`
- **Contracts**: `contracts/*.sol`, tests `contracts/test/*.t.sol`
- **Testnet**: Scripts in `contracts/testnet/script/` (DeployTinyFrensNFT, DeployTestFRENS, DeployEconomy, etc.). See `contracts/testnet/README.md` and `contracts/testnet/TESTNET-POWERSHELL.md`.
- **Broadcasts**: `broadcast/` contains deployment artifacts.

## Web/app hosting

- **Landing/site**: Static files in `site/` + root `index.html`. Can deploy to Vercel/GitHub Pages (see [VERCEL.md](../VERCEL.md), [GITHUB_SETUP.md](../GITHUB_SETUP.md)).
- **Web app**: `web/` is PWA; served from same origin or subpaths.
- **Docs**: `docs/` is static markdown. Intended to be served at `docs.tinyfrens.lol` (GitHub Pages/Cloudflare Pages).

## Server deployment

- **Server**: `server/` (aiohttp). See [server/README.md](../server/README.md) for setup/env/Bankr/Telegram.
- **Integrations**: Telegram bot, Discord (partial), relay for party/visits.

## Mobile/desktop builds

- **Android**: `android/` (Kotlin). APKs published via GitHub Releases.
- **Desktop**: `desktop/` (Electron). Windows/Mac builds published.
- **iOS**: `ios/` (Swift shell + widget). Home-screen/PWA path primary now; App Store later.

## Verification

- Verification JSON/artifacts under `web/robots-launch/` for published contracts (ABI/bytecode/verification).
- Foundry verification flows as per testnet docs.

## Env/config

- Server needs keys for Telegram/Discord/relay. Never commit secrets.
- Contract deploys use Foundry keystore/ledger as appropriate.

For local dev, see [DEVELOPER.md](DEVELOPER.md).
