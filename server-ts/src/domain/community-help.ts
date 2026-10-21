export function discordGameHelpText(): string {
  return [
    '## 🎮 Group Scrap Run',
    '1. Run `/game` in a server channel to start a live Scrap Run. Starting it does not join you.',
    '2. Link Discord to your TinyFrens account with `/link`, then press **Join crew** while the run is open.',
    '3. Any crew member chooses **Safe scan** for guaranteed modest salvage or **Deep scan** for larger finds with a chance to miss.',
    '4. Everyone gets the same find. Each linked fren may join 3 runs per UTC day.',
    '5. `/inventory` shows salvage, `/craft` builds a no-miss Deep-scan booster, and `/scoreboard` tracks weekly standings and objectives.',
    '',
    'Discord and Telegram use the same Scrap engine, reward rules, and database. Each group/channel keeps its own run so unrelated communities do not overwrite each other.',
    'TinyFrens never creates a playable Discord account just because you press Join. `/link` explicitly connects Discord to the account you already use elsewhere.',
    '',
    'The TinyFrens app also has short solo arcade modes. Those are separate modes—not another implementation of the group Scrap Run.',
  ].join('\n');
}

export function discordHelpText(): string {
  return [
    '## 🐾 TinyFrens commands',
    '`/start` — Open this guide.',
    '**Group game**',
    '`/game` — Start or refresh this channel’s shared Scrap Run.',
    '`/gamehelp` — Rules, timing, and cross-platform state.',
    '`/scoreboard` — Weekly standings, objectives, and your all-time record.',
    '`/inventory` — Your salvage and remaining daily runs.',
    '`/craft` — Craft a Signal Booster from salvage.',
    '`/show [slot]` — Post a verified NFT from slot 1–5.',
    '`/showhelp` — NFT slot and account-linking help.',
    '`/link` — Open a private confirmation link for your existing TinyFrens account.',
    '',
    '**Information**',
    '`/status` — Check the backend and Discord connection.',
    '`/progress` — Verified website, community, and backend changes.',
    '`/issue` — Ask AI to summarize recent channel context into a GitHub issue.',
    '`/myid` — Show your Discord ID privately.',
    '`/help` — Show this command guide.',
    '',
    '**Moderation**',
    '`/warn` — First warns, second mutes for 10 minutes, third bans.',
    '`/unwarn` — Clear a member’s warning history.',
    '`/bot` — Mark a member as a suspected bot.',
    '`/unbot` — Clear a suspected-bot mark.',
    '`/ban` — Ban a member.',
    '`/filter` — List, set, or remove automatic replies.',
    '`/blocklist` — List, add, or remove blocked text.',
    'Right-click a message → **Apps → Warn message** to delete it and apply the warning ladder.',
    '',
    '**Server administration**',
    '`/setup` — Create or repair TinyFrens roles and channels without duplicates.',
    '',
    'These commands use the same TinyFrens services as Telegram and work without AI chat.',
  ].join('\n');
}

export function discordShowHelpText(): string {
  return [
    '## 🐾 NFT slots and account linking',
    '1. Run `/link` here.',
    '2. Open the private button on the device where you already use TinyFrens, then confirm.',
    '3. In TinyFrens, assign verified NFTs to community-bot slots 1–5.',
    '4. Run `/show` or `/show slot:2` to post one. Ownership is verified each time.',
  ].join('\n');
}
