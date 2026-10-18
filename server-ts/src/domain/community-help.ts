export function discordGameHelpText(): string {
  return [
    '## 🎮 Group Scrap Run',
    '1. Run `/game` in a server channel to open the lobby. Starting it does not join you.',
    '2. Up to four people—including the starter—can press **Join crew** during the five-minute window.',
    '3. A crew member presses **Search scrap** after the window closes.',
    '4. Everyone in the crew gets the same find and an individual account reward.',
    '',
    'Discord and Telegram use the same Scrap engine, reward rules, and database. Each group/channel keeps its own lobby so unrelated communities do not overwrite each other.',
    'A Discord identity and a Telegram identity are separate until both are linked to the same TinyFrens account with `/link`.',
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
    '`/show [slot]` — Post a verified NFT from slot 1–5.',
    '`/showhelp` — NFT slot and account-linking help.',
    '`/link code` — Link Discord to your existing TinyFrens account.',
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
    '1. In TinyFrens Settings, create a sync code.',
    '2. Run `/link code:<your code>` here, then approve the request on the device that created it.',
    '3. In TinyFrens, assign verified NFTs to community-bot slots 1–5.',
    '4. Run `/show` or `/show slot:2` to post one. Ownership is verified each time.',
  ].join('\n');
}
