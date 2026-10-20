import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { discordGameHelpText, discordHelpText, discordShowHelpText } from '../../src/domain/community-help.js';
import { telegramHelpText } from '../../src/integrations/telegram.js';
import { DISCORD_COMMANDS } from '../../src/integrations/discord-api.js';
import {
  ADMIN_TELEGRAM_COMMANDS,
  GROUP_TELEGRAM_COMMANDS,
  PRIVATE_TELEGRAM_COMMANDS,
} from '../../src/integrations/telegram-commands.js';

describe('community command help parity', () => {
  test('registers and documents Discord help commands', () => {
    const commands = new Set(DISCORD_COMMANDS.map(command => command.name));
    assert.ok(commands.has('help'));
    assert.ok(commands.has('gamehelp'));
    assert.match(discordHelpText(), /`\/game`/);
    assert.match(discordHelpText(), /Warn message/);
    assert.match(discordShowHelpText(), /`\/link/);
    const issue = DISCORD_COMMANDS.find(command => command.name === 'issue');
    assert.ok(issue?.options?.every(option => option.required === false));
    assert.match(String(issue?.description), /context/i);
  });

  test('gives Discord an adapter for every Telegram command', () => {
    const telegram = new Set(
      [...PRIVATE_TELEGRAM_COMMANDS, ...GROUP_TELEGRAM_COMMANDS, ...ADMIN_TELEGRAM_COMMANDS]
        .map(command => command.command)
    );
    const discord = new Set(DISCORD_COMMANDS.filter(command => !command.type || command.type === 1).map(command => command.name));
    assert.deepEqual([...telegram].filter(command => !discord.has(command)), []);
  });

  test('describes the shared instant Scrap engine consistently', () => {
    assert.match(discordGameHelpText(), /no waiting period/i);
    assert.match(discordGameHelpText(), /does not join you/);
    assert.match(discordGameHelpText(), /same Scrap engine, reward rules, and database/);
    assert.match(discordGameHelpText(), /never creates a playable Discord account/i);
    assert.match(discordGameHelpText(), /explicitly connects Discord/i);
    assert.match(telegramHelpText('game'), /no waiting period/i);
    assert.doesNotMatch(telegramHelpText('game'), /five-minute|45-second/i);
  });
});
