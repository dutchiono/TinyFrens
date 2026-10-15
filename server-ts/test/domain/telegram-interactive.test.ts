import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import {
  adminServerTriage,
  canAccessAdminTools,
  fetchGithubProgress,
  getOrCreatePet,
  isOwner,
  performCareAction,
  publicServerStatus,
  redactSecrets,
  renderGameCard,
  renderGithubProgress,
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
    assert.equal(isOwner(owner), true);
    assert.equal(isOwner(user), false);
    assert.equal(canAccessAdminTools(owner, direct), true);
    assert.equal(canAccessAdminTools(owner, group), true);
    assert.equal(canAccessAdminTools(user, direct, true), false);
    assert.equal(canAccessAdminTools(user, group, true), true);
    assert.equal(canAccessAdminTools(user, group, false), false);
  });

  test('runs game care loop, level-up, and card rendering', () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);
    let pet = getOrCreatePet(db, '-100', '42', 'Alice');
    assert.equal(pet.name, "Alice's Fren");
    [pet] = performCareAction(db, '-100', '42', 'feed');
    assert.equal(pet.hunger, 95);
    assert.equal(pet.xp, 10);
    let note: string;
    [pet, note] = performCareAction(db, '-100', '42', 'play');
    assert.match(note, /fetch/);
    [pet, note] = performCareAction(db, '-100', '42', 'rest');
    assert.match(note, /Cozy nap/);
    [, note] = performCareAction(db, '-100', '42', 'bag');
    assert.match(note, /Backpack Contents/);
    for (let roll = 1; roll <= 6; roll += 1) {
      performCareAction(db, '-100', '42', 'rest');
      [, note] = performCareAction(db, '-100', '42', 'dice', roll);
      assert.match(note, new RegExp(`Rolled a ${roll}!`));
    }
    db.prepare('UPDATE tg_fren_game SET xp=95, level=1 WHERE chat_id=? AND user_id=?').run('-100', '42');
    [pet, note] = performCareAction(db, '-100', '42', 'feed');
    assert.match(note, /LEVEL UP!/);
    assert.equal(pet.level, 2);
    const [text, keyboard] = renderGameCard(pet, 'Ready to explore!');
    assert.match(text, /Health:/);
    assert.match(text, /Ready to explore!/);
    assert.ok(keyboard.inline_keyboard.flat().some(button => button.callback_data === 'g:42:dice'));
    db.close();
  });

  test('fetches, caches, and renders GitHub progress', async () => {
    let calls = 0;
    const fetcher: typeof fetch = async url => {
      calls += 1;
      const value = String(url);
      if (value.includes('/commits')) {
        return new Response(JSON.stringify([{ sha: '1a2b3c4d', commit: { message: 'Add game mode\nbody', author: { name: 'dutch' } } }]), { status: 200 });
      }
      if (value.includes('/pulls')) {
        return new Response(JSON.stringify([{ number: 36, title: 'Telegram moderation', state: 'closed', merged_at: 'today' }]), { status: 200 });
      }
      return new Response(JSON.stringify({ workflow_runs: [{ name: 'Build & Test', conclusion: 'success' }] }), { status: 200 });
    };
    const first = await fetchGithubProgress('owner', 'interactive-test', 'token', fetcher, () => 1000);
    const second = await fetchGithubProgress('owner', 'interactive-test', 'token', fetcher, () => 1030);
    assert.equal(calls, 3);
    assert.deepEqual(second, first);
    const [text, keyboard] = renderGithubProgress(first);
    assert.match(text, /1a2b3c4/);
    assert.match(text, /#36/);
    assert.match(text, /✅ Merged/);
    assert.match(text, /🟢 Pass/);
    assert.equal(keyboard.inline_keyboard[0][0].callback_data, 'gh:refresh');
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
