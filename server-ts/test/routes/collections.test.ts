import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { createAppContext } from '../../src/context.js';
import { createDatabaseConnection } from '../../src/db/connection.js';
import { initSchema } from '../../src/db/schema.js';
import { loadConfig } from '../../src/config.js';

const ORIGIN = 'https://tinyfrens.lol';

describe('Collection Suggestions & Voting Tests (server/test_collection_suggestions.py)', () => {
  let db: ReturnType<typeof createDatabaseConnection>;
  let context: ReturnType<typeof createAppContext>;
  let token: string;
  let pid: string;

  beforeEach(async () => {
    db = createDatabaseConnection(':memory:');
    initSchema(db);

    const config = loadConfig({
      ECONOMY_MODE: 'testnet',
      FRENS_TOKEN: '0x' + '11'.repeat(20),
      CHAIN_ID: '84532',
      ALLOWED_ORIGINS: ORIGIN,
      FRENS_TREASURY: '0x' + '99'.repeat(20),
      FRENS_TREASURY_INDEXER: 'true',
    });

    context = createAppContext(config, db);
    context.rateLimiter.clear();

    const app = await buildApp({ context });
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/register',
      headers: { origin: ORIGIN },
      payload: { pet: { name: 'Test', shape: 'turtle', color: '#a474f1' } },
    });
    const regData = JSON.parse(regRes.body);
    token = regData.token;
    pid = regData.id;
  });

  it('test_empty_then_persistent_deduplicated_suggestion', async () => {
    const app = await buildApp({ context });

    const emptyRes = await app.inject({
      method: 'GET',
      url: '/api/collections/suggestions',
      headers: { origin: ORIGIN },
    });
    assert.deepEqual(JSON.parse(emptyRes.body).collections, []);

    const address = '0x' + 'aB'.repeat(20);
    const postRes1 = await app.inject({
      method: 'POST',
      url: '/api/collections/suggestions',
      headers: { origin: ORIGIN },
      payload: { token, chainId: 8453, address, name: 'A collection' },
    });
    assert.equal(postRes1.statusCode, 201);
    const first = JSON.parse(postRes1.body);
    assert.equal(first.existing, false);

    const postRes2 = await app.inject({
      method: 'POST',
      url: '/api/collections/suggestions',
      headers: { origin: ORIGIN },
      payload: { token, chainId: 8453, address: address.toLowerCase(), name: 'Different name' },
    });
    assert.equal(postRes2.statusCode, 200);
    assert.equal(JSON.parse(postRes2.body).existing, true);

    const postRes3 = await app.inject({
      method: 'POST',
      url: '/api/collections/suggestions',
      headers: { origin: ORIGIN },
      payload: { token, chainId: 1, address, name: 'Same address, different network' },
    });
    assert.equal(postRes3.statusCode, 201);

    // List after restart with same db
    const newContext = createAppContext(context.config, db);
    const newApp = await buildApp({ context: newContext });

    const listRes = await newApp.inject({
      method: 'GET',
      url: '/api/collections/suggestions',
      headers: { origin: ORIGIN },
    });
    const items = JSON.parse(listRes.body).collections;
    assert.equal(items.length, 2);
    assert.ok(items.some((i: any) => i.id === first.collection.id));
    assert.ok(!JSON.stringify(items).includes('token'));
  });

  it('test_invalid_address_network_and_credential_rejected', async () => {
    const app = await buildApp({ context });

    const badCases = [
      { chainId: 1, address: '0x123' },
      { chainId: 1, address: '0x' + '0'.repeat(40) },
      { chainId: true, address: '0x' + 'a'.repeat(40) },
      { chainId: 1, address: '0x' + 'a'.repeat(40), token: 'invalid' },
    ];

    for (const values of badCases) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/collections/suggestions',
        headers: { origin: ORIGIN },
        payload: { token, ...values },
      });
      assert.equal(res.statusCode, 400);
    }

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/collections/suggestions',
      headers: { origin: ORIGIN },
    });
    assert.deepEqual(JSON.parse(listRes.body).collections, []);
  });

  it('test_vote_flow_deducts_deposited_frens_and_updates_rankings', async () => {
    const app = await buildApp({ context });

    // 1. Suggest two collections
    const col1Res = await app.inject({
      method: 'POST',
      url: '/api/collections/suggestions',
      headers: { origin: ORIGIN },
      payload: { token, chainId: 8453, address: '0x' + '11'.repeat(20), name: 'First Collection' },
    });
    const col2Res = await app.inject({
      method: 'POST',
      url: '/api/collections/suggestions',
      headers: { origin: ORIGIN },
      payload: { token, chainId: 8453, address: '0x' + '22'.repeat(20), name: 'Second Collection' },
    });
    const cid1 = JSON.parse(col1Res.body).collection.id;
    const cid2 = JSON.parse(col2Res.body).collection.id;

    // 2. Grant credits to pet account directly in db to simulate confirmed deposit
    context.economy.grant(pid, 5000, 'deposit');

    // Check vote status endpoint
    const statusRes = await app.inject({
      method: 'POST',
      url: '/api/vote/status',
      headers: { origin: ORIGIN },
      payload: { token },
    });
    assert.equal(statusRes.statusCode, 200);
    assert.equal(JSON.parse(statusRes.body).balance, 5000);

    // 3. Vote on collection 2 with 20 FRENS (2000 credits)
    const voteRes = await app.inject({
      method: 'POST',
      url: '/api/collections/vote',
      headers: { origin: ORIGIN },
      payload: { token, collectionId: cid2, amount: '20' },
    });
    assert.equal(voteRes.statusCode, 200);
    const voteData = JSON.parse(voteRes.body);
    assert.equal(voteData.success, true);
    assert.equal(voteData.creditsBurned, 2000);
    assert.equal(voteData.balance, 3000);

    // 4. Check listing: Collection 2 should now be at the TOP with 2000 credits
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/collections/suggestions',
      headers: { origin: ORIGIN },
    });
    const listing = JSON.parse(listRes.body).collections;
    assert.equal(listing[0].id, cid2);
    assert.equal(listing[0].credits, 2000);
    assert.equal(listing[0].votes, 1);
    assert.equal(listing[0].frens, 20);

    // Verify no pet_id or private account details are leaked in the listing
    const listingStr = JSON.stringify(listing);
    assert.ok(!listingStr.includes(pid));
    assert.ok(!listingStr.includes(token));
  });

  it('test_voting_prevents_overvoting_and_invalid_inputs', async () => {
    const app = await buildApp({ context });

    const colRes = await app.inject({
      method: 'POST',
      url: '/api/collections/suggestions',
      headers: { origin: ORIGIN },
      payload: { token, chainId: 8453, address: '0x' + '33'.repeat(20), name: 'Target Collection' },
    });
    const cid = JSON.parse(colRes.body).collection.id;

    // User has 0 balance: attempting to vote fails
    const failRes = await app.inject({
      method: 'POST',
      url: '/api/collections/vote',
      headers: { origin: ORIGIN },
      payload: { token, collectionId: cid, amount: '10' },
    });
    assert.equal(failRes.statusCode, 400);
    assert.ok(JSON.parse(failRes.body).error.includes('Insufficient'));

    // Grant 100 credits (1 FRENS)
    context.economy.grant(pid, 100, 'deposit');

    // Attempt to overvote (e.g. 5 FRENS when only 1 FRENS available)
    const overRes = await app.inject({
      method: 'POST',
      url: '/api/collections/vote',
      headers: { origin: ORIGIN },
      payload: { token, collectionId: cid, amount: '5' },
    });
    assert.equal(overRes.statusCode, 400);
    assert.ok(JSON.parse(overRes.body).error.includes('Insufficient'));

    // Attempt negative amount, zero, strings, NaN, invalid collection
    for (const bad of ['-1', '0', '-0.5', 'abc', '', '0.0000000000000000001']) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/collections/vote',
        headers: { origin: ORIGIN },
        payload: { token, collectionId: cid, amount: bad },
      });
      assert.equal(r.statusCode, 400);
    }

    // Invalid collection ID
    const rColl = await app.inject({
      method: 'POST',
      url: '/api/collections/vote',
      headers: { origin: ORIGIN },
      payload: { token, collectionId: 99999, amount: '1' },
    });
    assert.equal(rColl.statusCode, 400);

    // Bad token / unauthenticated
    const rTok = await app.inject({
      method: 'POST',
      url: '/api/collections/vote',
      headers: { origin: ORIGIN },
      payload: { token: 'bad-token', collectionId: cid, amount: '1' },
    });
    assert.equal(rTok.statusCode, 400);
  });
});
