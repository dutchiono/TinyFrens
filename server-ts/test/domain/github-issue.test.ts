import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createIssue,
  draftIssue,
  filterLabels,
  historyFromEnv,
  issueBody,
  labelsFromEnv,
  listLabels,
  parseDraft,
  parseRepo,
  responseSummary,
  transcript,
} from '../../src/integrations/github.js';

describe('GitHub issue drafting parity', () => {
  test('normalizes repositories, transcripts, drafts, and labels', () => {
    assert.deepEqual(parseRepo('dutchiono/TinyFrens'), ['dutchiono', 'TinyFrens']);
    assert.throws(() => parseRepo('bad/repo/name'), /owner\/name/);
    assert.equal(transcript([
      { name: 'Old', text: 'ignored' },
      { name: ' Ada ', text: 'the vault is empty\u0000' },
      null,
    ], 2), '[Speaker: "Ada"] the vault is empty');
    const draft = parseDraft('TITLE: Fix empty vault\nLABELS: bug, telegram\n---\n## What happened\n- Empty');
    assert.equal(draft.title, 'Fix empty vault');
    assert.deepEqual(draft.labels, ['bug', 'telegram']);
    assert.match(issueBody(draft, '_Filed from Telegram._'), /Filed from Telegram/);
    assert.deepEqual(labelsFromEnv('telegram, bot, long'), ['telegram', 'bot', 'long']);
    assert.equal(historyFromEnv('500'), 200);
    assert.deepEqual(filterLabels(['BUG', 'missing', 'telegram'], new Set(['bug', 'Telegram'])), ['bug', 'Telegram']);
  });

  test('drafts and creates an issue through the external APIs', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes('generateContent')) {
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'TITLE: Fix vault\nLABELS: bug\n---\n## What happened\n- Empty' }] } }],
        }), { status: 200 });
      }
      if (url.endsWith('/labels?per_page=100')) {
        return new Response(JSON.stringify([{ name: 'bug' }]), { status: 200 });
      }
      return new Response(JSON.stringify({
        number: 77,
        html_url: 'https://github.com/dutchiono/TinyFrens/issues/77',
        title: 'Fix vault',
        labels: [{ name: 'bug' }],
      }), { status: 201 });
    };
    const draft = await draftIssue('[Speaker: "Ada"] vault empty', 'ai-key', 'TinyFrens crew', 'gemini-test', fetcher);
    const labels = await listLabels('dutchiono', 'TinyFrens', 'gh-token', fetcher);
    const created = await createIssue('dutchiono', 'TinyFrens', 'gh-token', draft.title, draft.body, ['bug'], fetcher);
    const summary = responseSummary(created.data, created.status, 'dutchiono', 'TinyFrens');
    assert.equal(summary.ok, true);
    assert.equal(summary.ok && summary.number, 77);
    assert.deepEqual(labels, new Set(['bug']));
    assert.equal(requests.length, 3);
    assert.match(String(requests[0].init?.body), /\\\"Ada\\\"\] vault empty/);
    assert.match(String(requests[2].init?.body), /"labels":\["bug"\]/);
  });
});
