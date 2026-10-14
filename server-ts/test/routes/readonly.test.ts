import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createAppContext } from '../../src/context.js';
import { Config, loadConfig } from '../../src/config.js';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';

describe('HTTP Read-Only Routes Parity (Phase 4)', () => {
  let app: FastifyInstance;
  const ALLOWED_ORIGIN = 'https://www.tinyfrens.lol';

  before(async () => {
    const config: Config = loadConfig({
      BANKR_API_KEY: 'test-bankr-key',
      BANKR_PARTNER_KEY: 'test-partner-key',
      VAPID_PUBLIC_KEY: 'test-vapid-key',
      ECONOMY_MODE: 'testnet',
      FRENS_TOKEN: '0x1A96226727a1D0a46334b3A4b3878B32B7659ba3',
      CHAIN_ID: '84532',
      ROBINHOOD_RPC_URL: 'http://127.0.0.1:9',
    });
    const db = createDbConnection(':memory:');
    runMigrations(db);

    const context = createAppContext(config, db);

    // Seed some test data for collections and robots
    const cid = context.repos.votes.createSuggestion(
      8453,
      '0x1234567890123456789012345678901234567890',
      'Test Collection',
      1000
    );
    context.repos.votes.recordVote(cid, 'pet-1', 250, '25000000', 1001);

    context.repos.robots.setGalleryArt(
      1,
      JSON.stringify({
        name: 'Robot #1',
        image: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      })
    );
    context.repos.robots.setGalleryOwner(1, '0xowner1');

    app = await buildApp({ context });
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  describe('GET /api/bankr/status', () => {
    test('returns connected and partner status with allowed origin', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/bankr/status',
        headers: { Origin: ALLOWED_ORIGIN },
      });
      assert.strictEqual(res.statusCode, 200);
      const body = res.json();
      assert.strictEqual(body.connected, true);
      assert.strictEqual(body.partner, true);
    });

    test('rejects disallowed origin with 403', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/bankr/status',
        headers: { Origin: 'https://evil.attacker.com' },
      });
      assert.strictEqual(res.statusCode, 403);
    });
  });

  describe('GET /api/economy/status', () => {
    test('returns economy configuration and status', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/economy/status',
        headers: { Origin: ALLOWED_ORIGIN },
      });
      assert.strictEqual(res.statusCode, 200);
      const body = res.json();
      assert.strictEqual(body.mode, 'testnet');
      assert.strictEqual(body.chainId, 84532);
      assert.strictEqual(body.symbol, 'tfFRENS');
      assert.strictEqual(body.decimals, 18);
    });
  });

  describe('GET /api/nft/price', () => {
    test('calculates accurate mint quote', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/nft/price',
        headers: { Origin: ALLOWED_ORIGIN },
      });
      assert.strictEqual(res.statusCode, 200);
      const body = res.json();
      assert.strictEqual(body.symbol, 'ETH');
      assert.strictEqual(body.frensSymbol, 'FRENS');
      assert.strictEqual(body.vaultEth, 0.002);
      assert.ok(typeof body.timestamp === 'number');
    });
  });

  describe('GET /api/nft/uri', () => {
    test('returns 503 when contract or RPC is unconfigured', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/nft/uri?tokenId=1',
      });
      assert.strictEqual(res.statusCode, 503);
      assert.strictEqual(res.json().error, 'NFT contract / RPC not configured');
    });

    test('returns 400 on out of range tokenId', async () => {
      // Test with custom app having configured NFT and RPC
      const config: Config = loadConfig({
        TINYFRENS_NFT_ADDRESS: '0x1234567890123456789012345678901234567890',
        BASE_RPC_URL: 'http://127.0.0.1:8545',
      });
      const db = createDbConnection(':memory:');
      const testApp = await buildApp({ context: createAppContext(config, db) });

      const res = await testApp.inject({
        method: 'GET',
        url: '/api/nft/uri?tokenId=0',
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json().error, 'tokenId out of range');

      await testApp.close();
    });
  });

  describe('GET /api/collections/suggestions', () => {
    test('returns suggestions leaderboard ranked by votes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/collections/suggestions',
        headers: { Origin: ALLOWED_ORIGIN },
      });
      assert.strictEqual(res.statusCode, 200);
      const body = res.json();
      assert.ok(Array.isArray(body.collections));
      assert.strictEqual(body.collections.length, 1);
      assert.strictEqual(body.collections[0].name, 'Test Collection');
      assert.strictEqual(body.collections[0].credits, 250);
      assert.strictEqual(body.collections[0].frens, 2.5);
    });
  });

  describe('GET /api/vote/status', () => {
    test('returns vote status and deposit parameters', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/vote/status',
        headers: { Origin: ALLOWED_ORIGIN },
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['cache-control'], 'no-store');
      const body = res.json();
      assert.strictEqual(body.creditsPerFrens, 100);
      assert.ok(body.deposit);
    });
  });

  describe('GET /api/gallery/collections & /api/gallery/imported', () => {
    test('returns supported gallery collections list', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/gallery/collections',
        headers: { Origin: ALLOWED_ORIGIN },
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['cache-control'], 'no-store');
      const body = res.json();
      assert.strictEqual(body.collections.length, 4);
      assert.strictEqual(body.collections[0].id, 'robots');
    });

    test('rejects unknown or release collections in imported endpoint', async () => {
      const res1 = await app.inject({
        method: 'GET',
        url: '/api/gallery/imported?collection=unknown',
        headers: { Origin: ALLOWED_ORIGIN },
      });
      assert.strictEqual(res1.statusCode, 400);

      const res2 = await app.inject({
        method: 'GET',
        url: '/api/gallery/imported?collection=robots',
        headers: { Origin: ALLOWED_ORIGIN },
      });
      assert.strictEqual(res2.statusCode, 400);
    });

    test('rejects invalid cursor in imported endpoint', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/gallery/imported?collection=nubs&after=-1',
        headers: { Origin: ALLOWED_ORIGIN },
      });
      assert.strictEqual(res.statusCode, 400);
    });
  });

  describe('GET /api/robots/gallery', () => {
    test('returns paginated robots gallery', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/robots/gallery',
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['cache-control'], 'public, max-age=30');
      const body = res.json();
      assert.strictEqual(body.contract, '0xd745d8005a1ad8f783b97bf55e0d0e6a920ea8ff');
      assert.strictEqual(body.supply, 1);
      assert.strictEqual(body.items.length, 1);
      assert.strictEqual(body.items[0].tokenId, 1);
      assert.strictEqual(body.items[0].owner, '0xowner1');
    });

    test('rejects invalid cursor with 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/robots/gallery?after=-1',
      });
      assert.strictEqual(res.statusCode, 400);
    });
  });

  describe('GET /api/hood-turtles/preview', () => {
    test('returns 400 for out of range tokenId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/hood-turtles/preview?tokenId=0',
      });
      assert.strictEqual(res.statusCode, 400);
    });

    test('returns 503 when uncached/unavailable', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/hood-turtles/preview?tokenId=7',
      });
      assert.strictEqual(res.statusCode, 503);
    });
  });

  describe('GET /api/push/public-key', () => {
    test('returns configured VAPID public key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/push/public-key',
        headers: { Origin: ALLOWED_ORIGIN },
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json().key, 'test-vapid-key');
    });
  });

  describe('Farcaster Manifest & Snap Frames', () => {
    test('GET /.well-known/farcaster.json returns valid manifest', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/.well-known/farcaster.json',
      });
      assert.strictEqual(res.statusCode, 200);
      const body = res.json();
      assert.ok(body.frame);
      assert.strictEqual(body.frame.name, 'TinyFrens');
    });

    test('GET /snap with html accept returns card with Link header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/snap?name=Fren&species=Cat',
        headers: { Accept: 'text/html' },
      });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.headers.link?.includes('rel="alternate"'));
      assert.ok(res.body.includes('Fren') && res.body.includes('Cat') && res.body.includes('Farcaster Snap'));
    });

    test('GET /snap with snap accept returns json snap frame', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/snap?name=Fren&species=Cat',
        headers: { Accept: 'application/vnd.farcaster.snap+json' },
      });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.headers['content-type']?.includes('application/vnd.farcaster.snap+json'));
      const body = res.json();
      assert.strictEqual(body.version, '2.0');
    });
  });
});
