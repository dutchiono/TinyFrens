import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { createAppContext } from '../../src/context.js';
import { createDatabaseConnection } from '../../src/db/connection.js';
import { initSchema } from '../../src/db/schema.js';
import { loadConfig } from '../../src/config.js';

const ORIGIN = 'https://tinyfrens.lol';
const ADDRESS = '0x' + 'ab'.repeat(20);
const FRENS_TOKEN = '0x' + '11'.repeat(20);
const INDEXER_SECRET = 'test-indexer-secret';
const SESSION_ID = '0x' + '22'.repeat(32);

describe('Economy Route Tests (server/test_economy.py)', () => {
  let db: ReturnType<typeof createDatabaseConnection>;
  let context: ReturnType<typeof createAppContext>;
  let token: string;
  let petId: string;

  beforeEach(async () => {
    db = createDatabaseConnection(':memory:');
    initSchema(db);

    const config = loadConfig({
      ECONOMY_MODE: 'testnet',
      FRENS_TOKEN,
      CHAIN_ID: '84532',
      ECONOMY_DEPOSITS: 'true',
      ECONOMY_INDEXER_SECRET: INDEXER_SECRET,
      ALLOWED_ORIGINS: ORIGIN,
      DEPOSIT_SESSION_ADDRESSES: ADDRESS,
    });

    context = createAppContext(config, db, {
      depositAllocator: async (_pid: string, _token?: string | null) => [
        ADDRESS,
        FRENS_TOKEN,
        SESSION_ID,
      ],
    });
    context.rateLimiter.clear();

    // Register a test pet
    const petRow = { name: 'Test', shape: 'turtle', color: '#a474f1' };
    const regRes = await (await buildApp({ context })).inject({
      method: 'POST',
      url: '/api/register',
      headers: { origin: ORIGIN },
      payload: { pet: petRow },
    });
    const registration = JSON.parse(regRes.body);
    token = registration.token;
    petId = registration.id;
  });

  it('test_open_confirm_balance_flow', async () => {
    const app = await buildApp({ context });

    const openRes = await app.inject({
      method: 'POST',
      url: '/api/deposits/open',
      headers: { origin: ORIGIN },
      payload: { token, package: 50 },
    });
    assert.equal(openRes.statusCode, 200);
    const data = JSON.parse(openRes.body);
    assert.equal(data.amountWei, (50n * 10n ** 18n).toString());
    assert.equal(data.energyMilli, 50_000);
    assert.equal(data.purchaseKind, 'energy');
    assert.equal(data.token, FRENS_TOKEN);

    const confirmRes = await app.inject({
      method: 'POST',
      url: '/api/deposits/confirm',
      headers: { origin: ORIGIN, 'x-indexer-secret': INDEXER_SECRET },
      payload: { depositId: data.depositId, txHash: '0xTX', amount: (50n * 10n ** 18n).toString(), chainId: 84532 },
    });
    assert.equal(confirmRes.statusCode, 200);
    const confirmed = JSON.parse(confirmRes.body);
    assert.equal(confirmed.status, 'confirmed');
    assert.equal(confirmed.credits, 0);
    assert.equal(confirmed.energyMilli, 50_000);

    const duplicateRes = await app.inject({
      method: 'POST',
      url: '/api/deposits/confirm',
      headers: { origin: ORIGIN, 'x-indexer-secret': INDEXER_SECRET },
      payload: { depositId: data.depositId, txHash: '0xTX', amount: (50n * 10n ** 18n).toString() },
    });
    assert.equal(duplicateRes.statusCode, 200);
    assert.equal(JSON.parse(duplicateRes.body).status, 'duplicate');

    const balanceRes = await app.inject({
      method: 'POST',
      url: '/api/credits/balance',
      headers: { origin: ORIGIN },
      payload: { token },
    });
    assert.equal(balanceRes.statusCode, 200);
    const balance = JSON.parse(balanceRes.body);
    assert.equal(balance.balance, 0);
    assert.equal(balance.creditsPerFrens, 100);
    assert.equal(balanceRes.headers['cache-control'], 'no-store');

    const account = context.repos.deviceSync.getAccountForDevice(petId);
    assert.ok(account);
    const energy = db.prepare<{ purchased_milli: number }>(
      'SELECT purchased_milli FROM player_energy WHERE account=?'
    ).get(account);
    assert.equal(energy?.purchased_milli, 50_000);
  });

  it('test_status_endpoint', async () => {
    const app = await buildApp({ context });

    const openRes = await app.inject({
      method: 'POST',
      url: '/api/deposits/open',
      headers: { origin: ORIGIN },
      payload: { token, package: 10 },
    });
    const depositId = JSON.parse(openRes.body).depositId;

    const statusRes = await app.inject({
      method: 'POST',
      url: '/api/deposits/status',
      headers: { origin: ORIGIN },
      payload: { token, depositId },
    });
    assert.equal(statusRes.statusCode, 200);
    assert.equal(JSON.parse(statusRes.body).status, 'open');
  });

  it('test_status_rejects_other_pet', async () => {
    const app = await buildApp({ context });

    const openRes = await app.inject({
      method: 'POST',
      url: '/api/deposits/open',
      headers: { origin: ORIGIN },
      payload: { token, package: 10 },
    });
    const depositId = JSON.parse(openRes.body).depositId;

    // Register second pet
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/register',
      headers: { origin: ORIGIN },
      payload: { pet: { name: 'Other', shape: 'robot', color: '#123456' } },
    });
    const token2 = JSON.parse(regRes.body).token;

    const statusRes = await app.inject({
      method: 'POST',
      url: '/api/deposits/status',
      headers: { origin: ORIGIN },
      payload: { token: token2, depositId },
    });
    assert.equal(statusRes.statusCode, 404);
  });

  it('test_unknown_package_rejected', async () => {
    const app = await buildApp({ context });

    const res = await app.inject({
      method: 'POST',
      url: '/api/deposits/open',
      headers: { origin: ORIGIN },
      payload: { token, package: 7 },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, 'Unknown package');
  });

  it('test_confirm_unknown_session_404', async () => {
    const app = await buildApp({ context });

    const res = await app.inject({
      method: 'POST',
      url: '/api/deposits/confirm',
      headers: { origin: ORIGIN },
      payload: { depositId: 'nope', txHash: '0xTX', amount: 1 },
    });
    assert.equal(res.statusCode, 404);
  });

  it('test_confirm_second_deposit_conflict', async () => {
    const app = await buildApp({ context });

    const openRes = await app.inject({
      method: 'POST',
      url: '/api/deposits/open',
      headers: { origin: ORIGIN },
      payload: { token, package: 10 },
    });
    const depositId = JSON.parse(openRes.body).depositId;

    await app.inject({
      method: 'POST',
      url: '/api/deposits/confirm',
      headers: { origin: ORIGIN, 'x-indexer-secret': INDEXER_SECRET },
      payload: { depositId, txHash: '0x1', amount: (10n * 10n ** 18n).toString() },
    });

    const secondRes = await app.inject({
      method: 'POST',
      url: '/api/deposits/confirm',
      headers: { origin: ORIGIN, 'x-indexer-secret': INDEXER_SECRET },
      payload: { depositId, txHash: '0x2', amount: (10n * 10n ** 18n).toString() },
    });
    assert.equal(secondRes.statusCode, 409);
  });

  it('test_disabled_economy_returns_503', async () => {
    const disabledConfig = loadConfig({
      ECONOMY_MODE: 'off',
      ALLOWED_ORIGINS: ORIGIN,
    });
    const disabledContext = createAppContext(disabledConfig, db);
    const app = await buildApp({ context: disabledContext });

    const res = await app.inject({
      method: 'POST',
      url: '/api/deposits/open',
      headers: { origin: ORIGIN },
      payload: { token, package: 10 },
    });
    assert.equal(res.statusCode, 503);
  });

  it('test_production_deposits_remain_disabled', async () => {
    const productionConfig = loadConfig({
      ECONOMY_MODE: 'production',
      ECONOMY_DEPOSITS: 'true',
      ALLOWED_ORIGINS: ORIGIN,
    });
    const productionContext = createAppContext(productionConfig, db, {
      depositAllocator: async () => ADDRESS,
    });
    const app = await buildApp({ context: productionContext });

    const res = await app.inject({
      method: 'POST',
      url: '/api/deposits/open',
      headers: { origin: ORIGIN },
      payload: { token, package: 10 },
    });
    assert.equal(res.statusCode, 503);
  });

  it('refuses HTTP Energy confirmation without an indexer secret', async () => {
    const unsafeConfig = loadConfig({
      ECONOMY_MODE: 'testnet',
      ECONOMY_DEPOSITS: 'true',
      FRENS_TOKEN,
      CHAIN_ID: '84532',
      ALLOWED_ORIGINS: ORIGIN,
    });
    const unsafeContext = createAppContext(unsafeConfig, db, {
      depositAllocator: async () => [ADDRESS, FRENS_TOKEN, SESSION_ID],
    });
    const app = await buildApp({ context: unsafeContext });
    const openRes = await app.inject({
      method: 'POST',
      url: '/api/deposits/open',
      headers: { origin: ORIGIN },
      payload: { token, package: 10 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/deposits/confirm',
      headers: { origin: ORIGIN },
      payload: {
        depositId: openRes.json().depositId,
        txHash: '0xUNVERIFIED',
        amount: (10n * 10n ** 18n).toString(),
        chainId: 84532,
      },
    });
    assert.equal(res.statusCode, 503);
    assert.match(res.json().error, /not configured/);
  });

  it('snapshots the configured Energy quote when opening', async () => {
    const quotedConfig = loadConfig({
      ECONOMY_MODE: 'testnet',
      ECONOMY_DEPOSITS: 'true',
      TESTNET_ENERGY_MILLI_PER_FRENS: '2500',
      FRENS_TOKEN,
      CHAIN_ID: '84532',
      ALLOWED_ORIGINS: ORIGIN,
    });
    const quotedContext = createAppContext(quotedConfig, db, {
      depositAllocator: async () => [ADDRESS, FRENS_TOKEN, SESSION_ID],
    });
    const app = await buildApp({ context: quotedContext });

    const res = await app.inject({
      method: 'POST',
      url: '/api/deposits/open',
      headers: { origin: ORIGIN },
      payload: { token, package: 10 },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().energyMilli, 25_000);
    assert.equal(quotedContext.economy.session(res.json().depositId).energyMilli, 25_000);
  });

  it('grants a pending purchase to the account that owns the device at confirmation', async () => {
    const app = await buildApp({ context });
    const openRes = await app.inject({
      method: 'POST',
      url: '/api/deposits/open',
      headers: { origin: ORIGIN },
      payload: { token, package: 10 },
    });
    assert.equal(openRes.statusCode, 200);

    const originalAccount = context.repos.deviceSync.ensureAccount(petId);
    const recoveredAccount = 'recovered-account';
    db.prepare(
      "INSERT INTO device_sync_accounts(account, revision, selection, telegram_selection) VALUES(?, 0, '[]', '[]')"
    ).run(recoveredAccount);
    context.repos.deviceSync.transferDeviceMemberships(recoveredAccount, originalAccount);

    const depositId = openRes.json().depositId;
    const confirmRes = await app.inject({
      method: 'POST',
      url: '/api/deposits/confirm',
      headers: { origin: ORIGIN, 'x-indexer-secret': INDEXER_SECRET },
      payload: {
        depositId,
        txHash: '0xRECOVERED',
        amount: (10n * 10n ** 18n).toString(),
        chainId: 84532,
      },
    });
    assert.equal(confirmRes.statusCode, 200);
    assert.equal(confirmRes.json().account, recoveredAccount);
    assert.equal(
      db.prepare<{ purchased_milli: number }>(
        'SELECT purchased_milli FROM player_energy WHERE account=?'
      ).get(recoveredAccount)?.purchased_milli,
      10_000
    );
    assert.equal(
      db.prepare<{ account: string }>('SELECT account FROM deposits WHERE session_id=?')
        .get(depositId)?.account,
      recoveredAccount
    );
  });

  it('test_no_allocator_returns_503', async () => {
    const noAllocContext = createAppContext(context.config, db, {
      depositAllocator: null,
    });
    const app = await buildApp({ context: noAllocContext });

    const res = await app.inject({
      method: 'POST',
      url: '/api/deposits/open',
      headers: { origin: ORIGIN },
      payload: { token, package: 10 },
    });
    assert.equal(res.statusCode, 503);
  });

  it('rejects an address-pool fallback for new Energy purchases', async () => {
    const poolContext = createAppContext(context.config, db, {
      depositAllocator: async () => ADDRESS,
    });
    const app = await buildApp({ context: poolContext });

    const res = await app.inject({
      method: 'POST',
      url: '/api/deposits/open',
      headers: { origin: ORIGIN },
      payload: { token, package: 10 },
    });
    assert.equal(res.statusCode, 503);
    assert.match(res.json().error, /router-backed/);
  });

  it('test_failing_allocator_returns_503', async () => {
    const brokenContext = createAppContext(context.config, db, {
      depositAllocator: async () => {
        throw new Error('rpc down');
      },
    });
    const app = await buildApp({ context: brokenContext });

    const res = await app.inject({
      method: 'POST',
      url: '/api/deposits/open',
      headers: { origin: ORIGIN },
      payload: { token, package: 10 },
    });
    assert.equal(res.statusCode, 503);
    assert.equal(JSON.parse(res.body).error, 'Deposit allocator unavailable');
  });

  it('test_async_allocator_injects_session_id', async () => {
    const customContext = createAppContext(context.config, db, {
      depositAllocator: async (_pid: string, _token?: string | null) => [
        '0x' + 'cd'.repeat(20),
        FRENS_TOKEN,
        '0x' + 'aa'.repeat(32),
      ],
    });
    const app = await buildApp({ context: customContext });

    const res = await app.inject({
      method: 'POST',
      url: '/api/deposits/open',
      headers: { origin: ORIGIN },
      payload: { token, package: 10 },
    });
    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.depositId, '0x' + 'aa'.repeat(32));
    assert.equal(data.address, '0x' + 'cd'.repeat(20));
    assert.equal(data.token, FRENS_TOKEN);
  });

  it('test_deposit_requires_allowed_origin', async () => {
    const app = await buildApp({ context });

    const res = await app.inject({
      method: 'POST',
      url: '/api/deposits/open',
      headers: { origin: 'https://evil.example' },
      payload: { token: 'x', package: 10 },
    });
    assert.equal(res.statusCode, 403);
  });

  it('test_confirm_secret_protection', async () => {
    const secretConfig = loadConfig({
      ECONOMY_MODE: 'testnet',
      FRENS_TOKEN,
      CHAIN_ID: '84532',
      ALLOWED_ORIGINS: ORIGIN,
      ECONOMY_INDEXER_SECRET: 'my-super-secret',
    });
    const secretContext = createAppContext(secretConfig, db);
    const app = await buildApp({ context: secretContext });

    const s = secretContext.economy.openSession('pet-1', ADDRESS, 10);

    // Missing secret
    const rejectRes = await app.inject({
      method: 'POST',
      url: '/api/deposits/confirm',
      headers: { origin: ORIGIN },
      payload: { depositId: s.id, txHash: '0xTX', amount: (10n * 10n ** 18n).toString() },
    });
    assert.equal(rejectRes.statusCode, 403);

    // Valid secret
    const acceptRes = await app.inject({
      method: 'POST',
      url: '/api/deposits/confirm',
      headers: { origin: ORIGIN, 'x-indexer-secret': 'my-super-secret' },
      payload: { depositId: s.id, txHash: '0xTX', amount: (10n * 10n ** 18n).toString() },
    });
    assert.equal(acceptRes.statusCode, 200);
  });
});
