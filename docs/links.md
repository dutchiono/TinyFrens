# TinyFrens links & Mini App URLs

One place that lists every public URL TinyFrens uses, so all pages, manifests, and bots
stay in sync. If you change a URL, change it here **and** in the files listed.

## Canonical links

| What | URL |
|---|---|
| Website / welcome page | https://tinyfrens.lol |
| Web pet app | https://tinyfrens.lol/web/ |
| Telegram bot | https://t.me/TinyFrensBot |
| Farcaster profile | https://farcaster.xyz/tinyfrens |
| X / Twitter | https://x.com/TinyFrens_ |
| GitHub | https://github.com/dutchiono/TinyFrens |
| Email | Tinyfrens@agentmail.to |

## Mini App / embed URLs

| Surface | URL used | Where it's set |
|---|---|---|
| **Farcaster Mini App** (launch target) | `https://tinyfrens.lol/` | `web/index.html` + `site/index.html` + root `index.html` `fc:miniapp` / `fc:frame` meta; `web/.well-known/farcaster.json` `homeUrl` |
| **Telegram Mini App** (launch target) | `https://tinyfrens.lol/web/` | server env `TELEGRAM_MINIAPP_URL`; bot menu button |
| **Farcaster Snap** (in-feed) | `https://tinyfrens.lol/snap` (Snap v2.0) | `<link rel="alternate" ... vnd.farcaster.snap+json>`; served by the relay `/api/snap` |
| **Relay server** (API + auth + rooms) | `https://tinyfrens.miono.live` | `web/social-config.js` (`TINYFRENS_SERVER`), Snap button targets, `vercel.json` rewrites |

### How the entry URLs relate
- The **root** `https://tinyfrens.lol/` is the welcome page. Its inline script detects an
  iframe / Farcaster context and redirects into `web/`, so the Farcaster Mini App lands in
  the actual pet app.
- **`/web/`** is the real pet UI (also used directly by the Telegram Mini App).
- **`/snap`** returns the Farcaster Snap v2.0 JSON (content-negotiated) with Pet/Feed/Play
  buttons and an "Open Mini App" button.

> Rule of thumb: Farcaster points at the **root** (which forwards to the app); Telegram
> points **directly at `/web/`**. Both end up in the same pet app.

## Social handles

- Telegram: `@TinyFrensBot`
- Farcaster: `tinyfrens` → https://farcaster.xyz/tinyfrens
- X: `@TinyFrens_`

## Files to update when a URL changes

- `index.html` (root), `site/index.html`, `web/index.html` — `fc:miniapp`, `fc:frame`,
  `og:*`, and footers.
- `web/.well-known/farcaster.json` — Farcaster manifest `homeUrl`/`iconUrl`/`imageUrl`.
- `web/snap-v2.json` and the relay's `make_snap_payload` in `server/app.py` — Snap targets.
- `web/social-config.js` — `TINYFRENS_SERVER`.
- Server env — `TELEGRAM_MINIAPP_URL`, `TELEGRAM_BOT_TOKEN`.
- Docs — `docs/README.md`, `docs/telegram.md`, `docs/discord.md`, `README.md`.
