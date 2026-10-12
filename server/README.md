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

Bankr is integrated as a normal server-side API-key bridge. Set `BANKR_API_KEY` on the server to enable `/api/bankr/status`, `/api/bankr/wallet`, `/api/bankr/nfts`, `/api/bankr/transform`, and `/api/bankr/monitor`. The web app's Wallet tab shows the server's agent-controlled Bankr wallet, reads NFTs from it, and can apply an NFT-derived look to the fren.

Per-fren Bankr wallets are scaffolded behind `BANKR_PARTNER_KEY`. When that partner key is present, `/api/bankr/wallet` provisions a Bankr wallet for the registered fren with `POST /partner/wallets`; without it, TinyFrens uses the shared server Bankr wallet. Do not put Bankr keys in `web/`, Android/iOS source, Vercel public env, or committed files.

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
(bot welcome + inline `web_app` button). Discord uses `POST /api/discord/token` and
`POST /api/discord/interactions` (Ed25519 PING). Discord verification needs `pip install
PyNaCl`. All platform wiring is behind env flags and the app works without them.

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
