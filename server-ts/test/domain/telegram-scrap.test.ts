import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createDbConnection } from '../../src/db/connection.js';
import { initSchema } from '../../src/db/schema.js';
import {
  joinScrapRun,
  renderScrapCard,
  resolveScrapRun,
  startScrapRun,
} from '../../src/domain/telegram-scrap.js';

describe('Telegram group scrap runs', () => {
  test('keeps one lobby per chat and joins members idempotently', () => {
    const db = createDbConnection(':memory:');
    initSchema(db);

    const first = startScrapRun(db, '-100', '1', 'pet-1', 'Ada', 1_000, 0.1);
    const duplicate = startScrapRun(db, '-100', '2', 'pet-2', 'Bob', 1_010, 0.2);
    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.state.run.id, first.state.run.id);

    const joined = joinScrapRun(db, first.state.run.id, '2', 'pet-2', 'Bob', 1_020);
    assert.equal(joined.ok, true);
    if (!joined.ok) throw new Error('join failed');
    assert.equal(joined.changed, true);
    assert.equal(joined.state.members.length, 2);

    const repeated = joinScrapRun(db, first.state.run.id, '2', 'pet-2', 'Bob', 1_021);
    assert.equal(repeated.ok, true);
    if (!repeated.ok) throw new Error('repeat join failed');
    assert.equal(repeated.changed, false);
    assert.equal(repeated.state.members.length, 2);
    db.close();
  });

  test('waits for the lobby, resolves once, and rewards every robot', () => {
    const db = createDbConnection(':memory:');
    initSchema(db);
    const started = startScrapRun(db, '-200', '1', 'pet-1', 'Ada', 2_000, 0.1);
    joinScrapRun(db, started.state.run.id, '2', 'pet-2', 'Bob', 2_010);
    const balances = new Map<string, number>();
    const grant = (petId: string, credits: number) => {
      balances.set(petId, (balances.get(petId) || 0) + credits);
    };

    const early = resolveScrapRun(db, started.state.run.id, '1', 2_059, 0.97, grant);
    assert.deepEqual(early, { ok: false, reason: 'waiting', waitSeconds: 1 });

    const resolved = resolveScrapRun(db, started.state.run.id, '2', 2_060, 0.97, grant);
    assert.equal(resolved.ok, true);
    if (!resolved.ok) throw new Error('resolve failed');
    assert.equal(resolved.changed, true);
    assert.equal(resolved.state.run.loot_name, 'Plasma Core');
    assert.equal(resolved.state.run.reward_each, 260);
    assert.deepEqual(resolved.state.members.map(member => member.reward), [260, 260]);

    const replay = resolveScrapRun(db, started.state.run.id, '1', 2_061, 0.999, grant);
    assert.equal(replay.ok, true);
    if (!replay.ok) throw new Error('replay failed');
    assert.equal(replay.changed, false);
    assert.deepEqual([...balances.entries()], [['pet-1', 260], ['pet-2', 260]]);
    db.close();
  });

  test('caps crews and escapes Telegram HTML in the dynamic card', () => {
    const db = createDbConnection(':memory:');
    initSchema(db);
    const started = startScrapRun(db, '-300', '1', 'pet-1', '<Ada>', 3_000, 0.1);
    joinScrapRun(db, started.state.run.id, '2', 'pet-2', 'Two', 3_001);
    joinScrapRun(db, started.state.run.id, '3', 'pet-3', 'Three', 3_002);
    joinScrapRun(db, started.state.run.id, '4', 'pet-4', 'Four', 3_003);
    assert.deepEqual(joinScrapRun(db, started.state.run.id, '5', 'pet-5', 'Five', 3_004), {
      ok: false,
      reason: 'full',
    });
    const state = joinScrapRun(db, started.state.run.id, '2', 'pet-2', 'Two', 3_005);
    if (!state.ok) throw new Error('state unavailable');
    const [text, keyboard] = renderScrapCard(state.state, 3_005);
    assert.match(text, /&lt;Ada&gt;/);
    assert.doesNotMatch(text, /<Ada>/);
    assert.equal(keyboard.inline_keyboard[0][0].text, '🤝 Join (4/4)');
    db.close();
  });
});
