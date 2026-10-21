# TinyFrens in Telegram

Open [@TinyFrensBot](https://t.me/TinyFrensBot?start=connect) and choose **Open TinyFrens**. Links from the website and installed apps open this private bot conversation. Buttons in the conversation open the Mini App directly; buttons posted in groups use the bot's `startapp` deep link.

Telegram signs the Mini App launch data. The TinyFrens relay verifies that signature before attaching the Telegram user ID and handle to a TinyFrens account. A plain username typed into a form is never marked as a verified Telegram identity.

## Link an existing TinyFrens account

1. On a device that already has your wallets and companions, open **More → Settings → Sync devices**.
2. Copy a sync code.
3. DM `@TinyFrensBot` with `/link`, open the private button on the device where you already use TinyFrens, and confirm. The Settings sync code remains available as a fallback.
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

### Group Scrap Run

Use `/game` in a group to start a live shared Scrap Run. The bot posts one message with **Join crew**, **Safe scan**, and **Deep scan** buttons, removes the triggering command when its admin permissions allow it, then edits that same message as operators join and when the run finishes. It does not lock the group or post a new message for each player. Telegram and Discord use the same game state, inventory, and rankings.

Joining requires an explicit account link. Create a sync code from TinyFrens Account, DM `/link CODE` to the bot, and approve the request on the original device. Pressing **Join crew** never creates a hidden Telegram-only account.

- A crew holds up to four operators.
- Starting a run does not automatically join the operator.
- Any crew member can scan immediately. A Safe scan always finds modest salvage; a Deep scan can miss but has better rare finds and credit rewards.
- Every crew member spends 6 account Energy when joining. Starting or refreshing a card is free. With one eligible Robot, 6 Energy recharges in about six hours; owning more eligible Robots increases the account recharge rate. Telegram, Discord, and the shared web care game spend the same account Energy, so switching platforms does not bypass progression.
- Everyone receives the same account credit reward, plus 10 credits per additional crew member. Rewards use the shared TinyFrens account ledger, so they are not trapped in Telegram.
- Successful finds also add persistent salvage to `/inventory`. `/craft` spends 3 Rusted Gear and 2 Copper Coil to make a Signal Booster; the next Deep scan by that fren consumes it and cannot miss.
- `/scoreboard` ranks weekly salvage, shows personal weekly objectives, and keeps each fren's all-time salvage, runs, rare finds, and crew runs after the weekly reset.
- Only one unresolved run can exist in a group. Reusing `/game` refreshes the existing message.
- A completed card offers **New scrap run**, which starts the next run in the same message instead of adding chat noise.
- Joins and rewards are stored in SQLite and are idempotent.

The reward weights, Energy cost, and crafting recipe are balance inputs and can change, but the account Energy gate, persistent inventory, risk choice, crafting sink, and shared weekly/all-time records are enforced server-side. Planned FRENS holding, staking, and burn recharge boosts remain inactive; this feature does not silently enable them.

### Project awareness

When someone asks the bot for recent work, including asking it to brief another `@username`, the reply groups verified GitHub changes into **Website**, **Telegram**, and **Backend** sections based on the files changed in each commit. It also reports pull-request and CI state. Repository activity is not described as live until a deployment is separately verified.

### Suspected-bot review

A group administrator can reply to a suspicious account's message with `/bot`. TinyFrens records the account for review and posts one notice that mentions the account and replies to the source message. It does not automatically ban or restrict someone based on suspicion alone. Reply with `/unbot` to clear an incorrect label.

## Troubleshooting

If the Mini App is blank, update Telegram, close the bot, and open it again. If account linking is waiting, return to the device that generated the sync code and approve the Telegram request before the ten-minute code expires.

- Browser app: https://tinyfrens.lol/web/
- Account and device setup: https://tinyfrens.lol/#install
- Party rooms: [Party rooms and visits](party-rooms.md)
