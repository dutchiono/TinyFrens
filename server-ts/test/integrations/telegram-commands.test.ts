import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ADMIN_TELEGRAM_COMMANDS,
  GROUP_TELEGRAM_COMMANDS,
  PRIVATE_TELEGRAM_COMMANDS,
  syncTelegramCommands,
} from '../../src/integrations/telegram-commands.js';
import { TelegramApiResponse, TelegramBotApi } from '../../src/integrations/telegram-api.js';

class FakeTelegramApi implements TelegramBotApi {
  calls: Array<{ method: string; payload: Record<string, unknown>; token: string }> = [];

  async call(method: string, payload: Record<string, unknown>, token: string): Promise<TelegramApiResponse> {
    this.calls.push({ method, payload, token });
    return { status: 200, data: { ok: true, result: true } };
  }
}

describe('Telegram command menu synchronization', () => {
  test('registers private, group, and administrator menus with the commands each audience can use', async () => {
    const api = new FakeTelegramApi();
    await syncTelegramCommands(api, 'bot-token');

    assert.deepEqual(api.calls.map(call => call.payload.scope), [
      undefined,
      { type: 'all_private_chats' },
      { type: 'all_group_chats' },
      { type: 'all_chat_administrators' },
    ]);
    assert.ok(PRIVATE_TELEGRAM_COMMANDS.some(item => item.command === 'link'));
    assert.ok(GROUP_TELEGRAM_COMMANDS.some(item => item.command === 'game'));
    assert.ok(ADMIN_TELEGRAM_COMMANDS.some(item => item.command === 'warn'));
    assert.ok(ADMIN_TELEGRAM_COMMANDS.some(item => item.command === 'bot'));
    assert.ok(!GROUP_TELEGRAM_COMMANDS.some(item => item.command === 'warn'));
    assert.ok(api.calls.every(call => call.method === 'setMyCommands' && call.token === 'bot-token'));
  });

  test('surfaces Telegram rejection instead of reporting a false synchronization', async () => {
    const api: TelegramBotApi = {
      async call() {
        return { status: 400, data: { ok: false, description: 'bad scope' } };
      },
    };
    await assert.rejects(() => syncTelegramCommands(api, 'bot-token'), /bad scope/);
  });
});
