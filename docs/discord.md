# TinyFrens on Discord 🎮

> 🚧 **Coming soon.** TinyFrens isn't playable in Discord *yet*. This page explains what's
> planned so you know what to expect. We'll update it the moment it's live.

## The plan

Discord gets its own version of the TinyFren you already know — running **inside Discord**
as an **Activity**, right in a voice channel, with no download required. The idea mirrors
what already works in Telegram:

- Open TinyFrens from a Discord channel and your fren is there to feed, play, and grow.
- **A Discord channel becomes a shared room** — everyone who opens the Activity in that
  channel sees each other's frens together, just like a Telegram group.
- The same friendly pet, the same Feed/Play/Nap care, the same growth stages and looks.

## What "Activity" means

On Discord, little in-client experiences (games, watch-together, activities) are called
**Activities**. They open right inside Discord — usually from a voice channel — instead of
sending you to a website. TinyFrens will be one of these, so it feels native to Discord
rather than like an external link.

## What's already built (behind the scenes)

A lot of the plumbing is done and tested — it just needs the final Discord app setup and a
live launch:

- ✅ The server can verify Discord's signed requests and answer Discord's required
  "PING" check, so the app can be registered.
- ✅ Sign-in works: when you open the Activity, TinyFrens can identify you and load *your*
  fren.
- ✅ The "channel = shared room" behaviour is wired up and tested.
- ✅ The in-app floating buddy (drag your fren around, tap for quick care) is ready.

What's left is mostly **configuration** (registering the app in Discord's developer portal
and mapping the URLs), not new features.

## What stays the same everywhere

Your fren follows the same rules on every platform — Android, desktop, web, Telegram, and
soon Discord. Each place keeps its own save, and your fren's personality and care are
identical.

## Get notified

Want to know the second it's live?

- Watch the [TinyFrens repo](https://github.com/dutchiono/TinyFrens) for updates, or
- Follow [@TinyFrens_ on X](https://x.com/TinyFrens_).

In the meantime, you can play right now in [Telegram](telegram.md) or
[in your browser](https://tinyfrens.lol/web/).

---

*Developers: the technical design, current status, and the exact remaining steps live in
[Telegram & Discord](../TELEGRAM-DISCORD.md).*

## Developer Portal setup checklist

TinyFrens uses one Discord application for three related surfaces: the server bot,
application commands, and Discord account linking. The Discord adapter must feed the
same TinyFrens account, game, moderation, and update services used by Telegram; it is
not a separate game implementation.

### General Information

- Interactions Endpoint URL: `https://tinyfrens.miono.live/api/discord/interactions`
- Terms of Service URL: `https://tinyfrens.lol/terms/`
- Privacy Policy URL: `https://tinyfrens.lol/privacy/`
- Linked Roles Verification URL: `https://tinyfrens.lol/discord/linked-role/`.

### Installation

- Installation Context: enable **Guild Install**. Leave **User Install** off until
  DM/user-installed commands are intentionally supported.
- Install Link: **Discord Provided Link**.
- Guild Install scopes: `bot` and `applications.commands`.
- Requested permission integer: `2270829605940470`.
- Install URL for application `1560684702904483840`:
  `https://discord.com/oauth2/authorize?client_id=1560684702904483840&scope=bot%20applications.commands&permissions=2270829605940470`

The permission integer requests these checkboxes:

- General server management: View Audit Log, Manage Server, Manage Channels, Manage
  Roles, Manage Webhooks, Create Events, and Manage Events.
- Moderation: Kick Members, Ban Members, Moderate Members, Manage Messages, and Manage
  Nicknames.
- Messaging and low-noise game UI: View Channels, Send Messages, Embed Links, Attach
  Files, Read Message History, Add Reactions, Create Public Threads, Send Messages in
  Threads, Manage Threads, Pin Messages, and Use Application Commands.

Do not select Administrator, Mention Everyone, Manage Expressions, voice moderation,
or Presence permissions unless a later feature specifically needs them. After install,
move the TinyFrens bot role above every role it must manage; Discord prevents a bot from
moderating members or editing roles at or above its highest role.

### Bot

- Public Bot: on if TinyFrens should be installable outside the owner server; otherwise off
  during private testing.
- Requires OAuth2 Code Grant: **off**. This switch is not needed for normal OAuth account
  linking and would unnecessarily force every bot installation through a callback.
- Privileged Gateway Intents: **Server Members Intent on**, **Message Content Intent on**,
  and **Presence Intent off**. Member events support joins and membership checks. Message
  content is required for Telegram-equivalent automatic filters, message deletion, and
  message-aware moderation; slash commands alone do not need it.

### OAuth2

Register `https://tinyfrens.miono.live/api/discord/oauth/callback` as the production
redirect URI for web, Android, and desktop account linking. Native clients must begin
the flow in a system browser and receive a one-time TinyFrens handoff from this server
callback; the Discord client secret must never ship in a browser, APK, or desktop build.

The account-link flow should use the Authorization Code Grant with `state` and request
only `identify` initially. Linked-role verification additionally requests
`role_connections.write` so TinyFrens can publish the user's verified role metadata.
Add `guilds` only when TinyFrens actually needs to show or choose the user's servers,
and add `guilds.members.read` only when it needs that user's membership or roles in a
selected server. Do not request `email`, `connections`, `guilds.join`, or broad RPC
scopes for the current feature set.
