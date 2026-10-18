import { REST, Routes } from 'discord.js';

export const DISCORD_ADMINISTRATOR = 1n << 3n;
export const DISCORD_BAN_MEMBERS = 1n << 2n;
export const DISCORD_MANAGE_MESSAGES = 1n << 13n;
export const DISCORD_MODERATE_MEMBERS = 1n << 40n;

export interface DiscordCommandDefinition {
  name: string;
  type?: number;
  description?: string;
  options?: Array<Record<string, unknown>>;
  default_member_permissions?: string;
  contexts?: number[];
  integration_types?: number[];
}

export const DISCORD_COMMANDS: DiscordCommandDefinition[] = [
  {
    name: 'start',
    description: 'Open the TinyFrens command guide',
    contexts: [0],
    integration_types: [0],
  },
  {
    name: 'help',
    description: 'Show every available TinyFrens Discord command',
    contexts: [0],
    integration_types: [0],
  },
  {
    name: 'gamehelp',
    description: 'Explain the shared group Scrap Run',
    contexts: [0],
    integration_types: [0],
  },
  {
    name: 'game',
    description: 'Start or open the group Scrap Run',
    contexts: [0],
    integration_types: [0],
  },
  {
    name: 'show',
    description: 'Post a verified NFT from one of your TinyFrens slots',
    contexts: [0],
    integration_types: [0],
    options: [{ type: 4, name: 'slot', description: 'TinyFrens slot 1-5', required: false, min_value: 1, max_value: 5 }],
  },
  {
    name: 'showhelp',
    description: 'Explain NFT slots and cross-platform account linking',
    contexts: [0],
    integration_types: [0],
  },
  {
    name: 'link',
    description: 'Link this Discord identity to an existing TinyFrens account',
    contexts: [0],
    integration_types: [0],
    options: [{ type: 3, name: 'code', description: 'The 12-character sync code from TinyFrens Settings', required: true, min_length: 12, max_length: 16 }],
  },
  {
    name: 'progress',
    description: 'Show verified website, community, and backend work',
    contexts: [0],
    integration_types: [0],
  },
  {
    name: 'issue',
    description: 'Summarize recent channel context into a GitHub issue',
    contexts: [0],
    integration_types: [0],
    options: [
      { type: 3, name: 'title', description: 'Optional focus for the AI draft', required: false, min_length: 3, max_length: 90 },
      { type: 3, name: 'details', description: 'Optional context to add to recent messages', required: false, min_length: 3, max_length: 1800 },
    ],
  },
  {
    name: 'myid',
    description: 'Show your Discord user ID privately',
    contexts: [0],
    integration_types: [0],
  },
  {
    name: 'warn',
    description: 'Warn a member; second warning mutes, third warning bans',
    default_member_permissions: DISCORD_MODERATE_MEMBERS.toString(),
    contexts: [0],
    integration_types: [0],
    options: [
      { type: 6, name: 'member', description: 'Member to warn', required: true },
      { type: 3, name: 'reason', description: 'Reason for the warning', required: false, max_length: 200 },
    ],
  },
  {
    name: 'unwarn',
    description: 'Clear a member’s TinyFrens warnings',
    default_member_permissions: DISCORD_MODERATE_MEMBERS.toString(),
    contexts: [0],
    integration_types: [0],
    options: [{ type: 6, name: 'member', description: 'Member whose warnings should be cleared', required: true }],
  },
  {
    name: 'ban',
    description: 'Ban a member from this server',
    default_member_permissions: DISCORD_BAN_MEMBERS.toString(),
    contexts: [0],
    integration_types: [0],
    options: [
      { type: 6, name: 'member', description: 'Member to ban', required: true },
      { type: 3, name: 'reason', description: 'Reason for the ban', required: false, max_length: 200 },
    ],
  },
  {
    name: 'bot',
    description: 'Mark a member as a suspected bot for moderator review',
    default_member_permissions: DISCORD_MANAGE_MESSAGES.toString(),
    contexts: [0],
    integration_types: [0],
    options: [{ type: 6, name: 'member', description: 'Member to flag', required: true }],
  },
  {
    name: 'unbot',
    description: 'Clear a suspected-bot mark from a member',
    default_member_permissions: DISCORD_MANAGE_MESSAGES.toString(),
    contexts: [0],
    integration_types: [0],
    options: [{ type: 6, name: 'member', description: 'Member to clear', required: true }],
  },
  {
    name: 'filter',
    description: 'List, add, or remove an automatic server reply',
    default_member_permissions: DISCORD_MANAGE_MESSAGES.toString(),
    contexts: [0],
    integration_types: [0],
    options: [
      { type: 3, name: 'action', description: 'What to do', required: true, choices: [
        { name: 'list', value: 'list' }, { name: 'set', value: 'set' }, { name: 'remove', value: 'remove' },
      ] },
      { type: 3, name: 'trigger', description: 'One word that triggers the reply', required: false, max_length: 64 },
      { type: 3, name: 'response', description: 'Reply text for set', required: false, max_length: 2000 },
    ],
  },
  {
    name: 'blocklist',
    description: 'List, add, or remove blocked message text',
    default_member_permissions: DISCORD_MANAGE_MESSAGES.toString(),
    contexts: [0],
    integration_types: [0],
    options: [
      { type: 3, name: 'action', description: 'What to do', required: true, choices: [
        { name: 'list', value: 'list' }, { name: 'add', value: 'add' }, { name: 'remove', value: 'remove' },
      ] },
      { type: 3, name: 'pattern', description: 'Text pattern to add or remove', required: false, max_length: 128 },
    ],
  },
  {
    name: 'setup',
    description: 'Create the TinyFrens server roles and channels',
    default_member_permissions: DISCORD_ADMINISTRATOR.toString(),
    contexts: [0],
    integration_types: [0],
  },
  {
    name: 'status',
    description: 'Show TinyFrens service and Discord bot status',
    contexts: [0],
    integration_types: [0],
  },
  {
    name: 'Warn message',
    type: 3,
    default_member_permissions: DISCORD_MANAGE_MESSAGES.toString(),
    contexts: [0],
    integration_types: [0],
  },
];

export function createDiscordRest(token: string): REST {
  return new REST({ version: '10' }).setToken(token);
}

export async function syncDiscordCommands(token: string, applicationId: string): Promise<void> {
  const rest = createDiscordRest(token);
  await rest.put(Routes.applicationCommands(applicationId), { body: DISCORD_COMMANDS });
}

export async function discordDeleteMessage(rest: REST, channelId: string, messageId: string): Promise<void> {
  await rest.delete(Routes.channelMessage(channelId, messageId));
}

export async function discordTimeoutMember(
  rest: REST,
  guildId: string,
  userId: string,
  until: Date | null,
  reason: string
): Promise<void> {
  await rest.patch(Routes.guildMember(guildId, userId), {
    body: { communication_disabled_until: until?.toISOString() ?? null },
    reason,
  });
}

export async function discordBanMember(
  rest: REST,
  guildId: string,
  userId: string,
  reason: string
): Promise<void> {
  await rest.put(Routes.guildBan(guildId, userId), { body: { delete_message_seconds: 0 }, reason });
}

export async function setupDiscordGuild(
  rest: REST,
  guildId: string,
  botUserId: string
): Promise<string[]> {
  const created: string[] = [];
  const roles = await rest.get(Routes.guildRoles(guildId)) as Array<Record<string, unknown>>;
  let modRole = roles.find(role => role.name === 'TinyFrens Mod');
  if (!modRole) {
    const modPermissions = (
      DISCORD_MANAGE_MESSAGES |
      DISCORD_MODERATE_MEMBERS |
      DISCORD_BAN_MEMBERS |
      (1n << 1n) |
      (1n << 34n)
    ).toString();
    modRole = await rest.post(Routes.guildRoles(guildId), {
      body: { name: 'TinyFrens Mod', permissions: modPermissions, color: 0xa474f1, hoist: true },
      reason: 'TinyFrens server setup',
    }) as Record<string, unknown>;
    created.push('role `TinyFrens Mod`');
  }
  let verifiedRole = roles.find(role => role.name === 'Verified Fren');
  if (!verifiedRole) {
    verifiedRole = await rest.post(Routes.guildRoles(guildId), {
      body: { name: 'Verified Fren', permissions: '0', color: 0x82eba1, hoist: true },
      reason: 'TinyFrens server setup',
    }) as Record<string, unknown>;
    created.push('role `Verified Fren`');
  }

  const channels = await rest.get(Routes.guildChannels(guildId)) as Array<Record<string, unknown>>;
  let category = channels.find(channel => channel.type === 4 && channel.name === 'TINYFRENS');
  if (!category) {
    category = await rest.post(Routes.guildChannels(guildId), {
      body: { name: 'TINYFRENS', type: 4 },
      reason: 'TinyFrens server setup',
    }) as Record<string, unknown>;
    created.push('category `TINYFRENS`');
  }
  const parentId = String(category.id);
  const channelSpecs = [
    { name: 'tinyfrens', topic: 'TinyFrens community chat, bot commands, and companion updates.' },
    { name: 'scrap-yard', topic: 'Start the shared five-minute Scrap Run with /game.' },
    { name: 'updates', topic: 'TinyFrens website, Telegram, Discord, game, and backend updates.' },
    { name: 'github-updates', topic: 'Automated GitHub pull requests, CI, releases and deployment status.' },
  ];
  for (const spec of channelSpecs) {
    if (channels.some(channel => channel.type === 0 && channel.name === spec.name)) continue;
    await rest.post(Routes.guildChannels(guildId), {
      body: { ...spec, type: 0, parent_id: parentId },
      reason: 'TinyFrens server setup',
    });
    created.push(`channel \`#${spec.name}\``);
  }
  if (!channels.some(channel => channel.type === 0 && channel.name === 'mod-log')) {
    await rest.post(Routes.guildChannels(guildId), {
      body: {
        name: 'mod-log',
        type: 0,
        parent_id: parentId,
        topic: 'Private TinyFrens moderation and operational log.',
        permission_overwrites: [
          { id: guildId, type: 0, deny: (1n << 10n).toString() },
          { id: String(modRole.id), type: 0, allow: ((1n << 10n) | (1n << 11n) | (1n << 16n)).toString() },
          { id: botUserId, type: 1, allow: ((1n << 10n) | (1n << 11n) | (1n << 16n)).toString() },
        ],
      },
      reason: 'TinyFrens server setup',
    });
    created.push('private channel `#mod-log`');
  }
  return created;
}
