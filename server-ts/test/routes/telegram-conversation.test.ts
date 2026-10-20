import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createAppContext } from '../../src/context.js';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import { TelegramApiResponse, TelegramBotApi } from '../../src/integrations/telegram-api.js';

class FakeTelegramApi implements TelegramBotApi {
  calls: { method: string; payload: Record<string, unknown> }[] = [];

  async call(method: string, payload: Record<string, unknown>): Promise<TelegramApiResponse> {
    this.calls.push({ method, payload });
    return { data: { ok: true, result: method === 'sendMessage' ? { message_id: this.calls.length } : {} }, status: 200 };
  }
}

describe('Telegram conversation and issue orchestration', () => {
  let app: FastifyInstance;
  let context: ReturnType<typeof createAppContext>;
  let api: FakeTelegramApi;
  let createdIssue: Record<string, unknown> | null;
  const originalFetch = globalThis.fetch;

  before(async () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);
    api = new FakeTelegramApi();
    createdIssue = null;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('generateContent')) {
        const body = JSON.parse(String(init?.body || '{}'));
        const system = String(body.systemInstruction?.parts?.[0]?.text || '');
        const text = system.includes('single GitHub issue')
          ? 'TITLE: Fix empty vault\nLABELS: bug\n---\n## What happened\n- Ada saw an empty vault\n\n## Suggested next steps\n- Reproduce it'
          : 'Never expose token=super-secret-value-12345';
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
      }
      if (url.endsWith('/labels?per_page=100')) {
        return new Response(JSON.stringify([{ name: 'bug' }, { name: 'telegram' }]), { status: 200 });
      }
      if (url.endsWith('/issues')) {
        createdIssue = JSON.parse(String(init?.body || '{}'));
        return new Response(JSON.stringify({
          number: 77,
          html_url: 'https://github.com/dutchiono/TinyFrens/issues/77',
          title: 'Fix empty vault',
          labels: [{ name: 'bug' }],
        }), { status: 201 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };
    context = createAppContext(loadConfig({
      TELEGRAM_BOT_TOKEN: 'bot-token',
      TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
      TELEGRAM_MINIAPP_URL: 'https://tinyfrens.lol/web/',
      TELEGRAM_MINIAPP_DEEP_LINK: 'https://t.me/TinyFrensBot?startapp=party',
      GEMINI_API_KEY: 'ai-key',
      GEMINI_MODEL: 'gemini-test',
      GITHUB_TOKEN: 'gh-token',
      GITHUB_REPO: 'dutchiono/TinyFrens',
      GITHUB_ISSUE_LABELS: 'telegram',
    }), db, { telegramApi: api, now: () => 1000 });
    app = await buildApp({ context });
    await app.ready();
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    await context.telegramModeration.stop();
    await app.close();
  });

  async function webhook(payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': 'webhook-secret',
      },
      payload,
    });
  }

  test('serves start, group-added, and help messages', async () => {
    await webhook({ message: { message_id: 1, text: '/start link', chat: { id: 1, type: 'private' }, from: { id: 5 } } });
    const startMarkup = api.calls.at(-1)?.payload.reply_markup as any;
    assert.match(startMarkup.inline_keyboard[0][0].url, /^https:\/\/tinyfrens\.lol\/web\/\?community-link=/);

    await webhook({ my_chat_member: { chat: { id: -10, type: 'group', title: 'Tiny Crew' }, new_chat_member: { status: 'member' } } });
    assert.match(String(api.calls.at(-1)?.payload.text), /Tiny Crew/);

    await webhook({ message: { message_id: 2, text: '/help', chat: { id: 1, type: 'private' }, from: { id: 5 } } });
    assert.match(String(api.calls.at(-1)?.payload.text), /TinyFrens — Commands/);
    assert.equal(api.calls.at(-1)?.payload.reply_to_message_id, 2);

    await webhook({ message: { message_id: 22, text: '/gamehelp', chat: { id: -10, type: 'group' }, from: { id: 5 } } });
    assert.match(String(api.calls.at(-1)?.payload.text), /no waiting period/i);

    await webhook({ message: { message_id: 23, text: '/showhelp', chat: { id: 1, type: 'private' }, from: { id: 5 } } });
    assert.match(String(api.calls.at(-1)?.payload.text), /Use for \/show/);
    assert.match(String(api.calls.at(-1)?.payload.text), /exact Telegram slot/);
  });

  test('answers common help questions locally without asking the AI provider', async () => {
    await webhook({ message: {
      message_id: 24,
      text: '@TinyFrensBot how does the scrap game work?',
      chat: { id: -20, type: 'group' },
      from: { id: 5, first_name: 'Ada' },
    } });
    const sent = api.calls.at(-1)?.payload;
    assert.match(String(sent?.text), /Group Scrap Run/);
    assert.equal(sent?.parse_mode, 'HTML');
  });

  test('answers mentions, redacts generated secrets, and threads the reply', async () => {
    await webhook({ message: {
      message_id: 3,
      text: 'hi @TinyFrensBot',
      chat: { id: -20, type: 'group' },
      from: { id: 5, first_name: 'Ada' },
    } });
    const sent = api.calls.at(-1)?.payload;
    assert.match(String(sent?.text), /\[REDACTED\]/);
    assert.doesNotMatch(String(sent?.text), /super-secret/);
    assert.equal(sent?.reply_to_message_id, 3);
  });

  test('drafts a real issue from buffered chat and persists the mapping', async () => {
    await webhook({ message: {
      message_id: 4,
      text: 'the vault is empty after transfer',
      chat: { id: -30, type: 'group', title: 'Tiny Crew' },
      from: { id: 5, first_name: 'Ada' },
    } });
    const response = await webhook({ message: {
      message_id: 5,
      text: '/issue',
      chat: { id: -30, type: 'group', title: 'Tiny Crew' },
      from: { id: 5, first_name: 'Ada' },
    } });
    assert.equal(response.statusCode, 200);
    assert.match(String(api.calls.at(-1)?.payload.text), /Opened issue #77/);
    assert.equal(context.repos.telegram.getChatForIssue('dutchiono/TinyFrens', 77), '-30');
    assert.ok(createdIssue);
    assert.deepEqual((createdIssue as Record<string, unknown>).labels, ['telegram', 'bug']);
    assert.match(String((createdIssue as Record<string, unknown>).body), /Filed from Telegram chat `-30`/);
  });
});
