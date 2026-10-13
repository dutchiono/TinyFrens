const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const listeners = new Map(), requests = [];
const name = {}, balance = {};
const account = {
  querySelector: selector => selector === '.tf-account-name' ? name : balance,
  addEventListener(type, callback) { listeners.set('account:' + type, callback); },
};
let device = {token:'first'}, failBalance = false, pending = null;
const context = {
  URL, Number, Promise, console, setInterval: () => {},
  document: {
    currentScript: {src:'https://tinyfrens.lol/web/account-header.js'}, hidden:false,
    querySelector: () => ({append: () => {}}),
    createElement: () => account, getElementById: () => ({}),
    addEventListener: (type, fn) => listeners.set(type, fn),
  },
  localStorage: {getItem: () => null},
  window: {
    TINYFRENS_SERVER: 'https://relay.test', TinyFrensFriends: {identity: () => device},
    showScreen: screen => { context.screen = screen; },
    addEventListener: (type, fn) => listeners.set(type, fn),
    TinyFrensTurtleAPI: async (base, path, body) => {
      requests.push({base, path, body});
      if (pending) await pending;
      if (path.endsWith('/profile')) return {displayName:'Tess <3'};
      if (failBalance) throw Error('relay offline');
      return {balance:123456, creditsPerFrens:100};
    },
  },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../web/account-header.js'), 'utf8'), context);
const settle = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  await settle();
  assert.equal(name.textContent, 'Tess <3');
  assert.equal(balance.textContent, '1,234.56 FRENS');
  assert.equal(requests[1].path, '/api/credits/balance');
  assert.equal(requests[1].body.token, 'first');
  listeners.get('account:click')({preventDefault() {}});
  assert.equal(context.screen, 'account');
  listeners.get('tinyfrens-profile-updated')({detail:{displayName:'Renamed'}});
  assert.equal(name.textContent, 'Renamed');
  failBalance = true;
  await listeners.get('tinyfrens-balance-updated')();
  assert.equal(balance.textContent, 'FRENS unavailable');
  failBalance = false;
  let release;
  pending = new Promise(resolve => { release = resolve; });
  const old = listeners.get('focus')();
  device = null;
  await listeners.get('tinyfrens-account-synced')();
  release(); await old;
  assert.equal(name.textContent, 'Your account', 'stale responses cannot restore another account');
  assert.equal(balance.textContent, '— FRENS');
  pending = null; device = {token:'second'};
  await listeners.get('tinyfrens-identity-ready')();
  assert.equal(balance.textContent, '1,234.56 FRENS');
  console.log('Account header: profile, balance conversion, rename, navigation, offline and account-switch checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
