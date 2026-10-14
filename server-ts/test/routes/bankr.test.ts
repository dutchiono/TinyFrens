import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { AppContext, createAppContext } from '../../src/context.js';
import { loadConfig } from '../../src/config.js';
import { createDbConnection } from '../../src/db/connection.js';
import { initSchema } from '../../src/db/schema.js';
import { mintPet } from '../../src/domain/account.js';

const ORIGIN = 'https://tinyfrens.lol';

describe('Bankr Routes (Phase 6 Slice 6E)', () => {
  let app: FastifyInstance;
  let context: AppContext;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    const config = loadConfig({
      ALLOW_TESTNET_FREE_MINT: 'true',
    });
    const db = createDbConnection(':memory:');
    initSchema(db);
    context = createAppContext(config, db);
    app = await buildApp({ context });
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
  });

  describe('GET /api/bankr/status', () => {
    test('reports false when keys are unconfigured', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/bankr/status',
        headers: { Origin: ORIGIN },
      });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), {
        connected: false,
        partner: false,
      });
    });

    test('reports true when keys are configured', async () => {
      const configWithKeys = loadConfig({
        BANKR_API_KEY: 'bk_test_123',
        BANKR_PARTNER_KEY: 'bp_test_456',
      });
      const db = createDbConnection(':memory:');
      initSchema(db);
      const testContext = createAppContext(configWithKeys, db);
      const testApp = await buildApp({ context: testContext });

      const res = await testApp.inject({
        method: 'GET',
        url: '/api/bankr/status',
        headers: { Origin: ORIGIN },
      });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), {
        connected: true,
        partner: true,
      });

      await testApp.close();
    });
  });

  describe('POST /api/bankr/wallet', () => {
    test('rejects unrecognized device token with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/bankr/wallet',
        headers: { Origin: ORIGIN },
        payload: { token: 'invalid-token' },
      });
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().error, 'Device credential not recognized');
    });

    test('provisions a personal fren-vault on Base for a registered pet', async () => {
      const pet = mintPet(context.db, { name: 'Walletless', shape: 'robot', color: '#a474f1' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/bankr/wallet',
        headers: { Origin: ORIGIN },
        payload: {
          token: pet.token,
          pet: { name: 'Walletless', shape: 'robot', color: '#a474f1' },
        },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.mode, 'fren-vault');
      assert.equal(body.walletId, `vault:${pet.id}`);
      assert.ok(body.evmAddress.startsWith('0x'));
      assert.equal(body.partner, false);
      assert.equal(body.message, 'Your personal Fren Pocket Vault on Base.');

      // Verify row persisted in pet_wallets table
      const stored = context.repos.wallets.getPetWallet(pet.id);
      assert.ok(stored);
      assert.equal(stored.provider, 'fren-vault');
      assert.equal(stored.evm_address, body.evmAddress);

      // Subsequent call returns the existing vault idempotently
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/bankr/wallet',
        headers: { Origin: ORIGIN },
        payload: { token: pet.token },
      });
      assert.equal(res2.statusCode, 200);
      assert.equal(res2.json().evmAddress, body.evmAddress);
    });

    test('provisions partner wallet when BANKR_PARTNER_KEY is configured', async () => {
      const configPartner = loadConfig({
        BANKR_PARTNER_KEY: 'partner_secret_123',
        BANKR_API_URL: 'https://bankr.test',
      });
      const db = createDbConnection(':memory:');
      initSchema(db);
      const testContext = createAppContext(configPartner, db);
      const testApp = await buildApp({ context: testContext });

      const pet = mintPet(testContext.db, { name: 'PartnerPet', shape: 'robot', color: '#66c7d2' });

      // Mock fetch for partner provisioning
      globalThis.fetch = async (url: any, init: any) => {
        if (String(url).includes('/partner/wallets')) {
          assert.equal(init.headers['X-Partner-Key'], 'partner_secret_123');
          return new Response(
            JSON.stringify({
              id: 'bw_999',
              evmAddress: '0x9999999999999999999999999999999999999999',
              solAddress: 'sol_123',
              apiKey: 'bk_partner_key_123',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not Found', { status: 404 });
      };

      const res = await testApp.inject({
        method: 'POST',
        url: '/api/bankr/wallet',
        headers: { Origin: ORIGIN },
        payload: { token: pet.token },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.mode, 'bankr-partner');
      assert.equal(body.walletId, 'bw_999');
      assert.equal(body.evmAddress, '0x9999999999999999999999999999999999999999');
      assert.equal(body.partner, true);
      assert.equal(body.message, 'Your dedicated Bankr partner wallet.');

      await testApp.close();
    });

    test('falls back to fren-vault when partner provisioning fails', async () => {
      const configPartner = loadConfig({
        BANKR_PARTNER_KEY: 'partner_secret_123',
        BANKR_API_URL: 'https://bankr.test',
      });
      const db = createDbConnection(':memory:');
      initSchema(db);
      const testContext = createAppContext(configPartner, db);
      const testApp = await buildApp({ context: testContext });

      const pet = mintPet(testContext.db, { name: 'PartnerPet', shape: 'robot', color: '#66c7d2' });

      // Mock fetch throwing network error
      globalThis.fetch = async () => {
        throw new Error('Connection refused');
      };

      const res = await testApp.inject({
        method: 'POST',
        url: '/api/bankr/wallet',
        headers: { Origin: ORIGIN },
        payload: { token: pet.token },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.json().mode, 'fren-vault');
      assert.equal(res.json().partner, false);

      await testApp.close();
    });
  });

  describe('POST /api/bankr/nfts', () => {
    test('returns empty NFTs list and evm address when vault has no NFTs', async () => {
      const pet = mintPet(context.db, { name: 'NoNfts', shape: 'robot', color: '#a474f1' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/bankr/nfts',
        headers: { Origin: ORIGIN },
        payload: { token: pet.token },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.deepEqual(body.nfts, []);
      assert.ok(body.evmAddress.startsWith('0x'));
    });

    test('lists minted NFTs from fren_nfts table', async () => {
      const pet = mintPet(context.db, { name: 'Collector', shape: 'robot', color: '#a474f1' });

      context.repos.wallets.insertFrenNft(
        pet.id,
        42,
        'TinyFren #42 · Cool Bot',
        JSON.stringify({ shape: 'robot', color: '#76638e', vaultBacked: true }),
        1000,
        '47619047000000000000000000'
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/bankr/nfts',
        headers: { Origin: ORIGIN },
        payload: { token: pet.token },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.nfts.length, 1);
      assert.equal(body.nfts[0].tokenId, 42);
      assert.equal(body.nfts[0].name, 'TinyFren #42 · Cool Bot');
      assert.equal(body.nfts[0].vaultBacked, true);
      assert.equal(body.nfts[0].lockedFrens, '47619047000000000000000000');
    });
  });

  describe('POST /api/bankr/transform', () => {
    test('rejects missing or non-object nft with 400', async () => {
      const pet = mintPet(context.db, { name: 'Transformer', shape: 'robot', color: '#a474f1' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/bankr/transform',
        headers: { Origin: ORIGIN },
        payload: { token: pet.token, nft: 'not-an-object' },
      });

      assert.equal(res.statusCode, 400);
      assert.equal(res.json().error, 'Choose an NFT first');
    });

    test('transforms pet profile deterministically and persists transformed NFT', async () => {
      const pet = mintPet(context.db, { name: 'Initial', shape: 'cat', color: '#a474f1' });

      const nft = {
        name: 'TinyFren #42',
        tokenId: '42',
        chain: 'base',
        collection: {
          name: 'TinyFrens',
          address: '0x1234567890abcdef1234567890abcdef12345678',
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/bankr/transform',
        headers: { Origin: ORIGIN },
        payload: { token: pet.token, nft },
      });

      assert.equal(res.statusCode, 200);
      const data = res.json();
      assert.equal(data.pet.name, 'TinyFren #42');
      assert.equal(data.pet.shape, 'robot');
      assert.equal(data.pet.color, '#a474f1');
      assert.equal(data.pet.tokenId, 42);

      // Verify updated profile in database
      const row = context.repos.pets.findById(pet.id);
      assert.ok(row);
      const storedProfile = JSON.parse(row.profile);
      assert.equal(storedProfile.name, 'TinyFren #42');
      assert.equal(storedProfile.shape, 'robot');
    });
  });

  describe('POST /api/bankr/monitor', () => {
    test('returns 503 when BANKR_API_KEY is not configured', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/bankr/monitor',
        headers: { Origin: ORIGIN },
        payload: {
          wallet: '0x1234567890abcdef1234567890abcdef12345678',
          question: 'how is it',
          pet: { name: 'Beep', shape: 'robot', color: '#a474f1' },
        },
      });

      assert.equal(res.statusCode, 503);
      assert.equal(res.json().error, 'Bankr is not connected yet');
    });

    test('rejects invalid wallet address with 400', async () => {
      const configMonitor = loadConfig({ BANKR_API_KEY: 'bk_key_123' });
      const db = createDbConnection(':memory:');
      initSchema(db);
      const testContext = createAppContext(configMonitor, db);
      const testApp = await buildApp({ context: testContext });

      const res = await testApp.inject({
        method: 'POST',
        url: '/api/bankr/monitor',
        headers: { Origin: ORIGIN },
        payload: {
          wallet: 'abc', // too short (< 4 chars)
          question: 'how is it',
          pet: { name: 'Beep', shape: 'robot', color: '#a474f1' },
        },
      });

      assert.equal(res.statusCode, 400);
      assert.equal(res.json().error, 'Enter a wallet address first');

      await testApp.close();
    });

    test('executes agent prompt and poll loop successfully', async () => {
      const configMonitor = loadConfig({
        BANKR_API_KEY: 'bk_key_123',
        BANKR_API_URL: 'https://bankr.test',
      });
      const db = createDbConnection(':memory:');
      initSchema(db);
      const testContext = createAppContext(configMonitor, db);
      const testApp = await buildApp({ context: testContext });

      let promptCalled = false;
      let jobPollCount = 0;

      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/agent/prompt')) {
          promptCalled = true;
          return new Response(
            JSON.stringify({
              jobId: 'job_42',
              threadId: 'th_42',
              status: 'pending',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (urlStr.includes('/agent/job/job_42')) {
          jobPollCount++;
          return new Response(
            JSON.stringify({
              jobId: 'job_42',
              threadId: 'th_42',
              status: 'completed',
              response: '**Quiet day**: *no outgoing transactions* observed on-chain.',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not Found', { status: 404 });
      };

      const res = await testApp.inject({
        method: 'POST',
        url: '/api/bankr/monitor',
        headers: { Origin: ORIGIN },
        payload: {
          wallet: '0x1234567890abcdef1234567890abcdef12345678',
          question: 'how is it',
          pet: { name: 'Beep', shape: 'robot', color: '#a474f1' },
        },
      });

      assert.equal(res.statusCode, 200);
      const data = res.json();
      assert.ok(promptCalled);
      assert.ok(jobPollCount >= 1);
      assert.equal(data.jobId, 'job_42');
      assert.equal(data.threadId, 'th_42');
      // Verify markdown formatting was stripped
      assert.equal(data.reply, 'Quiet day: no outgoing transactions observed on-chain.');

      await testApp.close();
    });
  });
});
