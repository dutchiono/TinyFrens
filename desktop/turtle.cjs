'use strict';
const fs = require('node:fs');
const SERVER = 'https://tinyfrens.miono.live';
const PATHS = new Set(['/api/register', '/api/wallet-link/status', '/api/wallet-link/challenge',
  '/api/wallet-link/confirm', '/api/wallet-link/disconnect', '/api/wallet-link/nfts', '/api/featured/hood-turtle',
  '/api/turtle-connect/start', '/api/turtle-connect/status', '/api/turtle-connect/accept']);

class TurtleStore {
  constructor(file, fetcher = fetch, clock = Date.now) {
    this.file = file; this.fetch = fetcher; this.clock = clock; this.selected = null; this.generation = 0;
    try { this.selected = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
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
  clear() { this.generation++; this.selected = null; this.save(); }
  view() {
    if (!this.selected) return {selected:false, active:false};
    const {tokenId, name, image, validUntil} = this.selected;
    if (!Number.isFinite(validUntil) || this.clock() >= validUntil * 1000) return {selected:true, active:false};
    return {selected:true, active:true, tokenId, name, image, validUntil};
  }
  async import(server, body) {
    const generation = ++this.generation;
    const data = await this.request(server, '/api/featured/hood-turtle', body);
    if (!data.active) throw new Error('This wallet no longer owns that turtle');
    if (!Number.isInteger(data.tokenId) || data.tokenId !== body.tokenId || !Number.isFinite(data.validUntil) ||
        data.validUntil * 1000 <= this.clock() || data.validUntil * 1000 > this.clock() + 86_405_000 ||
        typeof data.image !== 'string' || !/^data:image\/(svg\+xml|png);base64,/.test(data.image)) throw new Error('Invalid turtle artwork or verification');
    if (generation !== this.generation) throw new Error('Turtle selection changed');
    this.selected = {...data, deviceToken:body.token}; this.save();
    return this.view();
  }
  async renew() {
    if (!this.selected || this.view().active || this.renewing || this.clock() < (this.retryAt || 0)) return false;
    this.renewing = true; this.retryAt = this.clock() + 60000;
    const current = this.selected;
    try {
      await this.import(SERVER, {token:current.deviceToken, tokenId:current.tokenId});
      return true;
    } catch { return false; }
    finally { this.renewing = false; }
  }
}
module.exports = {TurtleStore, SERVER};
