export function discordGameHelpText(): string {
  return [
    '## 🎮 Group Scrap Run',
    '1. Run `/game` in a server channel. The starter joins automatically.',
    '2. Up to four people can press **Join crew** during the five-minute window.',
    '3. A crew member presses **Search scrap** after the window closes.',
    '4. Everyone in the crew gets the same find and an individual account reward.',
    '',
    'Discord and Telegram use the same Scrap engine, reward rules, and database. Each group/channel keeps its own lobby so unrelated communities do not overwrite each other.',
    'A Discord identity and a Telegram identity are separate until both are linked to the same TinyFrens account; cross-platform account linking is not finished in Discord yet.',
    '',
    'The TinyFrens app also has short solo arcade modes. Those are separate game modes—not another implementation of the group Scrap Run—but they use the same account Energy system.',
  ].join('\n');
}

export function discordHelpText(): string {
  return [
    '## 🐾 TinyFrens commands',
    '**Group game**',
    '`/game` — Start or refresh this channel’s shared Scrap Run.',
    '`/gamehelp` — Rules, timing, and cross-platform state.',
    '',
    '**Information**',
    '`/status` — Check the backend and Discord connection.',
    '`/help` — Show this command guide.',
    '',
    '**Moderation**',
    '`/warn` — First warns, second mutes for 10 minutes, third bans.',
    '`/unwarn` — Clear a member’s warning history.',
    '`/bot` — Mark a member as a suspected bot.',
    '`/ban` — Ban a member.',
    'Right-click a message → **Apps → Warn message** to delete it and apply the warning ladder.',
    '',
    '**Server administration**',
    '`/setup` — Create or repair TinyFrens roles and channels without duplicates.',
    '',
    'Commands work without AI chat. More Telegram account/NFT commands are being moved onto the shared Discord command layer; this list only claims what works here now.',
  ].join('\n');
}
