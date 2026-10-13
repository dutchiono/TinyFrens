# TinyFrens in Telegram

Open [@TinyFrensBot](https://t.me/TinyFrensBot?start=connect) and choose **Open TinyFrens**. Links from the website and installed apps open this private bot conversation. Buttons in the conversation open the Mini App directly; buttons posted in groups use the bot's `startapp` deep link.

Telegram signs the Mini App launch data. The TinyFrens relay verifies that signature before attaching the Telegram user ID and handle to a TinyFrens account. A plain username typed into a form is never marked as a verified Telegram identity.

## Link an existing TinyFrens account

1. On a device that already has your wallets and companions, open **More → Settings → Sync devices**.
2. Copy a sync code.
3. DM `@TinyFrensBot` with `/link YOUR-CODE`.
4. Approve the request on the device that created the code.
5. Open TinyFrens from the bot.

The account then shares linked wallets, shown NFTs, size and movement settings, display name, and verified Telegram identity. The approval keeps a code pasted by someone else from taking over an account. Device credentials are never posted into Telegram.

## Wallets and NFTs

TinyFrens supports Hood Turtles, TinyFrens: Robots v1, The Nubs, and Bots Computers. Wallets stay read-only: linking uses a signed text message and does not transfer an NFT, approve spending, or cost gas.

The preferred wallet path is Bankr. Copy the prepared Bankr message from TinyFrens, send it to Bankr, and approve the resulting wallet on the waiting device. Manual wallet signing remains available as a fallback.

## Messages, buttons, and animation

The bot can send inline buttons in DMs and groups. Telegram only permits a `web_app` keyboard button in a private chat, so group messages use a Telegram Mini App deep link.

Use `/show` after linking your account to post the first selected NFT as a transparent animated GIF. Use `/show 2` through `/show 5` for another selected companion. The relay rechecks NFT ownership, renders the collection-specific animation frames, and caches Telegram's `file_id` after the first upload. It never substitutes a made-up character or a square NFT thumbnail. Live interaction and games stay in the Mini App.

## Groups

Add `@TinyFrensBot` to a group to post an **Open TinyFrens** button. People open the Mini App and can join the shared room with their linked NFT companions. Android and desktop can also show companions over other apps; Telegram keeps them inside the Mini App sandbox.

## Troubleshooting

If the Mini App is blank, update Telegram, close the bot, and open it again. If account linking is waiting, return to the device that generated the sync code and approve the Telegram request before the ten-minute code expires.

- Browser app: https://tinyfrens.lol/web/
- Account and device setup: https://tinyfrens.lol/#install
- Party rooms: [Party rooms and visits](party-rooms.md)
