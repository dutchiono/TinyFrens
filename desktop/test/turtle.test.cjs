'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {TurtleStore, SERVER} = require('../turtle.cjs');

test('same token number in Robots and Hood Turtles keeps separate imports, motion and removal', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyfrens-collections-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const hood = {tokenId:1,chainId:4663,originalAddress:'0xca28587b61eac19a87dfcfd9420870867a916675'};
  const robot = {tokenId:1,chainId:8453,originalAddress:'0xd745d8005a1ad8f783b97bf55e0d0e6a920ea8ff'};
  const store = new TurtleStore(path.join(dir,'pets.json'), async (url, options) => {
    assert.equal(url, SERVER + '/api/featured/companion');
    const body = JSON.parse(options.body);
    return {ok:true,text:async()=>JSON.stringify({...body,active:true,image:'data:image/png;base64,AAAA',validUntil:Date.now()/1000+3600})};
  });
  await store.import(SERVER,{token:'private',...hood});
  await store.import(SERVER,{token:'private',...robot});
  store.setMotion(1,'bubble',40,robot);
  assert.equal(store.view().items.length,2);
  assert.deepEqual(store.view().items.map(n=>n.motion.mode),['roam','bubble']);
  store.remove(1,robot);
  assert.equal(store.view().items.length,1);
  assert.equal(store.view().items[0].chainId,4663);
});

test('each companion keeps its own movement through reopening and ownership renewal', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyfrens-motion-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  let now = 1_800_000_000_000;
  const file = path.join(dir, 'turtle.json');
  const fetcher = async (_, options) => {
    const {tokenId} = JSON.parse(options.body);
    return {ok:true, text:async () => JSON.stringify({active:true, tokenId,
      image:'data:image/png;base64,aW1hZ2U=', validUntil:now/1000 + 3600})};
  };
  const store = new TurtleStore(file, fetcher, () => now);
  await store.import(SERVER, {token:'secret', tokenId:1});
  await store.import(SERVER, {token:'secret', tokenId:2});
  store.setMotion(1, 'bubble', 40, {size:56});
  store.setMotion(2, 'roam', 120, {size:112});
  assert.throws(() => store.setMotion(1, 'invalid', 60), /Invalid/);
  assert.throws(() => store.setMotion(1, 'roam', 141), /Invalid/);
  assert.throws(() => store.setMotion(3, 'roam', 60), /not found/);
  const reopened = new TurtleStore(file, fetcher, () => now);
  assert.throws(() => store.setMotion(1, 'roam', 60, {size:500}), /Invalid companion size/);
  const expected = [{mode:'bubble', speed:40, size:56}, {mode:'roam', speed:120, size:112}];
  assert.deepEqual(reopened.view().items.map(nft => nft.motion), expected);
  now += 3600_000;
  assert.equal(await reopened.renew(), true);
  assert.deepEqual(reopened.view().items.map(nft => nft.tokenId), [1, 2]);
  assert.deepEqual(reopened.view().items.map(nft => nft.motion), expected);
});

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
  assert.deepEqual(reopened.view(), {selected:true, active:false, pendingExpired:true});
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

test('companions persist together, remove individually and expire independently', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyfrens-multiple-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  let now = 1_800_000_000_000;
  const file = path.join(dir, 'turtle.json');
  const store = new TurtleStore(file, async (_, options) => {
    const {tokenId} = JSON.parse(options.body);
    return {ok:true, text:async () => JSON.stringify({active:true, tokenId,
      name:`Turtle ${tokenId}`, image:'data:image/png;base64,aW1hZ2U=', validUntil:now/1000 + tokenId*100})};
  }, () => now);
  await store.import(SERVER, {token:'secret', tokenId:1});
  await store.import(SERVER, {token:'secret', tokenId:2});
  assert.deepEqual(store.view().items.map(nft => nft.tokenId), [1,2]);
  assert.equal(JSON.stringify(store.view()).includes('secret'), false);
  now += 101000;
  assert.deepEqual(store.view().items.map(nft => nft.tokenId), [2]);
  store.remove(1);
  const reopened = new TurtleStore(file, undefined, () => now);
  assert.deepEqual(reopened.view().items.map(nft => nft.tokenId), [2]);
  reopened.remove(2);
  assert.equal(reopened.view().selected, false);
});

test('removing one wallet preserves companions belonging to other wallets', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyfrens-wallets-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const first = '0x' + 'a'.repeat(40), second = '0x' + 'b'.repeat(40);
  const store = new TurtleStore(path.join(dir, 'turtle.json'), async (_, options) => {
    const {tokenId} = JSON.parse(options.body);
    return {ok:true, text:async () => JSON.stringify({active:true, tokenId, wallet:tokenId === 1 ? first : second,
      name:'Turtle', image:'data:image/png;base64,aW1hZ2U=', validUntil:Date.now()/1000+3600})};
  });
  await store.import(SERVER, {token:'secret', tokenId:1});
  await store.import(SERVER, {token:'secret', tokenId:2});
  store.removeWallet(first.toUpperCase());
  assert.deepEqual(store.view().items.map(nft => nft.tokenId), [2]);
  assert.equal(store.view().items[0].wallet, second);
});
