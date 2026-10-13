'use strict';
const fs = require('node:fs');
const SERVER = 'https://tinyfrens.miono.live';
const PATHS = new Set(['/api/register', '/api/wallet-link/status', '/api/wallet-link/challenge',
  '/api/wallet-link/confirm', '/api/wallet-link/disconnect', '/api/wallet-link/nfts', '/api/featured/hood-turtle',
  '/api/turtle-connect/start', '/api/turtle-connect/status', '/api/turtle-connect/accept', '/api/turtle-connect/from-device']);

class TurtleStore {
  constructor(file, fetcher = fetch, clock = Date.now) {
    this.file = file; this.fetch = fetcher; this.clock = clock; this.selected = []; this.generation = 0;
    try { const saved = JSON.parse(fs.readFileSync(file, 'utf8')); this.selected = Array.isArray(saved) ? saved : saved ? [saved] : []; } catch {}
  }
  async request(server, path, body) {
    if (server !== SERVER || !PATHS.has(path) || !body || typeof body !== 'object' || JSON.stringify(body).length > 4096) throw new Error('Unsupported turtle request');
    const response = await this.fetch(SERVER + path, {method:'POST', redirect:'error', signal:AbortSignal.timeout(30000),
      headers:{'Content-Type':'application/json', Origin:'null'}, body:JSON.stringify(body)});
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error('Turtle response too large');
    const data = JSON.parse(text);
    if (!response.ok) throw new Error(data.error || 'Turtle connection failed');
    return data;
  }
  save() {
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.selected), {mode:0o600});
    fs.renameSync(this.file + '.tmp', this.file);
  }
  clear() { this.generation++; this.selected = []; this.save(); }
  remove(tokenId) { this.generation++; this.selected = this.selected.filter(nft => nft.tokenId !== tokenId); this.save(); }
  setMotion(tokenId, mode, speed) {
    if (!['roam', 'bubble'].includes(mode) || !Number.isInteger(speed) || speed < 20 || speed > 140) throw new Error('Invalid companion movement');
    const nft = this.selected.find(item => item.tokenId === tokenId);
    if (!nft) throw new Error('Companion not found');
    nft.motion = {mode, speed}; this.save();
    return this.view();
  }
  removeWallet(address) { this.generation++; this.selected = this.selected.filter(nft => (nft.wallet || nft.originalOwner || '').toLowerCase() !== address.toLowerCase()); this.save(); }
  view() {
    if (!this.selected.length) return {selected:false, active:false};
    const items = this.selected.filter(nft => Number.isFinite(nft.validUntil) && this.clock() < nft.validUntil * 1000)
      .map(({deviceToken, ...nft}) => nft);
    if (!items.length) return {selected:true, active:false};
    return {...items[0], selected:true, active:true, items};
  }
  async import(server, body) {
    const generation = this.generation;
    const data = await this.request(server, '/api/featured/hood-turtle', body);
    if (!data.active) throw new Error('This wallet no longer owns that turtle');
    if (!Number.isInteger(data.tokenId) || data.tokenId !== body.tokenId || !Number.isFinite(data.validUntil) ||
        data.validUntil * 1000 <= this.clock() || data.validUntil * 1000 > this.clock() + 86_405_000 ||
        typeof data.image !== 'string' || !/^data:image\/(svg\+xml|png);base64,/.test(data.image)) throw new Error('Invalid turtle artwork or verification');
    if (generation !== this.generation) throw new Error('Turtle selection changed');
    const remaining = this.selected.filter(nft => nft.tokenId !== data.tokenId);
    if (remaining.length >= 5) throw new Error('Show up to five companions. Remove one first.');
    const existing = this.selected.find(nft => nft.tokenId === data.tokenId);
    const imported = {...data, deviceToken:body.token, motion:existing?.motion || {mode:'roam', speed:60}};
    this.selected = existing ? this.selected.map(nft => nft === existing ? imported : nft) : [...remaining, imported]; this.save();
    return this.view();
  }
  async renew() {
    const due = this.selected.filter(nft => this.clock() >= nft.validUntil * 1000);
    if (!due.length || this.renewing || this.clock() < (this.retryAt || 0)) return false;
    this.renewing = true; this.retryAt = this.clock() + 60000;
    let updated = false;
    try {
      for (const nft of due) {
        if (!this.selected.includes(nft)) continue;
        try { await this.import(SERVER, {token:nft.deviceToken, tokenId:nft.tokenId}); updated = true; }
        catch { /* Expired companions stay hidden; retry after one minute. */ }
      }
      return updated;
    } finally { this.renewing = false; }
  }
}
module.exports = {TurtleStore, SERVER};
