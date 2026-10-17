import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { discordGameHelpText, discordHelpText } from '../../src/domain/community-help.js';
import { telegramHelpText } from '../../src/integrations/telegram.js';
import { DISCORD_COMMANDS } from '../../src/integrations/discord-api.js';

describe('community command help parity', () => {
  test('registers and documents Discord help commands', () => {
    const commands = new Set(DISCORD_COMMANDS.map(command => command.name));
    assert.ok(commands.has('help'));
    assert.ok(commands.has('gamehelp'));
    assert.match(discordHelpText(), /`\/game`/);
    assert.match(discordHelpText(), /Warn message/);
  });

  test('describes the shared five-minute Scrap engine consistently', () => {
    assert.match(discordGameHelpText(), /five-minute window/);
    assert.match(discordGameHelpText(), /same Scrap rules, persistence, and account economy/);
    assert.match(telegramHelpText('game'), /five-minute window/);
    assert.doesNotMatch(telegramHelpText('game'), /45-second/);
  });
});
