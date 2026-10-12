'use strict';
const fs = require('node:fs');

function loadEngine() {
  for (const id of ['../web/pet-engine.js', './web/pet-engine.js']) {
    try { return require(id); } catch {}
  }
  throw new Error('TinyFrens pet engine not found.');
}

const Engine = loadEngine();

function persistable(state, now = Date.now()) {
  return Engine.save(Engine.advance(state || {}, now));
}

function normalize(value = {}, now = Date.now()) {
  return persistable(value, now);
}

function decay(value, now = Date.now()) {
  return Engine.view(Engine.advance(value || {}, now), now);
}

function care(value, name, now = Date.now()) {
  const result = Engine.act(value || {}, name, now);
  return {
    state: Engine.save(result.state),
    blocked: result.blocked,
    feedback: result.feedback || '',
    animation: result.animation || ''
  };
}

class PetStore {
  constructor(file) {
    this.file = file;
    let raw = {};
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        try { fs.copyFileSync(file, file + '.recovery-' + Date.now()); } catch {}
      }
    }
    this.state = persistable(raw);
    this.save();
  }
  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  read() {
    this.state = persistable(this.state);
    this.save();
    return Engine.view(this.state);
  }
  action(name) {
    const result = care(this.state, name);
    this.state = result.state;
    this.save();
    return { ...Engine.view(this.state), blocked: result.blocked, feedback: result.feedback, animation: result.animation };
  }
  rename(value) {
    this.state = Engine.save(Engine.rename(this.state, value));
    this.save();
    return this.read();
  }
  customize(value) {
    this.state = Engine.save(Engine.customize(this.state, value));
    this.save();
    return this.read();
  }
  mode(value) {
    this.state = Engine.save(Engine.setMode(this.state, value));
    this.save();
    return this.read();
  }
}

module.exports = { normalize, decay, care, PetStore, Engine };
