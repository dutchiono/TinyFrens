// Fren Hop round rules: hopping, hits, hearts, berries, bees and fair spacing.
const assert = require('assert');
const Game = require('../web/game-fren-hop.js');

const DT = 1 / 60;
function quietRound() {
  const s = Game.create(() => 0.5);
  s.nextSpawn = 1e9;
  return s;
}
function place(s, kind, x) { s.obstacles.push({ id: s.nextId++, kind, x }); }
function run(s, seconds, input = () => ({})) {
  const events = [];
  for (let t = 0; t < seconds; t += DT) events.push(...Game.step(s, DT, input(t)));
  return events;
}

{
  const s = quietRound();
  const events = Game.step(s, DT, { jump: true });
  assert.deepStrictEqual(events.map(e => e.type), ['jump']);
  let peak = 0;
  run(s, 1, () => { peak = Math.max(peak, s.fren.y); return {}; });
  assert.ok(peak > Game.OBSTACLES.cactus.h + 60, 'a hop clears the tallest ground obstacle');
  assert.strictEqual(s.fren.y, 0, 'the fren lands again');
  assert.strictEqual(s.fren.vy, 0);
}

{
  const s = quietRound();
  Game.step(s, DT, { jump: true });
  run(s, 0.1);
  const vy = s.fren.vy;
  Game.step(s, DT, { jump: true });
  assert.ok(s.fren.vy < vy, 'no double hop in the air');
}

{
  const buffered = quietRound();
  Game.step(buffered, DT, { jump: true });
  while (!(buffered.fren.vy < 0 && buffered.fren.y < 15)) Game.step(buffered, DT, {});
  const events = [...Game.step(buffered, DT, { jump: true })];
  for (let i = 0; i < 10 && !events.some(e => e.type === 'jump'); i++) events.push(...Game.step(buffered, DT, {}));
  assert.ok(events.some(e => e.type === 'jump'), 'early tap hops on landing');
}

{
  const s = quietRound();
  place(s, 'rock', Game.FREN_X);
  const events = Game.step(s, DT, {});
  assert.strictEqual(s.lives, Game.START_LIVES - 1);
  assert.ok(events.some(e => e.type === 'hit'));
  run(s, 0.3);
  place(s, 'cactus', Game.FREN_X);
  Game.step(s, DT, {});
  assert.strictEqual(s.lives, Game.START_LIVES - 1, 'brief safety after a hit');
}

{
  const s = quietRound();
  for (let i = 0; i < Game.START_LIVES; i++) {
    place(s, 'cactus', Game.FREN_X);
    Game.step(s, DT, {});
    run(s, Game.HURT_TIME + 0.1);
  }
  assert.strictEqual(s.over, true);
  assert.deepStrictEqual(Game.step(s, DT, {}), [], 'a finished round does not advance');
}

{
  const s = quietRound();
  place(s, 'bee', Game.FREN_X);
  Game.step(s, DT, {});
  assert.strictEqual(s.lives, Game.START_LIVES, 'staying on the ground passes under a bee');
  const jumper = quietRound();
  Game.step(jumper, DT, { jump: true });
  run(jumper, 0.15);
  place(jumper, 'bee', Game.FREN_X);
  Game.step(jumper, DT, {});
  assert.strictEqual(jumper.lives, Game.START_LIVES - 1, 'hopping into a bee hurts');
}

{
  const s = quietRound();
  Game.step(s, DT, { jump: true });
  run(s, 0.3);
  place(s, 'berry', Game.FREN_X);
  const events = Game.step(s, DT, {});
  assert.ok(events.some(e => e.type === 'berry'));
  assert.strictEqual(s.berries, 1);
  assert.strictEqual(s.score, Math.floor(s.distance / Game.DISTANCE_PER_POINT) + Game.BERRY_POINTS);
  assert.ok(!s.obstacles.some(o => o.kind === 'berry'), 'a berry is collected once');
}

{
  const s = quietRound();
  place(s, 'rock', Game.FREN_X + 150);
  const hopAt = (Game.FREN_X + 150 - Game.FREN_X - 40) / Game.speed(0);
  run(s, 1.5, t => ({ jump: Math.abs(t - hopAt + 0.15) < DT / 2 }));
  assert.strictEqual(s.lives, Game.START_LIVES, 'a well-timed hop clears a rock');
}

{
  let seed = 11;
  const s = Game.create(() => ((seed = (seed * 16807) % 2147483647) / 2147483647));
  s.lives = 1e9;
  run(s, 60);
  const ground = s.obstacles.filter(o => o.kind !== 'berry').map(o => o.x).sort((a, b) => a - b);
  for (let i = 1; i < ground.length; i++) assert.ok(ground[i] - ground[i - 1] >= Game.minGap(Game.speed(0)) - 1, 'obstacles stay hop-able apart');
  assert.ok(Game.speed(60) > Game.speed(0), 'the run speeds up');
  assert.ok(s.score > 0);
}

console.log('Fren Hop tests passed.');
