# TinyFrens live friends server

Ready to deploy later. The app remains usable without this service; live Friends shows a setup message until connected. This is a single-process relay with a persistent SQLite database, not a demo or a public shared relay.

## Deploy on your server

1. Create a DNS A/AAAA record such as `pets.example.com` pointing to your server. Install Docker with Compose.
2. Copy this `server/` directory there. Copy `.env.example` to `.env` and set `PET_DOMAIN` to that hostname (no `https://`). Open inbound TCP ports 80 and 443.
3. Run `docker compose up -d --build`. Caddy gets an HTTPS certificate and forwards HTTP and WebSocket traffic. Check `https://pets.example.com/health` for `{"ok":true}`.
4. On each phone: **Settings → Friends server setup → Server address**, enter `https://pets.example.com` and tap **Connect**. Or set that URL in `web/social-config.js` and rebuild once to supply the default to all installs.
5. Swap the eight-character friend codes. **Add friend → Accept** on the other phone. With both apps open, **Ask to visit → Let them visit**. Wave/Dance synchronize, changes to the visiting pet's name/look appear on the host, and either person can end the visit.

No Apple developer membership, external account provider, or paid hosted service is required for this relay. Native app installation/signing requirements remain separate.

## Behavior and storage

- Each app installation generates an opaque 256-bit device credential; only its SHA-256 hash is stored on the server. WebSocket authentication sends it as a first encrypted message, never a URL query parameter. Do not share it.
- Codes are permanent on the configured server while device credentials and database survive. Renaming/changing looks does not change a code. Clearing app/browser data loses identity; switching server creates a separate identity. There is no account recovery yet.
- Friendship requires acceptance. Removal is mutual and ends active visits. No arbitrary chat, photos, location, or care-stat modification is sent. Codes can be shared only with people you know; rejected requests do not grant access.
- Friend requests persist across restarts. Presence is based on an authenticated connection. Visits require both connections and consent, expire after 30 minutes, and end on disconnect/restart. Requests expire after 60 seconds.
- The guest is a live display of the sender's pet; it never replaces or owns the host's pet. Core care is performed by the owner with the same Feed/Play/Nap rules. Guest Wave/Dance are cosmetic and give no duplicate rewards.
- This release shows live guests **inside the app/web page**. iOS may suspend connections when backgrounded; it does not enable guests above other apps or put visitors in widgets/PiP. Android's existing overlay continues to show the owner's pet.
- Bluetooth/Wi-Fi/NFC discovery is not included. A native proximity adapter can call `TinyFrensFriends.requestByCode(code)` after explicit discovery and approval. The same server consent flow then applies.

## Pet chat and Bankr

The relay can also answer TinyFren chat requests from the web app. Set `GEMINI_API_KEY` or `GOOGLE_API_KEY` on the server; keys must never be placed in `web/`, Vercel public env, or committed files. Optional `GEMINI_MODEL` defaults to `gemini-2.0-flash`. The chat endpoint is `/api/chat`, rate limited, and returns short companion-style replies only.

The web app's Wallet tab uses a read-only, non-custodial link. On first use, the person signs a short EIP-191 text challenge with their own Ethereum wallet. The relay verifies the signer, then stores only that public address against the fren's existing device identity. Later NFT checks use the saved address without another wallet prompt. Disconnect deletes the link. A new device identity or changed wallet requires a new signature. The signature cannot transfer assets or authorize approvals.

`POST /api/wallet-link/status`, `/challenge`, `/confirm`, `/disconnect`, and `/nfts` require the fren's device token. The NFT endpoint queries Robinhood Blockscout for candidate holdings and rechecks Hood Turtles ownership on-chain. It is limited to five indexer pages and reports `partial` if more remain. `ROBINHOOD_RPC_URL` and `ROBINHOOD_BLOCKSCOUT_API_URL` optionally override the public endpoints. Hood Turtles is the only supported external collection for now.

The older Bankr/pocket-vault API routes remain for existing users and recovery, but the web app no longer creates or displays a fren-owned wallet. New vault creation and legacy minting are disabled by default; only a deliberate `ENABLE_LEGACY_VAULT_CREATION=true` re-enables them for migration/testing. Do not send NFTs to an old vault address as part of the new link flow. Do not put Bankr keys in `web/`, Android/iOS source, Vercel public env, or committed files.

## Hood Turtles featured access

The relay reads the original Hood Turtles contract at `0xca28587b61eac19a87dfcfd9420870867a916675` on Robinhood Chain (chain ID 4663), using the official Robinhood RPC by default. `POST /api/featured/hood-turtle` requires the fren's device token, reads the address from its signed wallet link, and checks `ownerOf` before returning the original on-chain artwork. Successful checks are cached in SQLite for 24 hours; expired checks require a successful online renewal, so transfers may take up to 24 hours to remove display access. The web page is `web/hood-turtles.html`. No certificate, mint, transfer, or approval is required. Featured display is an app-level entitlement, not an on-chain receipt, and ends when the NFT leaves the linked wallet or the wallet is unlinked.

## Web push notifications

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (see `.env.example` for a
key-pair generation one-liner) to enable web push for the PWA's Settings → Notifications
toggle. The web app subscribes via `POST /api/push/subscribe` (device token auth, same as the
WebSocket) and fetches the key from `GET /api/push/public-key`. When a friend request or
acceptance arrives for a pet with **no live connection**, the relay queues a best-effort push
(`pywebpush`, run on a worker thread; stale subscriptions are pruned). `POST /api/push/unsubscribe`
removes a subscription; a different device token cannot remove someone else's. All push
plumbing is optional — without the env vars the relay behaves exactly as before.

## Telegram & Discord (see [TELEGRAM-DISCORD.md](../TELEGRAM-DISCORD.md))

The relay can also authenticate Telegram Mini App users and Discord Activities and turn a
Telegram group / Discord channel into a shared TinyFrens "party room" using the existing
friends relay. Set the env vars in `.env.example` to enable them. Telegram uses
`POST /api/telegram/auth` (validates signed `initData`) and `POST /api/telegram/webhook`
(bot welcome, private `/link CODE` account sync, and ownership-verified `/show [1-5]`
NFT animation messages with Telegram `file_id` caching). Set `TELEGRAM_WEBHOOK_SECRET` both
on the relay and when registering the webhook. `POST /api/account/profile` stores the
shared display name, optional X handle, and Telegram identities verified by Telegram.
Discord uses `POST /api/discord/token` and
`POST /api/discord/interactions` (Ed25519 PING). Discord verification needs `pip install
PyNaCl`. All platform wiring is behind env flags and the app works without them.

### "Open an issue" (Telegram → GitHub)

Say **"open an issue"**, **`/issue`**, or **"file a bug report"** in a Telegram chat that
includes the bot, and it summarises the recent conversation into a real GitHub issue, then
replies with the link.

Required: a token with Issues write access for `GITHUB_REPO=owner/name` (`GITHUB_TOKEN`),
plus an AI key (`GEMINI_API_KEY` or `GOOGLE_API_KEY`) to draft it. Optional
`GITHUB_ISSUE_LABELS` (comma-separated, added to every issue) and `TELEGRAM_ISSUE_HISTORY`
(1–200, default 25).

A GitHub App installation (e.g. TinyFrensAdmin) works once installed on the repo with
**Issues: read and write**; installation auth replaces the static token when it lands.

Only labels that **already exist** in the repository are applied: the bot lists the repo's
labels and drops any requested name that isn't there, because GitHub returns 422 Validation
Failed for an unknown label and would fail the whole issue. Model-suggested labels are
therefore filtered against the real list, so `GITHUB_ISSUE_LABELS` should only name labels
you have actually created. If the label list can't be fetched, the issue is still filed
without labels.

The bot replies in chat for every failure mode (missing config, model refusal, GitHub error)
and rate-limits to 5 requests per chat per hour.

**History limitation:** the Telegram Bot API cannot read a chat's past messages — a bot only
receives messages that arrive after its webhook is registered. "The last 25 messages" are
therefore the 25 most recent non-command messages the relay has buffered in memory for that
chat since it started. Same single-process, in-memory model as rooms and presence: it does
not survive a restart and does not span multiple instances. Each chat has its own buffer.
Commands, `/start`, bot posts and non-text messages are never included in the transcript.

The model is instructed to use only facts from the transcript, attribute points to whoever
said them, and never include private keys, seed phrases, wallet addresses or tokens. Its
reply is parsed strictly (`TITLE:` / `LABELS:` / `---` / body) so a chatty response cannot
produce a malformed issue, and every issue carries a footer naming the chat it came from.

### Inbound webhook (GitHub → chat)

Set `GITHUB_WEBHOOK_SECRET` to enable `POST /api/github/webhook`. Each delivery is verified
against `X-Hub-Signature-256` (HMAC-SHA256 over the **raw** body, constant-time compare) and
rejected with 401 if it does not match — the endpoint is public, so this check is the only
thing standing between GitHub and your chat, and it fails closed. Only SHA-256 is accepted;
the legacy SHA-1 `X-Hub-Signature` header is ignored.

Verified deliveries are relayed back to the Telegram chat that filed the issue: new
comments, and `closed` / `reopened`. Other actions (`opened`, `edited`, label changes) are
ignored, as are issues the bot did not file. Comment text is truncated to 300 characters so
a large comment cannot flood the chat.

The relay remembers which chat filed which issue **in memory**, so the mapping is lost on
restart — comments arriving after a restart are silently dropped rather than misdelivered.
GitHub retries failed deliveries for a while, but this endpoint always answers 200 once the
signature verifies, so it will not retry.

### Published URLs

**TinyFrens on miono** is behind **nginx** (`/etc/nginx/sites-available/tinyfrens.miono.live`),
which proxies `location /` → `http://127.0.0.1:8790` with **no path rewriting** — the request
path reaches the relay unchanged. So the real endpoints are:

| Purpose | URL |
|---|---|
| GitHub App webhook | `https://tinyfrens.miono.live/api/github/webhook` |
| Telegram webhook | `https://tinyfrens.miono.live/api/telegram/webhook` |
| Telegram Mini App auth | `https://tinyfrens.miono.live/api/telegram/auth` |

Note the host is **`tinyfrens.miono.live`**, not `miono.live`. The `miono.live` site is a
static SPA with `try_files $uri $uri/ /index.html`, so `https://miono.live/api/tinyfrens/...`
does not reach the relay at all — it falls through to `index.html` (200 on GET, 405 on POST).


## FRENS economy (testnet first)

Production FRENS on Base: `0x1A96226727a1D0a46334b3A4b3878B32B7659ba3` (see `contracts/config/economy.json`). Integration uses **Base Sepolia** and `TestFRENS` until deposits and jackpots are verified; see `contracts/testnet/README.md`.

`GET /api/economy/status` reports chain, token, and whether testnet economy is enabled. Set `ECONOMY_MODE=testnet` and `FRENS_TOKEN` to your deployed test token; `ECONOMY_MODE=production` is recognized but **does not enable** paid features on the server until testnet sign-off.

## Operations

Back up the `pets` Docker volume (SQLite database) and keep it private. Use one relay instance; visits/presence/rate limits are in memory. Scale-out or guaranteed background notifications need additional work. Deploy behind Caddy as provided; `TRUST_PROXY=true` assumes the relay port is not publicly exposed. Limit origin access with `ALLOWED_ORIGINS` (comma-separated exact origins). `ALLOW_NATIVE_ORIGIN=true` admits `Origin: null` for the bundled Android/iOS file WebViews, but still requires private device credentials. For web-only installs, turn it off. Origin checks are not user authentication.

Registration, requests, messages and connections have rate limits and frame/body size caps. This is suitable for a small family deployment, not an unaudited large public service. Keep dependency/security updates current.

## Local test

Python 3.12+:

```sh
pip install -r requirements.txt
python -m unittest discover -s . -v
```

The tests run separate authenticated WebSocket clients and exercise friendship/visit consent, live appearance, actions, goodbye, unauthorized peers, removal, disconnect, origin rejection, malformed profiles, and identity persistence across restart. No real phones or Bluetooth radio testing is claimed.

Android registration uses the app’s HTTPS bridge, preserving the bundled WebView file-access restrictions. It sends `Origin: null`, so keep `ALLOW_NATIVE_ORIGIN=true` for native installs. No passwords or service credentials are bundled in the app.

## Bankr phone pairing and turtle import

`skills/tinyfrens-connect/SKILL.md` describes the phone-first Bankr connection. Device-authenticated `/api/turtle-connect/start`, `/status`, and `/accept` bind a ten-minute single-use pairing code to the existing phone. Origin-less agents can call only `/challenge` and `/confirm`; the latter verifies an EIP-191 signature and forces a current Hood Turtles ownership check. The phone must explicitly accept before its wallet link changes. No phone credential or bearer recovery URL is returned to the agent. Changing or disconnecting a wallet invalidates pending pairings.

`GET /api/hood-turtles/preview?tokenId=N` returns only public collection artwork, without an ownership entitlement. Web/native rendering still requires the linked device. Android imports through its restricted native HTTPS bridge, caches a rendered SVG/PNG bitmap, and renews ownership while the floating service runs. Set `ALLOW_NATIVE_ORIGIN=true` for native setup; Compose already enables it. The native turtle bridge uses `https://tinyfrens.miono.live`.

See [the implemented flow and rollout requirements](../docs/hood-turtles-experience.md). Publish the relay and skill and distribute the updated Android app together; this is not enabled in old installed APKs.

## Robots v1 companions

`POST /api/featured/companion` accepts the private device `token`, `tokenId`, `originalAddress` and `chainId`. It supports Hood Turtles on Robinhood Chain (4663) and Robots v1 at `0xd745d8005a1ad8f783b97bf55e0d0e6a920ea8ff` on Base (8453). Supplied wallet addresses are ignored: ownership must match a wallet linked by a signature to the authenticated device. A successful check lasts 24 hours; removing a wallet revokes device access immediately. Unsupported collections/chains are rejected. The legacy Hood Turtle endpoint stays available.

Robots use `ROBOTS_RPC_URL` (default `https://base-rpc.publicnode.com`) independently of the legacy testnet economy RPC. Discovery and the gallery batch current ownerOf reads and cache the inventory; no archive Transfer logs are required. Failed RPC ranges never count as empty ownership. The robot adapter isolates the character groups from stored tokenURI artwork and samples the deployed eight-step limb animation; the robot's walking trait controls timing. Browser, desktop and Android select frames without a scene background. Each collection keeps its own adapter and identity (chain + contract + token ID). Native releases must include the new adapter and generic API allowlist; existing installed apps need updating.

## Robots care loop (Tamagotchi)

The care *simulation* lives in `web/pet-engine.js`. The server only owns what touches money. `POST /api/robots/care` (`{token, tokenId}`) returns the pet's free daily allowance, the per-action FRENS prices, the care-action list, the credit balance and `creditsPerFrens`; `POST /api/robots/care/action` (`{token, tokenId, action}`) records one care action - free within the allowance, and beyond it **charged from the credit ledger** at the FRENS price (paid top-up, and the paid revive), returning `charged`/`balance`, or `requiresPayment`/`priceFrens`/`shortfall` when the balance is short. `POST /api/robots/game` (`{token, tokenId, game}`) grants the small game earn-back (`gameRewardCredits`, 0 = off). All are robots-only and authorize with a **fresh** `ownerOf` against the pet's linked wallets. Tunables default in `server/robot_care.py` and can be overridden by `ROBOT_CARE_DAILY_ALLOWANCE` / `ROBOT_CARE_PRICE_<ACTION>` / `ROBOT_CARE_GAME_REWARD_CREDITS`, or live via the admin surface below. Client wiring (reporting actions and showing the balance) is still pending (P4b).

### Deposits (v1: direct transfer to the Dev wallet)

Players send FRENS straight to a fixed Dev wallet; the relay's `TreasuryTransferIndexer` watches ERC-20 `Transfer` logs to that address and credits the sender's pet. The destination comes from `FRENS_TREASURY` (env-only, **no default**) and the indexer is **off** unless `FRENS_TREASURY_INDEXER=true`, so a stale config can never redirect funds; `FRENS_TREASURY_MAX_CREDITS` caps each transfer and the scan fails closed on RPC errors. A transfer whose sender maps to zero or several pets is recorded in `treasury_transfers` as `unmatched` and credits nothing (manual reconciliation) - we never guess. Crediting is idempotent on `(chain_id, tx_hash, log_index)`. This is Base **mainnet**; rehearse read-only before enabling.

## Admin

Non-public operator surface (see `docs/tamagotchi-robots.md` §8). Every `/api/admin/*` route needs `Authorization: Bearer $ADMIN_TOKEN`; **without `ADMIN_TOKEN` the whole surface answers 503**, so it is never exposed by accident. The token is a shared secret compared in constant time - generate a long random value and keep it out of git. `GET /admin` redirects to the page at `/web/admin.html`, which lets an operator retune the care allowance, game reward and prices live (stored in `app_settings`, read per request), see the read-only deposit treasury/rate, and read the credit ledger and care usage. It never touches keys, seeds or deployments - in particular the deposit treasury address is env-only, never editable here.

The admin API is origin-independent (its own bearer token) and sends `Cache-Control: no-store`. On Compose, to give it its own host, point `ADMIN_DOMAIN` at the relay and uncomment the block in `server/Caddyfile`; otherwise it is reachable on `PET_DOMAIN` at `/admin`.

### Rollout state

Collection gallery and ownership use cached current-state reads. Gallery visits share
one 10-minute cache; cached artwork is reused. Telegram uses only NFT companions;
Mini App sessions do not show native download/update prompts. GitHub webhook URL:
`https://tinyfrens.miono.live/api/github/webhook` (signed raw-body HMAC verification).
Issue-to-chat mappings persist across relay restarts. GitHub issue filing still
requires operator-configured `GITHUB_TOKEN`, `GITHUB_REPO`, and webhook secret.
FRENS live deposits remain disabled by operator decision; do not enable the treasury
indexer as part of a routine web/app deployment.
