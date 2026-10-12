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
