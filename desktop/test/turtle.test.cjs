'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {TurtleStore, SERVER} = require('../turtle.cjs');

test('verified turtle persists without exposing the device credential and expires before renewal', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyfrens-turtle-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  let now = 1_800_000_000_000, owned = true, requests = 0;
  const fetcher = async (url, options) => {
    requests++;
    assert.equal(url, SERVER + '/api/featured/hood-turtle');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), {token:'device-secret', tokenId:7});
    return {ok:true, text:async () => JSON.stringify({active:owned, tokenId:7, name:'Hood Turtle #7',
      image:'data:image/png;base64,aW1hZ2U=', validUntil:now / 1000 + 86400})};
  };
  const file = path.join(dir, 'turtle.json');
  const first = new TurtleStore(file, fetcher, () => now);
  await first.import(SERVER, {token:'device-secret', tokenId:7});
  const reopened = new TurtleStore(file, fetcher, () => now);
  assert.equal(reopened.view().active, true);
  assert.equal(JSON.stringify(reopened.view()).includes('device-secret'), false);
  assert.equal(await reopened.renew(), false); assert.equal(requests, 1);
  now += 86400_000;
  assert.deepEqual(reopened.view(), {selected:true, active:false});
  assert.equal(await reopened.renew(), true); assert.equal(reopened.view().active, true);
  now += 86400_000; owned = false;
  assert.equal(await reopened.renew(), false); assert.equal(reopened.view().active, false);
  reopened.clear(); assert.equal(new TurtleStore(file).view().selected, false);
});

test('native relay rejects arbitrary servers and paths; clearing cancels an in-flight import', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyfrens-turtle-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  let finish, calls = 0;
  const store = new TurtleStore(path.join(dir, 'turtle.json'), async () => {
    calls++;
    await new Promise(resolve => { finish = resolve; });
    return {ok:true, text:async () => JSON.stringify({active:true, tokenId:7, name:'Turtle',
      image:'data:image/png;base64,aW1hZ2U=', validUntil:Date.now()/1000 + 3600})};
  });
  await assert.rejects(store.request('https://example.com', '/api/register', {}), /Unsupported/);
  await assert.rejects(store.request(SERVER, '/api/admin', {}), /Unsupported/);
  assert.equal(calls, 0);
  const importing = store.import(SERVER, {token:'private', tokenId:7});
  store.clear(); finish();
  await assert.rejects(importing, /selection changed/);
  assert.equal(store.view().selected, false);
});
