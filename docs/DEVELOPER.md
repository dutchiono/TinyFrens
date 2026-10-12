# TinyFrens developer guide

A practical overview of how TinyFrens is put together and how to work on it. This
replaces the old root `DEVELOPER.md`, which described an early prototype and is now out
of date.

## What TinyFrens is

A pocket pet that follows you across platforms:

- **Android** — a real floating overlay (Kotlin `TYPE_APPLICATION_OVERLAY`).
- **Desktop** (Windows/Mac) — a transparent always-on-top window (Electron).
- **Web / iOS** — an installable PWA / native shell.
- **Telegram** — a Mini App inside the Telegram client (bot + signed `initData` auth).
- **Farcaster** — a Mini App + in-feed Snap.

All of them share **one pet UI** in `web/` and one **relay server** in `server/` for
multiplayer "party rooms," chat, wallets, and platform auth.

## Repository map

| Path | What it is | Stack |
|---|---|---|
| `web/` | The shared pet UI. Runs as a PWA **and** inside Telegram/Farcaster. | Vanilla JS + CSS |
| `server/` | Live relay: friends, party rooms, chat, Bankr wallet, Telegram/Discord, FRENS economy | Python + aiohttp + SQLite |
| `android/` | Native floating-overlay pet | Kotlin |
| `desktop/` | Windows/Mac floating pet | Electron |
| `ios/` | Native iOS shell + WidgetKit widget | Swift |
| `site/` | Welcome / marketing page | Static HTML |
| `snap/` | Farcaster in-feed Snap (2.0) | TypeScript + Hono |
| `contracts/` | On-chain FRENS economy | Solidity + Foundry |
| `scripts/` | Build + signing helpers (site build, Farcaster signer, videos, testnet) | Node / Python |
| `docs/` | Documentation (you are here) | Markdown |

## The pet model (the important bit)

Every surface renders the **same** pet from a small JSON state:

```jsonc
{
  "name": "Tofu",
  "shape": "bunny",        // cat, blob, robot, bunny, dog, bear, frog, turtle
  "color": "#a474f1",      // any #rrggbb
  "expression": "happy",   // happy, wink, shades, star_eyes
  "accessory": "none",     // none, party_hat, crown, halo, bow_tie, orb
  "hunger": 80, "happiness": 80, "energy": 80,
  "born": 1690000000000, "mode": "roam"
}
```

- `web/app.js` owns care logic (Feed/Play/Nap) and decay.
- `web/customize.js` owns looks and maps the state onto the `#pet` CSS sprite
  (`data-shape`, `data-expression`, `data-accessory`, `--pet-color`).
- On native/desktop, state lives in the host (`PetAndroid.*` / `window.TinyFrensDesktop`);
  on web it's `localStorage` under `pocket-familiar-v1`.

**Rule of thumb:** if you add a care action or look, it must work the same on every
platform or be explicitly gated. Game rules live in [`GAMEPLAY.md`](../GAMEPLAY.md).

## Multiplayer: the relay server

`server/app.py` is a single-process **aiohttp** app with a SQLite DB. It provides:

- **Identity** — each install gets an opaque `{id, token, code}` credential (token stored
  only as a SHA-256 hash). Telegram/Discord auth returns this *same* identity.
- **Friends** — code-based add with consent.
- **Visits** — consented, expiring guest appearances (never take over the host's pet).
- **Party rooms** — `public`, `private:CODE`, or `chat` (`tg:<id>` / `dc:<id>`).
- **Chat** — optional Gemini-backed pet replies (`/api/chat`).
- **Bankr** — server-side wallet bridge (keys never ship to clients).
- **Telegram / Discord** — Mini App auth + bot webhook + Activity interactions.

Run it locally:

```sh
cd server
pip install -r requirements.txt
python -m unittest discover -s . -v   # 27 tests
python app.py                          # listens on $PORT (default 8080)
```

Config is via environment variables — see [`server/.env.example`](../server/.env.example).
Deployment notes (systemd + nginx, as used on the live `miono` host) are in
[`server/README.md`](../server/README.md).

## Platform adapters (web)

When `web/` loads inside a host, a small adapter detects it and wires identity + rooms:

- `web/telegram.js` — Telegram Mini App (`window.Telegram.WebApp`), signs in via
  `/api/telegram/auth`, auto-joins the group room.
- `web/discord.js` — Discord Activity (Embedded App SDK), OAuth handshake, channel room.
- `web/farcaster.js` — Farcaster Mini App / Snap.
- `web/companion.js` — the draggable in-app "hover" buddy (Telegram/Discord only; a real
  OS overlay is impossible inside those sandboxed iframes — see
  [`TELEGRAM-DISCORD.md`](../TELEGRAM-DISCORD.md)).

`web/friends.js` is the WebSocket client; `web/party.js` renders rooms and exposes
`window.TinyFrensParty.joinChat/joinPublic/joinPrivate`.

## Building & deploying

- **Site + web app:** `node scripts/build-site.mjs` copies `site/`, `web/`, `play/`, icons
  and manifests into `dist/` for Vercel. See [`VERCEL.md`](../VERCEL.md).
- **Android:** Gradle (Kotlin). CI in `.github/workflows/android.yml`.
- **Desktop:** `cd desktop && npm run dist` (electron-builder). CI in `desktop.yml`.
- **iOS:** Xcode project; CI in `ios.yml`.
- **Pages welcome site:** `.github/workflows/pages.yml`.
- **Server:** `.github/workflows/server.yml` (tests/build).

## Conventions

- **Secrets never ship to clients.** API keys (Bankr, Gemini, Neynar, Telegram, Discord)
  live only in server env / `.env` (git-ignored). The web app only ever holds public URLs.
- **Consent first.** Friends, visits, and shared rooms all require explicit acceptance.
  Guests never modify the host's saved pet.
- **Same rules everywhere.** Care costs/caps are defined once and mirrored; flavour
  actions (Wave/Dance/Toy) never grant extra rewards.
- **Tests:** server tests are `unittest`; desktop tests are `node --test`. Add tests for
  new relay behaviour.

## First tasks for a new contributor

1. Read [`GAMEPLAY.md`](../GAMEPLAY.md) and [`ROADMAP.md`](../ROADMAP.md).
2. Run the server tests: `cd server && python -m unittest discover -s . -v`.
3. Serve `web/` locally (`python -m http.server` from `web/`) and open it.
4. Pick a ⬜ item from [`TELEGRAM-DISCORD.md`](../TELEGRAM-DISCORD.md) or `ROADMAP.md`.
