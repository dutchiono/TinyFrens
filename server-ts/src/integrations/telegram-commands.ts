import { TelegramBotApi } from './telegram-api.js';

export interface TelegramCommand {
  command: string;
  description: string;
}

export const PRIVATE_TELEGRAM_COMMANDS: TelegramCommand[] = [
  { command: 'start', description: 'Open TinyFrens' },
  { command: 'help', description: 'See every command' },
  { command: 'gamehelp', description: 'How the group Scrap Run works' },
  { command: 'scoreboard', description: 'Weekly standings and all-time record' },
  { command: 'inventory', description: 'Salvage, Energy, and next run' },
  { command: 'craft', description: 'Craft a Signal Booster' },
  { command: 'show', description: 'Post one of your NFT frens' },
  { command: 'showhelp', description: 'How NFT slots and account sync work' },
  { command: 'link', description: 'Link an existing TinyFrens account' },
  { command: 'progress', description: 'Website, Telegram, Discord, backend work' },
  { command: 'status', description: 'Check the TinyFrens server' },
  { command: 'myid', description: 'Show your Telegram user ID' },
];

export const GROUP_TELEGRAM_COMMANDS: TelegramCommand[] = [
  { command: 'game', description: 'Start or refresh the group Scrap Run' },
  { command: 'gamehelp', description: 'How the group Scrap Run works' },
  { command: 'scoreboard', description: 'Weekly standings and all-time record' },
  { command: 'inventory', description: 'Salvage, Energy, and next run' },
  { command: 'craft', description: 'Craft a Signal Booster' },
  { command: 'show', description: 'Post one of your NFT frens' },
  { command: 'showhelp', description: 'How NFT slots and account sync work' },
  { command: 'progress', description: 'Website, Telegram, Discord, backend work' },
  { command: 'status', description: 'Check the TinyFrens server' },
  { command: 'issue', description: 'Open a GitHub issue from chat' },
  { command: 'help', description: 'See every command' },
];

export const ADMIN_TELEGRAM_COMMANDS: TelegramCommand[] = [
  ...GROUP_TELEGRAM_COMMANDS,
  { command: 'bot', description: 'Reply to mark a suspected bot' },
  { command: 'unbot', description: 'Reply to clear a suspected-bot mark' },
  { command: 'warn', description: 'Reply to warn, mute, then ban' },
  { command: 'unwarn', description: 'Reply to clear moderation warnings' },
  { command: 'ban', description: 'Reply to ban a member' },
  { command: 'filter', description: 'Manage automatic group replies' },
  { command: 'blocklist', description: 'Manage blocked text patterns' },
];

export async function syncTelegramCommands(api: TelegramBotApi, token: string): Promise<void> {
  const commandSets = [
    { commands: PRIVATE_TELEGRAM_COMMANDS },
    { commands: PRIVATE_TELEGRAM_COMMANDS, scope: { type: 'all_private_chats' } },
    { commands: GROUP_TELEGRAM_COMMANDS, scope: { type: 'all_group_chats' } },
    { commands: ADMIN_TELEGRAM_COMMANDS, scope: { type: 'all_chat_administrators' } },
  ];

  for (const payload of commandSets) {
    const response = await api.call('setMyCommands', payload, token);
    if (response.status >= 400 || response.data?.ok !== true) {
      throw new Error(String(response.data?.description || 'Telegram rejected command registration'));
    }
  }
}
