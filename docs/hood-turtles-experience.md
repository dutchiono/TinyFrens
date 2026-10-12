# Hood Turtles connection and import

Source implementation, October 12, 2026. The relay connection endpoints are deployed, and the public skill is served at https://tinyfrens.lol/import/skill.md. Updated installed builds are required for native use.

## Product direction

Your NFT deserves more than a wallet tab. Put it on top of your world.

TinyFrens provides a living gallery for art the user already owns. Hood Turtles is the first featured collection. Original TinyFrens companions, minting, and legacy vault tools remain secondary. Original artwork is preserved; the first motion pass animates the entire artwork, rather than inventing limbs or removing identifying traits.

## Device-first identity

The device has its own private credential; the relay stores its hash. Pairing links the public wallet address to that existing device. A wallet is the ownership identity, while each phone has a separately authorized session. No email or password is needed. This does not synchronize care saves between devices.

1. Open Import Hood Turtle inside the Android, desktop, or native iOS app, or open the web setup page for browser use.
2. Tap Connect with Bankr. The device creates a random 12-character code, valid for ten minutes.
3. Tweet the generated prompt to @bankrbot or send it in Bankr chat. Its setup skill reads the user's wallet and chosen turtle, requests a challenge bound to the code, and signs the exact message with personal_sign.
4. The relay verifies the signer and current collection ownership. This does not yet link the phone.
5. The device displays the verified address and turtle. Tap Import this turtle to consume the code, link the wallet, and import the chosen artwork.
6. Tap Import my turtle. Android fetches verified original artwork through its native HTTPS bridge, renders SVG/PNG once into a bitmap, and persists the selected turtle with its ownership expiry. Show pet uses that artwork in the existing draggable floating overlay.

The direct wallet-browser path uses the existing one-time EIP-191 challenge instead of Bankr. It currently requires an injected wallet provider; a standalone WalletConnect QR/mobile adapter is not implemented. Pairing again on another device is supported; email recovery and cloud care-save synchronization are not.

## API

All JSON POST routes. Agent routes require possession of the code and a valid wallet proof, but never a phone credential. Device routes require the device credential and an allowed Origin.

- `/api/turtle-connect/start`: device token; returns code and expiry. Starting again invalidates the previous code.
- `/api/turtle-connect/challenge`: code, address, tokenId; returns challengeId and a nonce-bearing message bound to the wallet, collection, chain, token and phone pairing.
- `/api/turtle-connect/confirm`: code, challengeId, signature; checks EIP-191 signer and ownerOf, then marks the pairing verified. No device token is returned.
- `/api/turtle-connect/status`: device token, code; only the initiating device can inspect its verified pairing.
- `/api/turtle-connect/accept`: device token, code; requires verified/unexpired pairing, consumes it once, and links its signed wallet.
- `/api/featured/hood-turtle`: device token, tokenId; reads the linked wallet and returns original artwork with checkedAt/validUntil.
- `GET /api/hood-turtles/preview?tokenId=1`: public original collection-art preview. Returns no entitlement or device credential. Gallery viewing does not grant ownership access.

Collection: 0xca28587b61eac19a87dfcfd9420870867a916675. Robinhood Chain, chain ID 4663. Original TinyFrens minting on Base is separate.

## Daily ownership

Successful ownership checks persist in SQLite for 24 hours. Cache entries are keyed by wallet and token, not a client assertion. Pairing confirmation forces a fresh check. Negative ownership is not cached, so a new purchase can work immediately. At expiry, active web/native clients request renewal before showing the turtle again. Android can renew while its floating service runs. This is demand-driven renewal, not a nightly task scanning inactive installations.

A sale can leave access valid until the current 24-hour check expires. Expired verification stays hidden through RPC failures; failed checks do not extend access. Local unlinking clears the native import immediately. The relay rejects requests without a current wallet link and rechecks the link after an in-flight ownership request.

## Rendering and platforms

Web and Android preserve the NFT's original artwork. Idle, movement, celebration, eat, and sleep reactions move/dim the artwork as a whole. Reduce motion disables motion. Android's transparent overlay window preserves any transparency present in the original image; an opaque NFT background remains opaque. Native SVG uses AndroidSVG 1.4 and is rendered into a cached bitmap, so embedded SVG animation is not played. Articulated animation requires inspecting the collection's actual SVG/layers.

Android and desktop provide roaming, drag, care controls, and the original turtle image in their floating overlays. Desktop persists verified artwork and renews expired verification from the main process, even with its care window hidden. Browser imports display inside TinyFrens. Each app/browser pairs separately; importing in Chrome/Safari does not import into an installed app.

Native iOS has a restricted HTTPS connection bridge and uses the shared original-art display inside the app. App Store distribution is planned. iOS cannot provide an interactive overlay over arbitrary apps. PiP is legacy and excluded from the new import flow. The legacy browser video panel is opt-in with `?legacyPip=1`.

## Rollout and verification limits

Publish the updated relay and skill, then distribute updated signed app builds before directing live users to this flow. Enable ALLOW_NATIVE_ORIGIN=true on the relay; the supplied Compose configuration already does this. The native turtle bridges accept only https://tinyfrens.miono.live and specific connection/import routes. Native iOS compilation and device validation require macOS/Xcode; this Windows environment cannot perform them.

The supplied X post and direct RPC reads returned HTTP 403 from this Windows environment. The deployed relay successfully loads official on-chain artwork through its production network. Live Bankr signing, the purchased token's exact rendering, and physical-phone overlay behavior still need verification. Do not infer the purchase destination from the earlier ambiguous wording: the user clarified that their NFT remains in their Bankr wallet.

Bankr supports user-installed skills and personal_sign via its Wallet API. API signing requires Wallet API permissions and a non-read-only key; web sessions alone are not accepted. Bankr documents skills shared across web and X, but this integration still needs an end-to-end X test. The skill never requests transfers, approvals, purchases, wallet keys, or deployment.

References: https://docs.bankr.bot/skills/in-bankr/from-github/ and https://docs.bankr.bot/wallet-api/sign/

The existing production relay was older than the repository. The live rollout added only turtle connection/ownership routes to that deployed version, preserving existing handlers, with an app backup and a SQLite snapshot before restart. Hosting the website does not deploy the Python relay.


## Collection adapters

Wallet pairing links a public address once, independently of any token. Supported holdings are discovered after acceptance; importing each companion verifies ownership with a 24-hour lease. Adding a collection must not require users to pair again.

Each collection needs an explicit art adapter and its own reviewed animation rules. `server/hood_turtle_art.py` handles only the official Hood Turtle 32×32 SVG layout: backgrounds precede the tail landmark; the remaining rectangles contain the character and accessories. Four walk frames articulate the legs and attached footwear. The stationary frame preserves the original character rectangles. Unknown layouts fail closed; do not substitute a bobbing rectangular NFT.

Current Hood Turtle animation scope: stationary pose and four-frame walking. No custom sleep, eating, turning, or wave poses yet. Fixtures cover three actual collection tokens with different backgrounds and traits; this is not an exhaustive audit of all 2,222 tokens. Add fixture coverage for new layouts before enabling them.

Android, browser and desktop retain up to five selected Hood Turtles. Each selected token retains its own expiry and must renew independently. Removal does not disconnect the wallet. Disconnect clears selections. Android extra companions have independent overlay windows with drag; desktop extra windows currently pass clicks through, with removal in the main app.
