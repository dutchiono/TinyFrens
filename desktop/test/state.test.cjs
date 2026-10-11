'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { care, PetStore, decay } = require('../state.cjs');
const { clampPosition, hits } = require('../geometry.cjs');
test('desktop care exactly matches bundled web care, including blocked actions and caps', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../web/app.js'), 'utf8').split('for(const a of')[0];
  for (const values of [{ hunger: 80, happiness: 80, energy: 80 }, { hunger: 99, happiness: 99, energy: 99 }, { hunger: 100, happiness: 100, energy: 100 }, { hunger: 7, happiness: 10, energy: 11 }, { hunger: 8, happiness: 99, energy: 12 }]) {
    for (const name of ['feed', 'play', 'rest', 'wave', 'dance', 'toy']) {
      const state = { ...values, born: Date.now(), last: Date.now(), name: 'Bolt', shape: 'robot', color: '#66c7d2', size: 80, speed: 60, mode: 'roam' };
      let saved = JSON.stringify(state);
      const context = vm.createContext({ window: {}, document: {}, localStorage: { getItem: () => saved, setItem: (_, value) => { saved = value; } }, Date, Math, JSON });
      vm.runInContext(source, context);
      const web = vm.runInContext('action(' + JSON.stringify(name) + ')', context), desktop = care(state, name);
      for (const stat of ['hunger', 'happiness', 'energy']) assert.equal(desktop.state[stat], web[stat]);
      assert.equal(desktop.blocked, !!web.blocked); assert.equal(desktop.feedback, web.feedback || '');
    }
  }
});
test('appearance, name and care survive reopening without transient feedback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyfrens-test-'));
  try {
    const file = path.join(dir, 'pet.json'), first = new PetStore(file);
    first.rename('  Bolt\n Jr  '); first.customize({ shape: 'robot', color: '#112233', size: 128, speed: 140 }); first.action('play'); first.mode('bubble');
    const second = new PetStore(file).read();
    assert.equal(second.name, 'Bolt Jr'); assert.equal(second.shape, 'robot'); assert.equal(second.color, '#112233'); assert.equal(second.energy, 68); assert.equal(second.mode, 'bubble'); assert.equal(second.feedback, undefined);
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
