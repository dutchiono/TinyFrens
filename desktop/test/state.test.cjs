'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { care, PetStore, decay, Engine } = require('../state.cjs');
const { clampPosition, hits } = require('../geometry.cjs');
test('desktop care exactly matches the shared pet engine, including blocked actions and caps', () => {
  for (const values of [{ hunger: 80, happiness: 80, energy: 80 }, { hunger: 99, happiness: 99, energy: 99 }, { hunger: 100, happiness: 100, energy: 100 }, { hunger: 7, happiness: 10, energy: 11 }, { hunger: 8, happiness: 99, energy: 12 }]) {
    for (const name of ['feed', 'play', 'rest', 'wave', 'dance', 'toy']) {
      const now = Date.now(), state = { ...values, born: now, last: now, name: 'Bolt', shape: 'robot', color: '#66c7d2', size: 80, speed: 60, mode: 'roam' };
      const shared = JSON.parse(Engine.bridge('act', JSON.stringify(state), JSON.stringify(name), now));
      const desktop = care(state, name, now);
      for (const stat of ['hunger', 'happiness', 'energy']) assert.equal(Math.round(desktop.state[stat]), shared.view[stat]);
      assert.equal(desktop.blocked, !!shared.blocked); assert.equal(desktop.feedback, shared.feedback || '');
    }
  }
});
test('appearance, name and care survive reopening without transient feedback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyfrens-test-'));
  try {
    const file = path.join(dir, 'pet.json'), first = new PetStore(file);
    first.rename('  Bolt\n Jr  '); first.customize({ shape: 'robot', color: '#112233', size: 128, speed: 140, expression: 'shades', accessory: 'party_hat' }); first.action('play'); first.mode('bubble');
    const second = new PetStore(file).read();
    assert.equal(second.name, 'Bolt Jr'); assert.equal(second.shape, 'robot'); assert.equal(second.color, '#112233'); assert.equal(second.expression, 'shades'); assert.equal(second.accessory, 'party_hat'); assert.equal(second.energy, 68); assert.equal(second.mode, 'bubble'); assert.equal(second.feedback, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('hourly decay and migrated robot preserve stats', () => {
  const now = Date.now(), state = decay({ hunger: 80, happiness: 80, energy: 80, last: now - 2 * 3600000, shape: 'mascot' }, now);
  assert.deepEqual([state.hunger, state.happiness, state.energy], [74, 76, 78]); assert.equal(state.shape, 'robot');
});
test('effect preferences persist and changing shape preserves them', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tinyfrens-effects-'));
  try{const file=path.join(dir,'pet.json'),store=new PetStore(file);store.customize({opacity:55,sparkles:false,screenEffects:false,fade:false,haptics:false,reduceMotion:true});store.customize({shape:'blob'});const s=new PetStore(file).read();assert.equal(s.opacity,55);assert.equal(s.reduceMotion,true);for(const k of ['sparkles','screenEffects','fade','haptics'])assert.equal(s[k],false);assert.equal(s.shape,'blob');}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('negative monitor coordinates clamp safely and only pet/buttons intercept clicks', () => {
  const area = { x: -1920, y: -200, width: 1920, height: 1080 };
  assert.deepEqual(clampPosition({ x: -5000, y: 5000 }, area, 340, 400), { x: -1920, y: 480 });
  const bounds = { x: -1000, y: 200 }, regions = [{ x: 100, y: 100, width: 128, height: 148 }];
  assert.equal(hits({ x: -895, y: 305 }, bounds, regions), true);
  assert.equal(hits({ x: -990, y: 210 }, bounds, regions), false);
});
test('needs: clean clears mess and vitamin cures, blocked when not applicable', () => {
  const now = Date.now();
  const base = { hunger: 80, happiness: 80, energy: 80, born: now, last: now, name: 'Bolt', shape: 'robot' };
  const clean = Engine.act({ ...base, poops: 2 }, 'clean', now, () => 1);
  assert.ok(!clean.blocked); assert.equal(Engine.view(clean.state, now).poops, 0);
  assert.ok(Engine.act(base, 'clean', now, () => 1).blocked);
  const cure = Engine.act({ ...base, sick: true }, 'vitamin', now, () => 1);
  assert.ok(!cure.blocked); assert.equal(cure.state.sick, false);
  assert.ok(Engine.act(base, 'vitamin', now, () => 1).blocked);
});
test('needs: play always cheers a sad fren and a calm sick fren recovers', () => {
  const now = Date.now();
  const cheered = Engine.act({ hunger: 80, happiness: 0, energy: 80, born: now, last: now }, 'play', now, () => 1);
  assert.ok(cheered.state.happiness > 25, 'play lifts a sad fren out of the sad band');
  const sick = Engine.save(Engine.normalize({ hunger: 80, happiness: 80, energy: 80, sick: true, last: now - 4 * 3600000, born: now - 4 * 3600000 }, now));
  assert.equal(Engine.advance(sick, now, () => 1).sick, false);
});
