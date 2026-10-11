# TinyFrens Farcaster Snap (v2.0)

Interactive in-feed Farcaster Snap for TinyFrens, built with Hono and conforming to the [Farcaster Snap 2.0 Specification](https://docs.farcaster.xyz/snap).

## Features
- **In-Feed Pet Care**: Pet, Feed, and Play directly in the Farcaster feed with instant confetti effects.
- **1-Click Launch**: Launches the full TinyFrens Mini App via `open_mini_app`.
- **CORS & JFS Compatible**: Pre-configured for Farcaster clients and Warpcast.

## Deploying to host.neynar.app

As described in `https://docs.farcaster.xyz/snap/SKILL.md`:
```bash
# 1. Package the snap directory
tar --exclude='node_modules' --exclude='.git' -czf tinyfrens-snap.tar.gz .

# 2. Deploy via Neynar Host API (or using the farcaster-snap skill)
# Live URL will be: https://tinyfrens-snap.host.neynar.app
```
