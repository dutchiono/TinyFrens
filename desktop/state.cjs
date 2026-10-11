'use strict';
const fs = require('node:fs');
const clamp = (value, low, high, fallback) => Number.isFinite(Number(value)) ? Math.max(low, Math.min(high, Number(value))) : fallback;
function cleanName(value) { return [...String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()].slice(0, 20).join(''); }
function normalize(value = {}, now = Date.now()) {
  return { hunger: clamp(value.hunger, 0, 100, 80), happiness: clamp(value.happiness, 0, 100, 80), energy: clamp(value.energy, 0, 100, 80),
    born: clamp(value.born, 0, now, now), last: clamp(value.last, 0, now, now), name: cleanName(value.name) || 'Mochi',
    shape: ['cat', 'blob', 'robot', 'bunny', 'dog', 'bear', 'frog', 'turtle'].includes(value.shape) ? value.shape : value.shape === 'mascot' ? 'robot' : 'cat',
    color: /^#[0-9a-f]{6}$/i.test(value.color || '') ? value.color : '#a474f1',
    size: clamp(value.size, 56, 128, 80), speed: clamp(value.speed, 20, 140, 60), mode: value.mode === 'bubble' ? 'bubble' : 'roam',
    opacity: clamp(value.opacity, 40, 100, 100), sparkles: value.sparkles !== false, screenEffects: value.screenEffects !== false, fade: value.fade !== false, haptics: value.haptics !== false, reduceMotion: value.reduceMotion === true };
}
function decay(value, now = Date.now()) {
  const s = normalize(value, now), hours = Math.min(720, Math.max(0, Math.floor((now - s.last) / 3600000)));
  s.hunger = Math.max(0, s.hunger - hours * 3); s.happiness = Math.max(0, s.happiness - hours * 2); s.energy = Math.max(0, s.energy - hours);
  s.last += hours * 3600000; return s;
}
function care(value, name, now = Date.now()) {
  const s = decay(value, now);
  const blocked = name === 'feed' && s.hunger >= 100 ? 'Already full.' : name === 'rest' && s.energy >= 100 ? 'Not sleepy yet.' : name === 'play' && s.energy < 12 ? 'A nap first, then play.' : name === 'play' && s.hunger < 8 ? 'A snack first, then play.' : '';
  if (blocked) return { state: s, blocked: true, feedback: blocked };
  const before = { ...s };
  if (name === 'feed') s.hunger = Math.min(100, s.hunger + 25);
  if (name === 'rest') s.energy = Math.min(100, s.energy + 25);
  if (name === 'play') { s.happiness = Math.min(100, s.happiness + 20); s.energy -= 12; s.hunger -= 8; }
  const feedback = name === 'feed' ? 'Snacks +' + (s.hunger - before.hunger) : name === 'rest' ? 'Energy +' + (s.energy - before.energy) : name === 'play' ? 'Joy +' + (s.happiness - before.happiness) + ' · Energy −12 · Snacks −8' : '';
  return { state: s, blocked: false, feedback };
}
class PetStore {
  constructor(file) { this.file = file; let raw = {}; try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') { try { fs.copyFileSync(file, file + '.recovery-' + Date.now()); } catch {} } } this.state = decay(raw); this.save(); }
  save() { const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.state), { mode: 0o600 }); fs.renameSync(tmp, this.file); }
  read() { this.state = decay(this.state); return { ...this.state }; }
  action(name) { const result = care(this.state, name); this.state = result.state; this.save(); return { ...this.state, blocked: result.blocked, feedback: result.feedback }; }
  rename(value) { this.state.name = cleanName(value) || this.state.name; this.save(); return this.read(); }
  customize(value) { const allowed = ['color','shape','size','speed','opacity','sparkles','screenEffects','fade','haptics','reduceMotion']; const patch = Object.fromEntries(allowed.filter(k => Object.hasOwn(value, k)).map(k => [k, value[k]])); this.state = normalize({ ...this.read(), ...patch }); this.save(); return this.read(); }
  mode(value) { this.state.mode = value === 'bubble' ? 'bubble' : 'roam'; this.save(); return this.read(); }
}
module.exports = { normalize, decay, care, PetStore };
