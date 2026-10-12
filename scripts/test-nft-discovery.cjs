const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../web/nft-discovery.js'), 'utf8');
const collection = '0xca28587b61eac19a87dfcfd9420870867a916675';
const wallet = '0x1111111111111111111111111111111111111111';

function scanner(items) {
  const requests = [];
  const context = {window:{}, AbortController, URLSearchParams, setTimeout, clearTimeout,
    fetch:async url => { requests.push(url); return {ok:true,json:async()=>({items})}; }};
  vm.runInNewContext(source, context);
  return {api:context.window.TinyFrensNFTDiscovery, requests};
}

test('discovery excludes unrelated NFTs even when their name matches a supported collection', async () => {
  const {api,requests} = scanner([
    {id:'7',token:{address_hash:collection.toUpperCase().replace('0X','0x'),name:'Hood Turtles'}},
    {id:'8',token:{address_hash:'0x'+'a'.repeat(40),name:'Hood Turtles'}},
    {id:'9',token:{address_hash:'0x'+'b'.repeat(40),name:'Unrelated collection'}},
  ]);
  const result = await api.discover([wallet]);
  assert.equal(result.nfts.length, 1);
  assert.equal(result.nfts[0].tokenId, '7');
  assert.equal(requests.length, 1);
  assert.match(requests[0], /^https:\/\/robinhoodchain\.blockscout\.com\//);
  assert.equal(api.isSupported({chainId:1,contract:collection}), false);
  assert.equal(api.isSupported({chainId:4663,contract:'0x'+'a'.repeat(40)}), false);
});

test('a wallet containing only unsupported collections produces an empty companion list', async () => {
  const {api} = scanner([{id:'1',token:{address_hash:'0x'+'a'.repeat(40)}}]);
  const result = await api.discover([wallet]);
  assert.equal(result.nfts.length, 0);
  assert.equal(result.partial, false);
});
