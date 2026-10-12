# TinyFrens × Telegram & Discord — Integration Plan & Alignment Log

Living document. **Start here.** It explains the goal, the architecture decisions,
what is already scaffolded, and an up-to-date checklist of where we are. Update the
"Progress log" at the bottom every time we land something.

Last updated: scaffolding pass 1 (Telegram-first + Discord Phase-2 skeleton, all tests green).

---

## 1. The idea

TinyFrens is a pocket pet. Today it "follows you" in two ways:

- **Real OS overlay** — the pet floats *above* other apps on Android (`TYPE_APPLICATION_OVERLAY`) and on Windows/Mac (Electron transparent always-on-top window).
- **In-app / PWA** — the pet lives inside its own window on iOS and in the browser.

We want to bring the fren **inside Telegram and Discord** as bots / mini-apps, and map
our existing **"party room"** concept onto a platform **"public chat"** — so a Telegram
group or a Discord channel *is* a shared room where everyone's frens hang out together.

### The "hover" question (bonus) — read this first

> *"currently we can load the char on top of our phone screen and our desktop, but it
> would be cool to have them inside telegram and discord."*

**Hard platform limit:** a true always-on-top OS overlay **cannot** exist inside
Telegram (a sandboxed iframe) or Discord (an Activity iframe). Both platforms forbid
drawing over other apps — that's why Android/desktop can do it and these cannot. We are
being honest about this instead of promising something that won't ship.

**What we build instead (the closest equivalent):** an **in-app floating companion** —
a draggable fren pinned inside the Mini App / Activity with quick **Feed / Play / Nap /
Wave** care bubbles, so it still feels like it "follows you around" within the platform
surface. That lives in `web/companion.js`. It's gated to only run inside Telegram/Discord
(the real overlay on Android/desktop is left untouched).

---

## 2. How it maps to the existing codebase

TinyFrens already ships a **Farcaster Mini App + Snap** integration — that is our
template, and we deliberately mirror it. Key existing pieces:

| Existing thing | File | How we reuse it |
|---|---|---|
| Pet state + rendering (`#pet` CSS sprite) | `web/app.js`, `web/customize.js`, `web/style.css` | Unchanged — the same pet renders inside Telegram/Discord |
| Multiplayer relay + identity `{id,token,code}` | `server/app.py` (aiohttp + SQLite), `web/friends.js` | Telegram/Discord **auth returns the same identity** so friends + party work unchanged |
| Party rooms (`public` / `private:CODE`) | `server/app.py` `party-join`, `web/party.js` | We **add a `chat` room kind** keyed by platform + chat/channel id |
| Farcaster mini-app client adapter | `web/farcaster.js` | Blueprint for `web/telegram.js` + `web/discord.js` |
| Server bot endpoints (Neynar) | `server/app.py` farcaster routes | Blueprint for the Telegram webhook + Discord interactions routes |

### Identity flow (the crux)

---

## 3. What's built so far (Pass 1 — Telegram-first)

### Server (`server/`)
- ✅ `telegram_integration.py` — pure, unit-tested helpers:
  `validate_init_data` (HMAC-SHA256 / `WebAppData`), `user_profile`, `bot_api`,
  `reply_markup` (inline `web_app` button), `classify`, `party_room_id`.
- ✅ `discord_integration.py` — Phase-2 helpers: `verify_interaction` (Ed25519, needs
  PyNaCl), `exchange_code`, `channel_room_id`.
- ✅ `app.py`:
  - New routes: `POST /api/telegram/auth`, `POST /api/telegram/webhook`,
    `POST /api/discord/token`, `POST /api/discord/interactions`.
  - `party-join` gains a `chat` mode; `room_state` reports chat rooms.
  - New tables `tg_users`, `dc_users`; helpers `mint_pet` / `reissue_token`.
  - New endpoints added to the CORS public-path allowlist (signature-authed, not origin-authed).
- ✅ `test_app.py` — new `IntegrationUnitTests` + `TelegramDiscordRouteTests` (27 tests, all green).

### Web (`web/`)
- ✅ `telegram.js` — detects `window.Telegram.WebApp`, `ready()`/`expand()`, themes the
  header, validates via `/api/telegram/auth`, stores the identity, auto-joins the right
  room (group → shared room; `start_param` → private code; else public), enables companion.
- ✅ `discord.js` — loads `@discord/embedded-app-sdk`, runs the OAuth handshake, exchanges
  the code, reads the channel id, auto-joins the channel room. (Phase 2, guarded.)
- ✅ `companion.js` — the draggable in-app "hover" fren with care bubbles.
- ✅ `party.js` — exposes `window.TinyFrensParty.joinChat/joinPublic/joinPrivate`; chat-room status text.
- ✅ `friends.js` — respects `__TINYFRENS_DEFER_AUTH__` so it waits for platform sign-in instead of registering a throwaway device.
- ✅ `index.html` + `style.css` — load + style the new scripts/companion.

---

## 4. Alignment checklist

Legend: ✅ done · 🟡 partial · ⬜ not started

### Telegram (primary — Phase 1)
- [x] Server `initData` validation + identity mint/reissue
- [x] `/api/telegram/auth` returns friends-relay identity (returning user keeps their fren)
- [x] Bot webhook: greet `/start`, welcome on group add, post inline `web_app` button
- [x] Client adapter: ready/expand, theme, sign-in, auto-join room
- [x] Party room = group (`tg:<id>`), shared by everyone in the group
- [x] In-app floating companion (the "hover" equivalent)
- [x] Relay deployed on `miono` with the new code + token; webhook set and verified
- [ ] **Real device test** in Telegram (open `@TinyFrensBot`, tap the Play button)
- [ ] Optional: Telegram `CloudStorage`/`DeviceStorage` for per-user save sync
- [ ] Optional: bot "feed reminder" via `sendMessage` when a fren gets hungry

### Discord (Phase 2 — skeleton only)
- [x] Ed25519 interaction verification + PING/PONG (needs PyNaCl to activate)
- [x] OAuth2 code exchange (`/api/discord/token`)
- [x] Client adapter loads Embedded App SDK, handshakes, reads channel id
- [x] Party room = channel (`dc:<id>`)
- [ ] **Real test** inside a voice channel (needs a Discord app + Activities setup)
- [ ] URL mapping / proxy config in the dev portal (Activities require it)
- [ ] `DISCORD_CLIENT_ID` wiring in `web/discord.js` (currently `TINYFRENS_DISCORD_CLIENT_ID`)
- [ ] Optional: slash command to launch the Activity

### Cross-platform polish
- [ ] Welcome site (`site/`) "Add to Telegram/Discord" entry points
- [ ] Manifest / deep-link handling so a group invite can pre-fill a private room code
- [ ] Docs: link this plan from `README.md` and `server/README.md`
- [ ] CI: add the new server modules to any lint/test job

---

## 5. To actually turn it on (ops checklist)

Nothing here is committed to a live bot — these are the real-world steps.

### Telegram
1. Create a bot with **@BotFather** → get `TELEGRAM_BOT_TOKEN`.
2. Deploy the relay (`server/`) behind HTTPS (existing Caddy setup works).
3. Set env on the server:
   - `TELEGRAM_BOT_TOKEN=…`
   - `TELEGRAM_MINIAPP_URL=https://tinyfrens.lol/web/` (must be HTTPS)
4. Point the webhook at the server once:
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-server>/api/telegram/webhook`
5. In BotFather: **Bot Settings → Menu Button** to the Mini App URL, and set the **Main Mini App**.
6. Add the bot to a group → it posts the "Open the room" button → everyone shares the room.

### Discord
1. Create an app at the Discord Developer Portal.
2. `pip install PyNaCl` (added to `requirements.txt`) for interaction verification.
3. Set env: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, `DISCORD_PUBLIC_KEY`.
4. Configure the **Activity** + URL mapping in the portal, set the interactions endpoint to `/api/discord/interactions`.
5. Set `window.TINYFRENS_DISCORD_CLIENT_ID` in `web/social-config.js` (or an equivalent config).

---

## 6. Known limitations (being explicit)

- **No true OS overlay** inside Telegram/Discord — platform sandbox forbids it. The
  draggable companion is the honest equivalent.
- Discord Activities currently launch from a **voice channel** (or App Launcher), not a
  text chat, so the "channel = room" mapping is closest to a voice-channel Activity.
- The relay is single-process with in-memory rooms (as before); scale-out is future work.
- Not yet tested on physical devices inside the real clients.

---

## 7. Progress log

- **Pass 1 (scaffolding):** Telegram-first scaffolding + Discord Phase-2 skeleton.
  Server helpers, routes, party `chat` rooms, client adapters, companion, tests (27 green).
  Wrote this plan. No live bot registered; all platform wiring is behind env flags.
- **Pass 2 (live bot):** `@TinyFrensBot` created and configured via Bot API:
  - ✅ Menu button set to a `web_app` → `https://tinyfrens.lol/web/` ("🐾 Play TinyFrens").
  - ✅ Commands registered: `/start`, `/fren`, `/help`; short description set.
  - ✅ `can_join_groups: true` — can be added to groups for the shared-room model.
  - ✅ Token stored **only** in git-ignored `server/.env` (`.gitignore` updated to ignore
    `.env`/`.env.*` while keeping `.env.example` tracked). **Never commit the token.**
  - ✅ **Deployed to the live relay** on `miono` (`~/tinyfrens-server`, systemd user unit
    `tinyfrens-server.service` behind nginx → `127.0.0.1:8790`). Backups of the old
    `app.py`/`.env` were made on the server before deploy.
  - ✅ `TELEGRAM_BOT_TOKEN` + `TELEGRAM_MINIAPP_URL` added to the server `.env`; PyNaCl
    installed; service restarted, `active (running)`, `/health` = `{"ok":true}`.
  - ✅ **Webhook set** to `https://tinyfrens.miono.live/api/telegram/webhook`,
    `pending_update_count: 0`. Live tests: `/api/telegram/auth` rejects bad `initData`
    with 400; webhook `/start` and group-add updates both return `{"ok":true}` and fire
    the welcome + "Open the room" messages.
  - ⬜ Still need a physical device test: open `@TinyFrensBot`, tap the menu button,
    confirm the pet renders, sign-in succeeds, and a group shows a shared room.
    **UPDATE:** verified working live via a real Telegram session (screenshot) — the bot
    greeted, the "Open your fren" button opened the Mini App, and a pet ("Tofu",
    Hatchling) rendered with all six tabs. ✅
- **Pass 3 (docs):** Added user + developer documentation:
  - `docs/telegram.md` — player-facing "how to play in Telegram" explainer.
  - `docs/DEVELOPER.md` — current architecture/dev guide (replaces the stale root
    `DEVELOPER.md`, which now carries an out-of-date banner).
  - `docs/README.md` — documentation index.
  - `README.md` — Telegram row in the platform table + a Documentation section.
- **Pass 4 (more docs):** Added player-facing deep-dives:
  - `docs/party-rooms.md` — party rooms (public / private code / chat room) vs. consent-based
    visits; the friends-vs-rooms-vs-visits distinction; rules & FAQ. Facts verified against
    `server/app.py` (80-member cap, 3–24 char codes, 20 joins/hr) and `GAMEPLAY.md`.
  - `docs/discord.md` — honest "coming soon" placeholder: what's planned, what's already
    built & tested (interaction verify, sign-in, channel=room, floating buddy), and what's
    left (dev-portal config). Cross-links the technical plan.
  - `docs/README.md` — index updated with a *Play with others* + *Discord* grouping.
  - `docs/telegram.md` — cross-link to the party-rooms deep-dive.
- **Pass 5 (socials, footer, URLs, chat UX):**
  - Added **Farcaster** (`https://farcaster.xyz/tinyfrens`) to socials everywhere: web-app
    footer, marketing-site footer, root footer, README, docs.
  - Built a real **socials footer** in the web app (was a hidden empty `<footer>`).
  - Added **`docs/links.md`** — one canonical reference for every public URL + Mini App
    target (Farcaster→root, Telegram→`/web/`, Snap→`/snap`, relay). Linked from the index.
  - **Chat is no longer a tab.** Removed the Chat tab; `screen-chat` became a bottom-sheet
    **modal** opened by tapping the character (`#pet`) or the "Tap your fren to chat" hint.
    All existing chat logic/IDs preserved. Updated `docs/telegram.md` to match.




```
Telegram client ──initData (HMAC-signed)──▶ POST /api/telegram/auth
   server validates signature with TELEGRAM_BOT_TOKEN
   maps telegram user.id ─▶ a stable TinyFren pet (tg_users table)
   returns the SAME {id, token, code} the friends relay uses
client stores identity ─▶ friends.js connects the WebSocket ─▶ party.js works as-is
```

This means **zero changes** are needed in `friends.js`/`party.js` core logic — a Telegram
user is just another device identity that happens to be authenticated by Telegram.

### Party room = public chat

- The server's `party-join` now accepts `room:'chat'` with a `platform` + `chatId`.
- Room id is `tg:<chatId>` (Telegram) or `dc:<channelId>` (Discord).
- `room_state()` reports `room:'chat'` + `platform` so the UI says
  *"Telegram group · N frens"* / *"Discord channel · N frens"*.
- The bot, when added to a group, posts an inline **`web_app`** button that opens the
  Mini App **in that group** — so everyone in the group lands in the same room.
