// Snack Catch round rules: scoring, lives, misses and fren movement.
const assert = require('assert');
const Game = require('../web/game-snack-catch.js');

function dropOnFren(state, kind) {
  state.items.push({ id: state.nextId++, kind, x: state.fren.x, y: Game.CATCH_TOP - 1, vy: 100 });
}
function quietRound() {
  const s = Game.create(() => 0.5);
  s.spawnIn = 1e9;
  return s;
}

{
  const s = quietRound();
  dropOnFren(s, 'berry');
  const events = Game.step(s, 0.02, {});
  assert.strictEqual(s.score, Game.ITEMS.berry.points);
  assert.strictEqual(s.items.length, 0);
  assert.deepStrictEqual(events.map(e => e.type), ['catch']);
}

{
  const s = quietRound();
  for (const kind of ['berry', 'cookie', 'star']) { dropOnFren(s, kind); Game.step(s, 0.02, {}); }
  assert.strictEqual(s.score, 1 + 2 + 5);
  assert.strictEqual(s.caught, 3);
}

{
  const s = quietRound();
  for (let i = 1; i <= Game.START_LIVES; i++) {
    dropOnFren(s, 'sock');
    const events = Game.step(s, 0.02, {});
    assert.strictEqual(s.lives, Game.START_LIVES - i);
    assert.strictEqual(events[0].type, 'ouch');
  }
  assert.strictEqual(s.over, true);
  assert.deepStrictEqual(Game.step(s, 0.02, {}), [], 'a finished round does not advance');
}

{
  const s = quietRound();
  s.items.push({ id: 1, kind: 'berry', x: 10, y: Game.HEIGHT - 10, vy: 300 });
  s.fren.x = Game.WIDTH - Game.FREN_REACH;
  for (let i = 0; i < 20; i++) Game.step(s, 0.05, {});
  assert.strictEqual(s.items.length, 0, 'missed snacks fall away');
  assert.strictEqual(s.lives, Game.START_LIVES, 'missing a snack costs nothing');
  assert.strictEqual(s.score, 0);
}

{
  const s = quietRound();
  const start = s.fren.x;
  Game.step(s, 0.05, { targetX: 0 });
  assert.ok(start - s.fren.x <= 520 * 0.05 + 1e-9, 'fren speed is capped');
  for (let i = 0; i < 50; i++) Game.step(s, 0.05, { targetX: -100 });
  assert.strictEqual(s.fren.x, Game.FREN_REACH, 'fren stays inside the play area');
  for (let i = 0; i < 50; i++) Game.step(s, 0.05, { dir: 1 });
  assert.strictEqual(s.fren.x, Game.WIDTH - Game.FREN_REACH);
}

{
  let seed = 7;
  const s = Game.create(() => ((seed = (seed * 16807) % 2147483647) / 2147483647));
  for (let i = 0; i < 600; i++) Game.step(s, 1 / 60, {});
  assert.ok(s.items.length > 0, 'snacks spawn over time');
  assert.ok(s.items.every(item => item.x >= 0 && item.x <= Game.WIDTH), 'snacks spawn inside the play area');
}

console.log('Snack Catch tests passed.');
