import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { AppContext, createAppContext } from '../../src/context.js';
import { loadConfig } from '../../src/config.js';
import { createDbConnection } from '../../src/db/connection.js';
import { initSchema } from '../../src/db/schema.js';
import { mintPet } from '../../src/domain/account.js';
import { NFT_MAX_SUPPLY } from '../../src/domain/nft-traits.js';
import { Economy } from '../../src/domain/economy.js';

const ORIGIN = 'https://tinyfrens.lol';
const DUMMY_NFT = '0x1111111111111111111111111111111111111111';

describe('Wallet, Minting & NFT Operations (Phase 6 Slice 6E)', () => {
  let app: FastifyInstance;
  let context: AppContext;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    const config = loadConfig({
      ALLOW_TESTNET_FREE_MINT: 'true',
      TINYFRENS_NFT_ADDRESS: DUMMY_NFT,
      BASE_RPC_URL: 'https://rpc.test',
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

  describe('POST /api/wallet/mint', () => {
    test('checkOnly returns afford status and quote without writing to DB', async () => {
      const pet = mintPet(context.db, { name: 'Checker', shape: 'robot', color: '#a474f1' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/wallet/mint',
        headers: { Origin: ORIGIN },
        payload: { token: pet.token, checkOnly: true },
      });

      assert.equal(res.statusCode, 200);
      const data = res.json();
      assert.equal(data.canAfford, true);
      assert.ok('ethRequired' in data);
      assert.ok(data.vaultAddress.startsWith('0x'));

      // Verify no NFT was inserted
      const nfts = context.repos.wallets.listFrenNfts(pet.id);
      assert.equal(nfts.length, 0);
    });

    test('rejects non-robot shapes with 400', async () => {
      const pet = mintPet(context.db, { name: 'Kitty', shape: 'cat', color: '#a474f1' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/wallet/mint',
        headers: { Origin: ORIGIN },
        payload: {
          token: pet.token,
          customTraits: { shape: 'cat' },
        },
      });

      assert.equal(res.statusCode, 400);
      assert.equal(res.json().error, 'BNKR NFT minting is robot-only.');
    });

    test('returns 402 when ALLOW_TESTNET_FREE_MINT is false and mode is eth', async () => {
      const paidConfig = loadConfig({
        ALLOW_TESTNET_FREE_MINT: 'false',
        TINYFRENS_NFT_ADDRESS: DUMMY_NFT,
      });
      const db = createDbConnection(':memory:');
      initSchema(db);
      const testContext = createAppContext(paidConfig, db);
      const testApp = await buildApp({ context: testContext });

      const pet = mintPet(testContext.db, { name: 'PaidBot', shape: 'robot', color: '#a474f1' });

      const res = await testApp.inject({
        method: 'POST',
        url: '/api/wallet/mint',
        headers: { Origin: ORIGIN },
        payload: { token: pet.token, mode: 'eth' },
      });

      assert.equal(res.statusCode, 402);
      assert.ok(res.json().error.includes('Minting requires'));
      assert.ok(res.json().ethRequired > 0);

      await testApp.close();
    });

    test('mints available token ID with custom traits and updates pet profile', async () => {
      const pet = mintPet(context.db, { name: 'MintyFren', shape: 'cat', color: '#a474f1' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/wallet/mint',
        headers: { Origin: ORIGIN },
        payload: {
          token: pet.token,
          customTraits: {
            shape: 'robot',
            color: '#82eba1',
            expression: 'star_eyes',
            accessory: 'crown',
          },
          name: 'Prince Bot',
        },
      });

      assert.equal(res.statusCode, 200);
      const mintData = res.json();
      assert.equal(mintData.success, true);
      const tokenId = mintData.nft.tokenId;
      assert.ok(tokenId >= 1 && tokenId <= NFT_MAX_SUPPLY);

      // Verify transformed pet profile
      assert.equal(mintData.pet.tokenId, tokenId);
      assert.equal(mintData.pet.shape, 'robot');
      assert.equal(mintData.pet.color, '#82eba1');
      assert.equal(mintData.pet.expression, 'star_eyes');
      assert.equal(mintData.pet.accessory, 'crown');
      assert.equal(mintData.pet.name, 'Prince Bot');

      // Verify persisted in fren_nfts
      const savedNfts = context.repos.wallets.listFrenNfts(pet.id);
      assert.equal(savedNfts.length, 1);
      assert.equal(savedNfts[0].token_id, tokenId);

      // Verify bankr/nfts endpoint returns it
      const nftsRes = await app.inject({
        method: 'POST',
        url: '/api/bankr/nfts',
        headers: { Origin: ORIGIN },
        payload: { token: pet.token },
      });
      assert.equal(nftsRes.statusCode, 200);
      assert.equal(nftsRes.json().nfts.length, 1);
      assert.equal(nftsRes.json().nfts[0].tokenId, tokenId);
    });

    test('mints in vault mode with locked FRENS Piggybank backing', async () => {
      const pet = mintPet(context.db, { name: 'VaultFren', shape: 'robot', color: '#ffd700' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/wallet/mint',
        headers: { Origin: ORIGIN },
        payload: {
          token: pet.token,
          mode: 'vault',
          name: 'Golden Vault',
          customTraits: {
            shape: 'robot',
            color: '#ffd700',
            expression: 'shades',
            accessory: 'party_hat',
          },
        },
      });

      assert.equal(res.statusCode, 200);
      const mdata = res.json();
      assert.equal(mdata.success, true);
      assert.equal(mdata.nft.vaultBacked, true);
      assert.ok(BigInt(mdata.nft.lockedFrens) > 0n);
      assert.equal(mdata.pet.tokenId, mdata.nft.tokenId);

      // Verify read by bankr/nfts
      const nftsRes = await app.inject({
        method: 'POST',
        url: '/api/bankr/nfts',
        headers: { Origin: ORIGIN },
        payload: { token: pet.token },
      });
      const ndata = nftsRes.json();
      assert.equal(ndata.nfts[0].vaultBacked, true);
      assert.equal(ndata.nfts[0].lockedFrens, mdata.nft.lockedFrens);
    });

    test('returns 409 when entire supply is exhausted', async () => {
      const pet = mintPet(context.db, { name: 'NoSupply', shape: 'robot', color: '#a474f1' });

      // Mock getAllMintedTokenIds to return 1..NFT_MAX_SUPPLY
      const allIds = new Set<number>();
      for (let i = 1; i <= NFT_MAX_SUPPLY; i++) allIds.add(i);
      context.repos.wallets.getAllMintedTokenIds = () => allIds;

      const res = await app.inject({
        method: 'POST',
        url: '/api/wallet/mint',
        headers: { Origin: ORIGIN },
        payload: { token: pet.token },
      });

      assert.equal(res.statusCode, 409);
      assert.equal(res.json().error, 'No unminted TinyFrens robots remain.');
    });
  });

  describe('POST /api/wallet/rename-nft and /api/wallet/evolve-nft', () => {
    test('rename validates bounds and rejects invalid names', async () => {
      const pet = mintPet(context.db, { name: 'RenameBot', shape: 'robot', color: '#a474f1' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/wallet/rename-nft',
        headers: { Origin: ORIGIN },
        payload: { token: pet.token, tokenId: 42, name: 'Invalid$$$Name' },
      });

      assert.equal(res.statusCode, 400);
      assert.ok(res.json().error.includes('Use 1-32 letters, numbers'));
    });

    test('rename executes contract call and updates active pet profile', async () => {
      const pet = mintPet(context.db, { name: 'OldName', shape: 'robot', color: '#a474f1', tokenId: 42 });

      // Mock RPC responses for sendVaultTx
      globalThis.fetch = async (url: any, init: any) => {
        const body = JSON.parse(init.body);
        if (body.method === 'eth_getTransactionCount') return new Response(JSON.stringify({ result: '0x0' }));
        if (body.method === 'eth_gasPrice') return new Response(JSON.stringify({ result: '0x3b9aca00' }));
        if (body.method === 'eth_estimateGas') return new Response(JSON.stringify({ result: '0x5208' }));
        if (body.method === 'eth_sendRawTransaction') return new Response(JSON.stringify({ result: '0xtxhash123' }));
        return new Response('Not Found', { status: 404 });
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/wallet/rename-nft',
        headers: { Origin: ORIGIN },
        payload: { token: pet.token, tokenId: 42, name: 'RenamedRobo' },
      });

      assert.equal(res.statusCode, 200);
      const data = res.json();
      assert.equal(data.ok, true);
      assert.equal(data.tokenId, 42);
      assert.equal(data.name, 'RenamedRobo');
      assert.equal(data.tx.hash, '0xtxhash123');
      assert.equal(data.pet.name, 'RenamedRobo');

      // Verify DB pet profile updated
      const stored = context.repos.pets.findById(pet.id);
      assert.equal(JSON.parse(stored!.profile).name, 'RenamedRobo');
    });

    test('evolve dispatches contract call successfully', async () => {
      const pet = mintPet(context.db, { name: 'EvolveBot', shape: 'robot', color: '#a474f1' });

      globalThis.fetch = async (url: any, init: any) => {
        const body = JSON.parse(init.body);
        if (body.method === 'eth_getTransactionCount') return new Response(JSON.stringify({ result: '0x1' }));
        if (body.method === 'eth_gasPrice') return new Response(JSON.stringify({ result: '0x3b9aca00' }));
        if (body.method === 'eth_estimateGas') return new Response(JSON.stringify({ result: '0x5208' }));
        if (body.method === 'eth_sendRawTransaction') return new Response(JSON.stringify({ result: '0xevolvetx456' }));
        return new Response('Not Found', { status: 404 });
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/wallet/evolve-nft',
        headers: { Origin: ORIGIN },
        payload: { token: pet.token, tokenId: 42 },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.json().ok, true);
      assert.equal(res.json().tx.hash, '0xevolvetx456');
    });
  });

  describe('POST /api/wallet/unwrap-nft', () => {
    test('unwraps vault-backed NFT, redeems FRENS, and clears pet profile tokenId', async () => {
      const pet = mintPet(context.db, { name: 'Vaulty', shape: 'robot', color: '#ffd700', tokenId: 100 });

      context.repos.wallets.insertFrenNft(
        pet.id,
        100,
        'TinyFren #100 · Piggy',
        JSON.stringify({ shape: 'robot', vaultBacked: true }),
        1000,
        '47619047000000000000000000'
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/wallet/unwrap-nft',
        headers: { Origin: ORIGIN },
        payload: { token: pet.token, tokenId: 100 },
      });

      assert.equal(res.statusCode, 200);
      const udata = res.json();
      assert.equal(udata.ok, true);
      assert.equal(udata.tokenId, 100);
      assert.equal(udata.frensRedeemed, '47619047000000000000000000');
      assert.equal(udata.pet.tokenId, null);

      // Verify removed from fren_nfts
      const nftsAfter = context.repos.wallets.listFrenNfts(pet.id);
      assert.equal(nftsAfter.length, 0);

      // Cannot unwrap again
      const resAgain = await app.inject({
        method: 'POST',
        url: '/api/wallet/unwrap-nft',
        headers: { Origin: ORIGIN },
        payload: { token: pet.token, tokenId: 100 },
      });
      assert.equal(resAgain.statusCode, 400);
      assert.equal(resAgain.json().error, 'TinyFren NFT not found in your vault.');
    });

    test('rejects unwrap when NFT is not vault-backed', async () => {
      const pet = mintPet(context.db, { name: 'StandardBot', shape: 'robot', color: '#a474f1' });

      context.repos.wallets.insertFrenNft(
        pet.id,
        200,
        'TinyFren #200',
        JSON.stringify({ shape: 'robot', vaultBacked: false }),
        1000,
        '0'
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/wallet/unwrap-nft',
        headers: { Origin: ORIGIN },
        payload: { token: pet.token, tokenId: 200 },
      });

      assert.equal(res.statusCode, 400);
      assert.equal(res.json().error, 'This TinyFren is not backed by a FRENS Piggybank vault.');
    });
  });

  describe('POST /api/wallet/save-nft-changes (Flywheel)', () => {
    test('updates traits and records 50/50 burn and treasury fee', async () => {
      const pet = mintPet(context.db, { name: 'ArtFren', shape: 'robot', color: '#a474f1', tokenId: 300 });

      context.repos.wallets.insertFrenNft(
        pet.id,
        300,
        'TinyFren #300 · Original',
        JSON.stringify({ shape: 'robot', color: '#a474f1' }),
        1000,
        '0'
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/wallet/save-nft-changes',
        headers: { Origin: ORIGIN },
        payload: {
          token: pet.token,
          tokenId: 300,
          name: 'Cosmic Cat',
          customTraits: {
            color: '#4d96ff',
            expression: 'laser',
            accessory: 'crown',
          },
        },
      });

      assert.equal(res.statusCode, 200);
      const sdata = res.json();
      assert.equal(sdata.ok, true);
      assert.equal(sdata.burnedFrens, sdata.treasuryFrens);
      assert.equal(sdata.burnedFrens + sdata.treasuryFrens, sdata.feeFrens);
      assert.equal(sdata.pet.name, 'Cosmic Cat');
      assert.equal(sdata.traits.color, '#4d96ff');
      assert.equal(sdata.traits.expression, 'laser');
      assert.equal(sdata.traits.accessory, 'crown');

      // Verify burn log in DB
      const burnRows = context.db.prepare('SELECT * FROM frens_burn_log WHERE token_id=300').all() as any[];
      assert.equal(burnRows.length, 1);
      assert.equal(burnRows[0].action, 'save_changes');
      assert.equal(burnRows[0].amount_burned, burnRows[0].amount_treasury);
    });

    test('deducts user credits when economy is enabled', async () => {
      const pet = mintPet(context.db, { name: 'RichFren', shape: 'robot', color: '#a474f1', tokenId: 301 });

      context.repos.wallets.insertFrenNft(
        pet.id,
        301,
        'TinyFren #301',
        JSON.stringify({ shape: 'robot', color: '#a474f1' }),
        1000,
        '0'
      );

      // Setup economy with credit balance
      context.economy = new Economy(context.db, context.now, 100);
      context.economy.grant(pet.id, 1000000, 'test_deposit');

      const initialBal = context.economy.balance(pet.id);
      assert.ok(initialBal >= 500000);

      const res = await app.inject({
        method: 'POST',
        url: '/api/wallet/save-nft-changes',
        headers: { Origin: ORIGIN },
        payload: {
          token: pet.token,
          tokenId: 301,
          name: 'Updated Fren',
        },
      });

      assert.equal(res.statusCode, 200);
      const finalBal = context.economy.balance(pet.id);
      assert.ok(finalBal < initialBal);
    });
  });

  describe('POST /api/wallet/magic-link and /api/wallet/restore', () => {
    test('generates magic link and restores pet with new device token', async () => {
      const pet = mintPet(context.db, { name: 'RestoreMe', shape: 'robot', color: '#66c7d2', tokenId: 400 });

      // Generate magic link
      const linkRes = await app.inject({
        method: 'POST',
        url: '/api/wallet/magic-link',
        headers: { Origin: ORIGIN },
        payload: { token: pet.token },
      });

      assert.equal(linkRes.statusCode, 200);
      const linkData = linkRes.json();
      assert.ok(linkData.code);
      assert.ok(linkData.restoreUrl.includes('#restore=' + linkData.code));
      assert.ok(linkData.expires > Math.floor(context.now()));
      assert.ok(linkData.expires <= Math.floor(context.now()) + 15 * 60);

      // Restore pet with the code
      const restoreRes = await app.inject({
        method: 'POST',
        url: '/api/wallet/restore',
        headers: { Origin: ORIGIN },
        payload: { code: linkData.code },
      });

      assert.equal(restoreRes.statusCode, 200);
      const restoreData = restoreRes.json();
      assert.equal(restoreData.success, true);
      assert.equal(restoreData.id, pet.id);
      assert.equal(restoreData.code, pet.code);
      assert.ok(restoreData.token);
      assert.notEqual(restoreData.token, pet.token);
      assert.equal(restoreData.pet.name, 'RestoreMe');
      assert.equal(restoreData.pet.tokenId, 400);
      assert.ok(restoreData.vaultAddress.startsWith('0x'));

      // Old token should be invalidated
      const oldTokenRes = await app.inject({
        method: 'POST',
        url: '/api/bankr/nfts',
        headers: { Origin: ORIGIN },
        payload: { token: pet.token },
      });
      assert.equal(oldTokenRes.statusCode, 400);

      // New token should authenticate successfully
      const newTokenRes = await app.inject({
        method: 'POST',
        url: '/api/bankr/nfts',
        headers: { Origin: ORIGIN },
        payload: { token: restoreData.token },
      });
      assert.equal(newTokenRes.statusCode, 200);

      // Bearer recovery links are single-use.
      const replayRes = await app.inject({
        method: 'POST',
        url: '/api/wallet/restore',
        headers: { Origin: ORIGIN },
        payload: { code: linkData.code },
      });
      assert.equal(replayRes.statusCode, 404);
    });

    test('restore rejects invalid or expired code with 404', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/wallet/restore',
        headers: { Origin: ORIGIN },
        payload: { code: 'nonexistent-code' },
      });

      assert.equal(res.statusCode, 404);
      assert.equal(res.json().error, 'Magic restore link is invalid or expired.');
    });
  });
});
