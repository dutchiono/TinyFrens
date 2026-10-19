# TinyFrens Desktop

TinyFrens is a floating Electron companion for Windows and macOS. The desktop
process lives in `desktop/`; its packaged renderer lives in `web/` and is copied
into the application by `desktop/prepare.cjs`.

## Develop

Node.js 24 is required.

```sh
cd desktop
npm ci
npm run prepare-assets
npm test
npm start
```

Build installers on the target operating system:

```sh
npm run dist -- --win --x64
npm run dist -- --mac --arm64
npm run dist -- --mac --x64
```

See [desktop/README.md](desktop/README.md) for installation, controls, security,
updates, and smoke-test details. Windows signing is documented in
[docs/WINDOWS-SIGNING.md](docs/WINDOWS-SIGNING.md).

Some account, wallet, social, and NFT screens use the separately hosted
TinyFrens API. The API is not part of this desktop-only repository.

MIT licensed.
