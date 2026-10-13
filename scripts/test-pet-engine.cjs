// Tamagotchi-faithful pet engine mechanics: hearts, weight, discipline/scold,
// care mistakes and the downed/revive lifecycle. Existing shapes must be unaffected.
const assert = require('node:assert/strict');
const Engine = require('../web/pet-engine.js');

const NOW = 1700000000000;
const MIN = 60000, HOUR = 3600000;
const base = (extra) => Object.assign({ hunger: 80, happiness: 80, energy: 80, born: NOW, last: NOW, name: 'Bolt', shape: 'robot' }, extra);

// Hearts: 4 per stat, one heart per 25 points.
assert.equal(Engine.hearts(0), 0);
assert.equal(Engine.hearts(1), 1);
assert.equal(Engine.hearts(25), 1);
assert.equal(Engine.hearts(26), 2);
assert.equal(Engine.hearts(75), 3);
assert.equal(Engine.hearts(76), 4);
assert.equal(Engine.hearts(100), 4);

// Weight rises with food and falls with play, clamped to 0..100.
assert.equal(Math.round(Engine.act(base({ hunger: 50, happiness: 50, energy: 50 }), 'feed', NOW, () => 1).state.weight), Engine.RULES.weight.start + Engine.RULES.weight.feed);
assert.equal(Math.round(Engine.act(base({ hunger: 50, happiness: 50, energy: 50 }), 'play', NOW, () => 1).state.weight), Engine.RULES.weight.start - Engine.RULES.weight.play);
assert.equal(Math.round(Engine.act(base({ weight: 99 }), 'feed', NOW, () => 1).state.weight), 100);

// Scolding a misbehaving fren raises discipline and settles it; scolding a calm fren lowers it.
{
  const mis = Engine.act(base({ misbehaving: true }), 'scold', NOW, () => 1);
  assert.equal(mis.blocked, false);
  assert.equal(mis.state.misbehaving, false);
  assert.equal(Math.round(mis.state.discipline), Engine.RULES.discipline.start + Engine.RULES.discipline.scoldRight);
  const calm = Engine.act(base({}), 'scold', NOW, () => 1);
  assert.equal(calm.state.discipline, Engine.RULES.discipline.start - Engine.RULES.discipline.scoldWrong);
}

// Misbehaving arises on its own and shows as a need; scolding is only correct then.
{
  const later = Engine.advance(base({ nextMisbehaveAt: NOW }), NOW + 10 * MIN, () => 1);
  assert.equal(later.misbehaving, true);
  assert.ok(Engine.activeNeeds(later).indexOf('misbehave') >= 0);
}

// A care need left unmet past the window counts a mistake once per window.
{
  const neglected = Engine.advance(base({ hunger: 10 }), NOW + 2 * HOUR, () => 1);
  assert.equal(neglected.mistakes, 2, 'two 45-minute windows of hunger = 2 mistakes');
}

// Enough mistakes run a fren down: care is blocked and only revive brings them back.
{
  const state = Engine.normalize(base({ hunger: 10, mistakes: Engine.RULES.mistakes.downAt }), NOW);
  const downed = Engine.advance(state, NOW + 2 * MIN, () => 1);
  assert.equal(downed.downed, true);
  assert.deepEqual(Engine.activeNeeds(downed), ['downed']);
  assert.equal(Engine.act(downed, 'feed', NOW + 2 * MIN, () => 1).blocked, true);
  assert.equal(Engine.act(downed, 'play', NOW + 2 * MIN, () => 1).blocked, true);
  assert.equal(Engine.act(base({}), 'revive', NOW, () => 1).blocked, true, 'revive is blocked when not downed');
  const revived = Engine.act(downed, 'revive', NOW + 2 * MIN, () => 1);
  assert.equal(revived.blocked, false);
  assert.equal(revived.state.downed, false);
  assert.equal(revived.state.mistakes, 0);
  assert.equal(revived.state.hunger, Engine.RULES.downed.reviveFloor);
}

// Existing shapes are unaffected: hourly decay is unchanged and out-of-band weight is the only new
// sickness pressure (weight 30 and discipline 50 are neutral at the defaults).
{
  const decayed = Engine.view(Engine.advance(base({ shape: 'mascot', last: NOW - 2 * HOUR }), NOW, () => 1), NOW);
  assert.deepEqual([decayed.hunger, decayed.happiness, decayed.energy], [74, 76, 78]);
  assert.equal(decayed.shape, 'robot');
}

// New state survives a save/load round-trip and reaches the UI view.
{
  const saved = Engine.save(Engine.normalize(base({ weight: 55, discipline: 33, mistakes: 2, misbehaving: true, downed: true }), NOW));
  const reloaded = Engine.normalize(JSON.parse(JSON.stringify(saved)), NOW);
  assert.equal(reloaded.weight, 55);
  assert.equal(reloaded.discipline, 33);
  assert.equal(reloaded.mistakes, 2);
  assert.equal(reloaded.misbehaving, true);
  assert.equal(reloaded.downed, true);
  const out = JSON.parse(Engine.bridge('read', JSON.stringify(saved), '', NOW));
  assert.equal(out.view.weight, 55);
  assert.equal(out.view.discipline, 33);
  assert.equal(out.view.mistakes, 2);
  assert.deepEqual(out.view.hearts, { hunger: 4, happiness: 4 });
}

console.log('Pet engine tests passed: hearts, weight, discipline, care mistakes, downed/revive, neutrality and persistence.');
