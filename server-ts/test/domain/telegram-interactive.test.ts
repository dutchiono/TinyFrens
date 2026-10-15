import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import {
  adminServerTriage,
  canAccessAdminTools,
  fetchGithubProgress,
  isOwner,
  publicServerStatus,
  redactSecrets,
  renderGithubProgress,
  renderTelegramUpdateBriefing,
  telegramUpdateBriefingRequest,
} from '../../src/integrations/telegram.js';

describe('Telegram interactive parity', () => {
  test('redacts secrets while preserving normal conversation', () => {
    assert.match(redactSecrets('key 0x' + '4c'.repeat(32)), /\[REDACTED_SECRET\]/);
    assert.match(redactSecrets('token 1234567890:ABCdefGHIJklmnOPQRstuvWxyz123456789'), /\[REDACTED_SECRET\]/);
    assert.match(redactSecrets('use ghp_1234567890abcdefghijklmnopqrstuvwx'), /\[REDACTED_SECRET\]/);
    assert.match(redactSecrets('Key AIzaSyD1234567890abcdefghijklmnopqrstuv'), /\[REDACTED_SECRET\]/);
    assert.match(redactSecrets("SECRET_KEY='my-super-secret-password-12345'"), /\[REDACTED\]/);
    const normal = "Hello TinyFrens! Let's play a game and roll the dice.";
    assert.equal(redactSecrets(normal), normal);
  });

  test('enforces owner and group-admin permissions', () => {
    const owner = { username: 'dutchiono', id: 1 };
    const user = { username: 'random_user', id: 2 };
    const group = { type: 'supergroup', id: -100 };
    const direct = { type: 'private', id: 1 };
    assert.equal(isOwner(owner, '1'), true);
    assert.equal(isOwner({ username: 'dutchiono', id: 2 }, '1'), false);
    assert.equal(isOwner(user), false);
    assert.equal(canAccessAdminTools(owner, direct, false, '1'), true);
    assert.equal(canAccessAdminTools(owner, group, false, '1'), true);
    assert.equal(canAccessAdminTools(user, direct, true), false);
    assert.equal(canAccessAdminTools(user, group, true), true);
    assert.equal(canAccessAdminTools(user, group, false), false);
  });

  test('fetches, caches, and renders GitHub progress', async () => {
    let calls = 0;
    const fetcher: typeof fetch = async url => {
      calls += 1;
      const value = String(url);
      if (value.includes('/commits?')) {
        return new Response(JSON.stringify([{ sha: '1a2b3c4d', commit: { message: 'Add game mode\nbody', author: { name: 'dutch' } } }]), { status: 200 });
      }
      if (value.includes('/commits/')) {
        return new Response(JSON.stringify({ files: [{ filename: 'web/games.js' }] }), { status: 200 });
      }
      if (value.includes('/pulls')) {
        return new Response(JSON.stringify([{ number: 36, title: 'Telegram moderation', state: 'closed', merged_at: 'today' }]), { status: 200 });
      }
      return new Response(JSON.stringify({ workflow_runs: [{ name: 'Build & Test', conclusion: 'success' }] }), { status: 200 });
    };
    const first = await fetchGithubProgress('owner', 'interactive-test', 'token', fetcher, () => 1000);
    const second = await fetchGithubProgress('owner', 'interactive-test', 'token', fetcher, () => 1030);
    assert.equal(calls, 4);
    assert.deepEqual(second, first);
    const [text, keyboard] = renderGithubProgress(first);
    assert.match(text, /1a2b3c4/);
    assert.match(text, /#36/);
    assert.match(text, /✅ Merged/);
    assert.match(text, /🟢 Pass/);
    assert.equal(keyboard.inline_keyboard[0][0].callback_data, 'gh:refresh');
  });

  test('recognizes update briefings, preserves the requested mention, and filters old activity', () => {
    const request = telegramUpdateBriefingRequest(
      '@TinyFrensBot say hi to @LIMI7LESS and fill them in on everything weve done in the last 24 hrs',
      'TinyFrensBot'
    );
    assert.deepEqual(request, { target: '@LIMI7LESS', hours: 24 });
    assert.equal(telegramUpdateBriefingRequest('@TinyFrensBot say hi to @friend'), null);
    assert.deepEqual(telegramUpdateBriefingRequest('@TinyFrensBot what is new?'), { target: null, hours: 24 });

    const text = renderTelegramUpdateBriefing({
      ok: true,
      commits: [
        {
          sha: 'new1234',
          msg: 'Add group scrap runs',
          author: 'dutch',
          timestamp: 99_000,
          files: ['server-ts/src/routes/telegram.ts', 'server-ts/src/db/schema.ts'],
          areas: ['telegram', 'backend'],
        },
        { sha: 'old1234', msg: 'Old change', author: 'dutch', timestamp: 1_000 },
      ],
      prs: [{ num: 98, title: 'Quiet Telegram scrap runs', state: 'open', merged: false, timestamp: 99_500 }],
      runs: [{ name: 'Build', conclusion: 'success', timestamp: 99_900 }],
    }, '@LIMI7LESS', 'TinyFrens', 24, 100_000);
    assert.match(text, /^Hey @LIMI7LESS/);
    assert.match(text, /🌐 Website/);
    assert.match(text, /No verified code changes/);
    assert.match(text, /🤖 Telegram/);
    assert.match(text, /⚙️ Backend/);
    assert.match(text, /PR #98/);
    assert.match(text, /Add group scrap runs/);
    assert.match(text, /bot commands/);
    assert.doesNotMatch(text, /Old change/);
    assert.match(text, /Build: success/);
    assert.match(text, /“live” is only reported after deployment verification/);
  });

  test('renders public status and private admin triage', () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);
    const [status] = publicServerStatus(2, 7300);
    assert.match(status, /2h 1m/);
    assert.match(status, /2 spaces/);
    assert.doesNotMatch(status, /dutchiono/);
    const triage = adminServerTriage(db, 2, 7300);
    assert.match(triage, /TinyFrens Host & Server Triage/);
    assert.match(triage, /@dutchiono/);
    assert.match(triage, /Active Rooms:<\/b> 2/);
    db.close();
  });
});
