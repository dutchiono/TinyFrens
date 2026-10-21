import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createDbConnection } from '../../src/db/connection.js';
import { initSchema } from '../../src/db/schema.js';
import {
  craftSignalBooster,
  expireStaleScrapRun,
  getScrapInventory,
  getLifetimeScrapStats,
  getWeeklyScoreboard,
  getOpenScrapRun,
  getScrapState,
  joinScrapRun,
  renderScrapCard,
  renderScrapScoreboard,
  resolveScrapRun,
  startScrapRun,
} from '../../src/domain/telegram-scrap.js';

describe('Telegram group scrap runs', () => {
  test('keeps one lobby per chat and joins members idempotently', () => {
    const db = createDbConnection(':memory:');
    initSchema(db);

    const first = startScrapRun(db, '-100', '1', 'Ada', 1_000, 0.1);
    const duplicate = startScrapRun(db, '-100', '2', 'Bob', 1_010, 0.2);
    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.state.run.id, first.state.run.id);

    const joined = joinScrapRun(db, first.state.run.id, '2', 'pet-2', 'Bob', 1_020);
    assert.equal(joined.ok, true);
    if (!joined.ok) throw new Error('join failed');
    assert.equal(joined.changed, true);
    assert.equal(joined.state.members.length, 1);

    const repeated = joinScrapRun(db, first.state.run.id, '2', 'pet-2', 'Bob', 1_021);
    assert.equal(repeated.ok, true);
    if (!repeated.ok) throw new Error('repeat join failed');
    assert.equal(repeated.changed, false);
    assert.equal(repeated.state.members.length, 1);
    db.close();
  });

  test('does not collide when two platforms start a run in the same second', () => {
    const db = createDbConnection(':memory:');
    initSchema(db);
    const telegram = startScrapRun(db, '-100', '1', 'Ada', 1_000, 0.42);
    const discord = startScrapRun(db, 'dc:guild:channel', '2', 'Bob', 1_000, 0.42);
    assert.notEqual(discord.state.run.id, telegram.state.run.id);
    db.close();
  });

  test('resolves immediately once and rewards every robot', () => {
    const db = createDbConnection(':memory:');
    initSchema(db);
    const started = startScrapRun(db, '-200', '1', 'Ada', 2_000, 0.1);
    assert.equal(started.state.run.join_until, 2_300);
    joinScrapRun(db, started.state.run.id, '1', 'pet-1', 'Ada', 2_001);
    joinScrapRun(db, started.state.run.id, '2', 'pet-2', 'Bob', 2_010);
    const balances = new Map<string, number>();
    const grant = (petId: string, credits: number) => {
      balances.set(petId, (balances.get(petId) || 0) + credits);
    };

    const resolved = resolveScrapRun(db, started.state.run.id, '2', 'deep', 2_011, 0.97, grant);
    assert.equal(resolved.ok, true);
    if (!resolved.ok) throw new Error('resolve failed');
    assert.equal(resolved.changed, true);
    assert.equal(resolved.state.run.loot_name, 'Plasma Core');
    assert.equal(resolved.state.run.reward_each, 360);
    assert.deepEqual(resolved.state.members.map(member => member.reward), [360, 360]);
    assert.deepEqual(getScrapInventory(db, 'pet-1'), [{ item: 'Plasma Core', quantity: 1 }]);
    const [, completedKeyboard] = renderScrapCard(resolved.state, 2_011);
    assert.equal(completedKeyboard.inline_keyboard[0][0].callback_data, 'game:new');

    const replay = resolveScrapRun(db, started.state.run.id, '1', 'deep', 2_301, 0.999, grant);
    assert.equal(replay.ok, true);
    if (!replay.ok) throw new Error('replay failed');
    assert.equal(replay.changed, false);
    assert.deepEqual([...balances.entries()], [['pet-1', 360], ['pet-2', 360]]);
    db.close();
  });

  test('caps crews and escapes Telegram HTML in the dynamic card', () => {
    const db = createDbConnection(':memory:');
    initSchema(db);
    const started = startScrapRun(db, '-300', '1', '<Ada>', 3_000, 0.1);
    assert.match(renderScrapCard(started.state, 3_000)[0], /Live now/);
    assert.match(renderScrapCard(started.state, 3_000)[0], /account Energy/i);
    assert.match(renderScrapCard(started.state, 3_000)[0], /No one yet/);
    joinScrapRun(db, started.state.run.id, '1', 'pet-1', '<Ada>', 3_000);
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
    assert.equal(keyboard.inline_keyboard[0][0].text, '🤝 Join crew (4/4)');
    db.close();
  });

  test('allows crew to join an open run after the old lobby deadline', () => {
    const db = createDbConnection(':memory:');
    initSchema(db);
    const started = startScrapRun(db, '-350', '1', 'Ada', 3_500, 0.1);

    const joined = joinScrapRun(db, started.state.run.id, '2', 'pet-2', 'Bob', 3_801);
    assert.equal(joined.ok, true);
    if (!joined.ok) throw new Error('late join failed');
    assert.equal(joined.state.members[0]?.display_name, 'Bob');
    db.close();
  });

  test('expires abandoned runs after a recovery window', () => {
    const db = createDbConnection(':memory:');
    initSchema(db);
    const started = startScrapRun(db, '-400', '1', 'Ada', 4_000, 0.1);

    assert.equal(expireStaleScrapRun(db, '-400', 4_900), false);
    assert.equal(getOpenScrapRun(db, '-400')?.run.id, started.state.run.id);

    assert.equal(expireStaleScrapRun(db, '-400', 4_901), true);
    assert.equal(getOpenScrapRun(db, '-400'), undefined);
    assert.equal(getScrapState(db, started.state.run.id)?.run.status, 'expired');
    db.close();
  });

  test('charges a new member once and never charges an idempotent join', () => {
    const db = createDbConnection(':memory:');
    initSchema(db);
    const run = startScrapRun(db, 'energy', '1', 'Ada', 10_000, 0.1).state;
    let spends = 0;
    const first = joinScrapRun(db, run.run.id, '1', 'pet-1', 'Ada', 10_001, () => { spends += 1; });
    const replay = joinScrapRun(db, run.run.id, '1', 'pet-1', 'Ada', 10_002, () => { spends += 1; });
    assert.equal(first.ok && first.changed, true);
    assert.equal(replay.ok && replay.changed, false);
    assert.equal(spends, 1);
    db.close();
  });

  test('deep scans can miss and crafted boosters prevent the miss once', () => {
    const db = createDbConnection(':memory:');
    initSchema(db);
    const seed = db.prepare(
      'INSERT INTO tg_scrap_inventory(pet_id, item, quantity, updated_at) VALUES(?, ?, ?, ?)'
    );
    seed.run('pet-1', 'Rusted Gear', 3, 1);
    seed.run('pet-1', 'Copper Coil', 2, 1);
    assert.equal(craftSignalBooster(db, 'pet-1', 2), true);

    const run = startScrapRun(db, 'boosted', '1', 'Ada', 20_000, 0.1).state;
    joinScrapRun(db, run.run.id, '1', 'pet-1', 'Ada', 20_001);
    const boosted = resolveScrapRun(db, run.run.id, '1', 'deep', 20_002, 0, () => undefined);
    assert.equal(boosted.ok, true);
    if (!boosted.ok) throw new Error('boosted scan failed');
    assert.equal(boosted.state.run.booster_used, 1);
    assert.equal(boosted.state.run.loot_name, 'Rusted Gear');

    const missRun = startScrapRun(db, 'miss', '1', 'Ada', 20_100, 0.2).state;
    joinScrapRun(db, missRun.run.id, '1', 'pet-1', 'Ada', 20_101);
    const missed = resolveScrapRun(db, missRun.run.id, '1', 'deep', 20_102, 0, () => undefined);
    assert.equal(missed.ok, true);
    if (!missed.ok) throw new Error('miss scan failed');
    assert.equal(missed.state.run.loot_name, 'Empty Signal');
    assert.equal(missed.state.run.reward_each, 0);
    db.close();
  });

  test('ranks weekly salvage and tracks objectives', () => {
    const db = createDbConnection(':memory:');
    initSchema(db);
    const run = startScrapRun(db, 'ranked', '1', 'Ada', 100_000, 0.1).state;
    joinScrapRun(db, run.run.id, '1', 'pet-1', 'Ada', 100_001);
    joinScrapRun(db, run.run.id, '2', 'pet-2', 'Bob', 100_002);
    resolveScrapRun(db, run.run.id, '1', 'safe', 100_003, 0.99, () => undefined);
    const scores = getWeeklyScoreboard(db, 100_004);
    assert.deepEqual(scores.map(score => [score.displayName, score.salvage, score.rareFinds, score.crewRuns]), [
      ['Ada', 160, 1, 1],
      ['Bob', 160, 1, 1],
    ]);
    db.close();
  });

  test('preserves personal lifetime totals after the weekly scoreboard resets', () => {
    const db = createDbConnection(':memory:');
    initSchema(db);
    const oldRun = startScrapRun(db, 'old', '1', 'Ada', 100_000, 0.1).state;
    joinScrapRun(db, oldRun.run.id, '1', 'pet-1', 'Ada', 100_001);
    resolveScrapRun(db, oldRun.run.id, '1', 'safe', 100_002, 0, () => undefined);

    const afterReset = 1_000_000;
    assert.deepEqual(getWeeklyScoreboard(db, afterReset), []);
    assert.deepEqual(getLifetimeScrapStats(db, 'pet-1'), {
      petId: 'pet-1', displayName: 'Ada', salvage: 25, runs: 1, rareFinds: 0, crewRuns: 0,
    });
    const card = renderScrapScoreboard(db, afterReset, 'pet-1');
    assert.match(card, /No completed runs this week/);
    assert.match(card, /Your all-time record/);
    assert.match(card, /25 salvage · 1 runs/);
    db.close();
  });
});
