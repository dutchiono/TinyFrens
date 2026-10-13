import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeString, decodeMetadata, rpc } from '../web/robot-live.mjs';
const response = result => async () => ({ok:true,json:async () => result});
test('decodes actual ABI and embedded UTF-8 metadata without fetching another host', () => {
  const metadata = {name:'Robot #1 ✦',image:'data:image/svg+xml;base64,PHN2Zy8+',attributes:[]};
  const uri = 'data:application/json;base64,' + Buffer.from(JSON.stringify(metadata)).toString('base64');
  const bytes = Buffer.from(uri);
  const hex = '0x' + '20'.padStart(64,'0') + bytes.length.toString(16).padStart(64,'0') + bytes.toString('hex');
  assert.deepEqual(decodeMetadata(decodeString(hex)), metadata);
  assert.throws(() => decodeMetadata('https://untrusted.example/metadata'), /Unexpected/);
});
test('only nonexistent token reverts are skipped; storage/provider failures stay visible', async () => {
  assert.equal(await rpc('eth_call', [], response({error:{code:3,data:'0xa14c4b50'}})), null);
  await assert.rejects(rpc('eth_call', [], response({error:{code:3,data:'0x12345678',message:'storage missing'}})), /storage missing/);
  await assert.rejects(rpc('eth_call', [], response({error:{code:-32005,message:'rate limited'}})), /rate limited/);
  await assert.rejects(rpc('eth_call', [], async () => ({ok:false,status:500})), /HTTP 500/);
});
