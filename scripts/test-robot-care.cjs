const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const root = require('node:path').join(__dirname, '../web');

const ROBOT = {chainId: 8453, originalAddress: '0xd745d8005a1ad8f783b97bf55e0d0e6a920ea8ff', tokenId: 12, name: 'Robot #12', companion: {adapter: 'tinyfrens-robots-v1'}};
const OTHER = {chainId: 4663, originalAddress: '0xca28587b61eac19a87dfcfd9420870867a916675', tokenId: 5, name: 'Hood #5', companion: {adapter: 'hood-turtles-v1'}};

const store = new Map();
const calls = [];
const context = {
  window: {
    addEventListener: () => {}, dispatchEvent: () => {}, TINYFRENS_SERVER: 'https://relay.test',
    TinyFrensFriends: {identity: () => ({token: 'device'})},
    TinyFrensTurtleAPI: async (base, path, body) => { calls.push({base, path, body}); return {ok: true, path}; },
  },
  localStorage: {getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)},
  document: {readyState: 'complete', getElementById: () => null, createElement: () => ({style: {}, setAttribute() {}, append() {}, insertBefore() {}}), addEventListener: () => {}},
  CustomEvent: function (type, init) { this.type = type; this.detail = init?.detail; },
  Event: function (type) { this.type = type; },
  console, Date, Error, JSON, Math, String, Number, Array, Object, Boolean, RegExp, parseInt, parseFloat,
};
context.window.window = context.window;
vm.createContext(context);
for (const name of ['companion-identity.js', 'robot-care.js']) vm.runInContext(fs.readFileSync(root + '/' + name, 'utf8'), context);
const api = context.window.TinyFrensRobotCare;

(async () => {
  // ---- identity / resolution ----
  assert.equal(api.isRobot(ROBOT), true);
  assert.equal(api.isRobot(OTHER), false);
  assert.equal(api.isRobot({...ROBOT, chainId: 1}), false);
  assert.equal(api.isRobot({...ROBOT, originalAddress: '0x1111111111111111111111111111111111111111'}), false);
  assert.equal(api.isRobot({...ROBOT, companion: {adapter: 'drawn-pet'}}), false);
  assert.equal(api.isRobot({...ROBOT, companion: null}), true);

  store.set('tinyfrens-companions', JSON.stringify([ROBOT, OTHER]));
  assert.equal(api.robots().length, 1);
  assert.equal(api.active().tokenId, 12);

  const ROBOT_B = {...ROBOT, tokenId: 99, name: 'Robot #99'};
  store.set('tinyfrens-companions', JSON.stringify([ROBOT, ROBOT_B]));
  assert.equal(api.active().tokenId, 12, 'defaults to the first robot');
  api.setActive(ROBOT_B);
  assert.equal(api.active().tokenId, 99, 'remembers the chosen robot');
  store.set('tinyfrens-companions', JSON.stringify([OTHER]));
  assert.equal(api.active(), null, 'no robots -> inert');
  store.set('tinyfrens-companions', JSON.stringify([ROBOT]));

  // ---- formatting ----
  assert.equal(api.fmtEnergy(1500), '1.5');
  assert.equal(api.fmtEnergy(1234), '1.23');
  assert.equal(api.fmtEnergy(1234567890), '1,234,567.89');
  assert.equal(api.fmtEnergy(0), '0');
  assert.equal(api.fmtEnergy(null), null);
  assert.equal(api.energyLabel(1000), '1 Energy');

  // ---- describe ----
  assert.match(api.describe({allowed: true, costMilli: 4000, energy: {totalMilli: 6000}}), /Used 4 Energy.*6 Energy remaining/);
  assert.match(api.describe({allowed: false, insufficientEnergy: true, costMilli: 5000, energy: {totalMilli: 2000}}), /needs 5 Energy.*2 Energy/);

  // ---- server calls ----
  const body = i => JSON.stringify(calls[i].body);
  calls.length = 0;
  const st = await api.status(ROBOT);
  assert.equal(calls[0].path, '/api/robots/care');
  assert.equal(body(0), JSON.stringify({token: 'device', tokenId: 12}));
  assert.equal(calls[0].base, 'https://relay.test');
  assert.equal(st.ok, true);

  const acted = await api.act('feed', ROBOT);
  assert.equal(calls[1].path, '/api/robots/care/action');
  assert.equal(body(1), JSON.stringify({token: 'device', tokenId: 12, action: 'feed'}));
  assert.equal(acted.offline, false);

  await api.game('snack-catch', ROBOT);
  assert.equal(calls[2].path, '/api/robots/game');
  assert.equal(body(2), JSON.stringify({token: 'device', tokenId: 12, game: 'snack-catch'}));

  // A rejected Energy spend must never reach local care mutation.
  store.set('tinyfrens-companions', JSON.stringify([ROBOT]));
  context.window.TinyFrensTurtleAPI = async (base,path) => path.endsWith('/action')
    ? {allowed:false,insufficientEnergy:true,costMilli:4000,energy:{totalMilli:2000}}
    : {energy:{totalMilli:2000}};
  assert.equal(await api.before('feed'), false, 'insufficient Energy blocks local action');
  context.window.TinyFrensTurtleAPI = async (base,path) => path.endsWith('/action')
    ? {allowed:true,costMilli:4000,energy:{totalMilli:6000}} : {energy:{totalMilli:6000}};
  assert.equal(await api.before('feed'), true, 'server-authorized Energy spend proceeds');
  assert.equal(await api.beforeGame(), true, 'mini-game start pays the Play Energy cost');

  // ---- offline / unauthenticated never blocks ----
  context.window.TinyFrensTurtleAPI = async () => { throw new Error('relay down'); };
  assert.equal((await api.act('feed', ROBOT)).offline, true);
  assert.equal(await api.before('feed'), false, 'robot actions pause offline');
  assert.equal(await api.game('snack-catch', ROBOT), null);
  context.window.TinyFrensFriends = {identity: () => null};
  store.delete('tinyfrens-device:https://relay.test');
  assert.equal((await api.act('feed', ROBOT)).offline, true);

  // Public helpers remain available to the shared care screen.
  assert.equal(typeof api.after, 'function');
  assert.equal(typeof api.refresh, 'function');

  console.log('Robot care tests passed: resolution, choice, Energy formatting, gating, endpoint wiring and offline safety.');
})().catch(error => { console.error(error); process.exitCode = 1; });
