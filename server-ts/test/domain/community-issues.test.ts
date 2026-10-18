import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { loadConfig } from '../../src/config.js';
import { createAppContext } from '../../src/context.js';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import { fileCommunityIssue } from '../../src/domain/community-issues.js';

describe('shared community issue filing', () => {
  test('drafts from Discord conversation context and links replies back to Discord', async () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);
    let prompt = '';
    let issuePayload: Record<string, unknown> | null = null;
    const context = createAppContext(loadConfig({
      GEMINI_API_KEY: 'gemini-test',
      GITHUB_REPO: 'dutchiono/TinyFrens',
      GITHUB_ISSUE_LABELS: 'discord',
    }), db, {
      githubAuth: { async token() { return 'github-test'; } },
    });
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('generateContent')) {
        const body = JSON.parse(String(init?.body || '{}'));
        prompt = String(body.contents?.[0]?.parts?.[0]?.text || '');
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{
          text: 'TITLE: Stop auto-joining Scrap Runs\nLABELS: discord\n---\n## What happened\n- iono said starting `/game` should not join them.\n\n## Suggested next steps\n- Require the Join button.',
        }] } }] }), { status: 200 });
      }
      if (url.endsWith('/labels?per_page=100')) {
        return new Response(JSON.stringify([{ name: 'discord' }]), { status: 200 });
      }
      if (url.endsWith('/issues')) {
        issuePayload = JSON.parse(String(init?.body || '{}'));
        return new Response(JSON.stringify({
          number: 122,
          html_url: 'https://github.com/dutchiono/TinyFrens/issues/122',
          title: 'Stop auto-joining Scrap Runs',
          labels: [{ name: 'discord' }],
        }), { status: 201 });
      }
      throw new Error(`Unexpected fetch ${url}`);
    };

    const result = await fileCommunityIssue(context, {
      messages: [
        { name: 'iono', text: 'I notice that the group is auto joined into a /game.' },
        { name: 'iono', text: 'I am not sure that is a great idea.' },
      ],
      chatTitle: 'Discord #general',
      linkTarget: 'dc:guild:channel',
      footer: '_Filed from Discord._',
    }, fetcher);

    assert.equal(result.number, 122);
    assert.match(prompt, /group is auto joined/);
    assert.match(String(issuePayload?.body), /Require the Join button/);
    assert.deepEqual(issuePayload?.labels, ['discord']);
    assert.equal(context.repos.telegram.getChatForIssue('dutchiono/TinyFrens', 122), 'dc:guild:channel');
    db.close();
  });

  test('files a verbatim report when AI is unavailable', async () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);
    let issuePayload: Record<string, unknown> | null = null;
    const context = createAppContext(loadConfig({
      GITHUB_REPO: 'dutchiono/TinyFrens',
    }), db);
    context.githubAuth.token = async () => 'github-test';
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/labels?per_page=100')) return new Response('[]', { status: 200 });
      if (url.endsWith('/issues') && init?.method === 'POST') {
        issuePayload = JSON.parse(String(init.body));
        return new Response(JSON.stringify({
          number: 123,
          html_url: 'https://github.com/dutchiono/TinyFrens/issues/123',
          title: 'Report: /game did not respond',
          labels: [],
        }), { status: 201 });
      }
      throw new Error(`Unexpected fetch ${url}`);
    };

    await fileCommunityIssue(context, {
      messages: [],
      description: '/game did not respond',
      chatTitle: 'Telegram group',
      linkTarget: '-1001',
      footer: '_Filed from Telegram._',
    }, fetcher);

    assert.equal(issuePayload?.title, 'Report: /game did not respond');
    assert.match(String(issuePayload?.body), /\/game did not respond/);
    db.close();
  });
});
