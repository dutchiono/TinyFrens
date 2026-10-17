import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateTelegramReply } from '../../src/integrations/telegram.js';

const messages = [{ name: 'Ada', text: 'Hello bot', date: 1000 }];

test('retries unavailable Gemini model with supported fallback', async () => {
  const models: string[] = [];
  const reply = await generateTelegramReply(messages, 'test-key', 'retired-model', async (url) => {
    models.push(String(url));
    return models.length === 1
      ? new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 })
      : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hi Ada!' }] } }] }), { status: 200 });
  });
  assert.equal(reply, 'Hi Ada!');
  assert.match(models[0], /retired-model/);
  assert.match(models[1], /gemini-2.5-flash-lite/);
});

test('does not retry authentication or quota failures', async () => {
  let calls = 0;
  await assert.rejects(generateTelegramReply(messages, 'test-key', 'retired-model', async () => {
    calls++;
    return new Response('{}', { status: 403 });
  }), /HTTP 403/);
  assert.equal(calls, 1);
});

test('reports missing key without making requests', async () => {
  await assert.rejects(generateTelegramReply(messages, undefined), /not connected/);
});
