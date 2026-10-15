import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createAppContext, AppContext } from '../../src/context.js';
import { BetterSqliteConnection, DatabaseConnection } from '../../src/db/connection.js';
import { loadConfig } from '../../src/config.js';
import { Admin } from '../../src/domain/admin.js';
import { MarketQuote } from '../../src/domain/market-quote.js';
import {
  CARE_ACTIONS,
  DEFAULT_DAILY_ALLOWANCE,
} from '../../src/domain/robot-care-rules.js';

const AUTH_HEADER = { authorization: 'Bearer secret' };

describe('Admin Routes Integration Tests', () => {
  let app: FastifyInstance;
  let context: AppContext;
  let db: DatabaseConnection;

  beforeEach(async () => {
    db = new BetterSqliteConnection(':memory:');
    const config = loadConfig({
      ADMIN_TOKEN: 'secret',
      FRENS_TREASURY: '0x' + 'de'.repeat(20),
      FRENS_TREASURY_MAX_CREDITS: '50000',
      ECONOMY_MODE: 'testnet',
      FRENS_TOKEN: '0x1a96226727a1d0a46334b3a4b3878b32b7659ba3',
      CHAIN_ID: '8453',
    });

    context = createAppContext(config, db);
    app = await buildApp({ context });
    await app.ready();
  });

  it('requires token', async () => {
    const r1 = await app.inject({
      method: 'GET',
      url: '/api/admin/state',
    });
    assert.equal(r1.statusCode, 401);

    const r2 = await app.inject({
      method: 'GET',
      url: '/api/admin/state',
      headers: { authorization: 'Bearer wrong' },
    });
    assert.equal(r2.statusCode, 401);
  });

  it('disabled without config or user', async () => {
    const disabledDb = new BetterSqliteConnection(':memory:');
    const disabledAdmin = new Admin(disabledDb, { token: null, seedDefaultUser: false });
    const disabledConfig = loadConfig({ ADMIN_TOKEN: '' });
    const disabledCtx = createAppContext(disabledConfig, disabledDb, { admin: disabledAdmin });
    const disabledApp = await buildApp({ context: disabledCtx });
    await disabledApp.ready();

    const res = await disabledApp.inject({
      method: 'GET',
      url: '/api/admin/state',
      headers: AUTH_HEADER,
    });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.json(), { error: 'Admin is disabled' });
  });

  it('login and session workflow', async () => {
    // 1. Successful login
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: 'dutch', password: 'nottodayjunior' },
    });
    assert.equal(loginRes.statusCode, 200);
    const loginData = loginRes.json();
    assert.equal(loginData.username, 'dutch');
    const token = loginData.token;
    assert.ok(token);

    // 2. Authenticate using session token
    const stateRes = await app.inject({
      method: 'GET',
      url: '/api/admin/state',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(stateRes.statusCode, 200);
    assert.equal(stateRes.json().currentUser, 'dutch');

    // 3. Logout
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/admin/logout',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(logoutRes.statusCode, 200);
    assert.deepEqual(logoutRes.json(), { ok: true });

    // 4. Session is invalidated
    const afterRes = await app.inject({
      method: 'GET',
      url: '/api/admin/state',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(afterRes.statusCode, 401);
  });

  it('login invalid password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: 'dutch', password: 'wrong' },
    });
    assert.equal(res.statusCode, 401);
  });

  it('create user and login', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: AUTH_HEADER,
      payload: { username: 'newadmin', password: 'securepassword123' },
    });
    assert.equal(createRes.statusCode, 200);
    const createData = createRes.json();
    assert.equal(createData.user, 'newadmin');

    // Log in with newly created user
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: 'newadmin', password: 'securepassword123' },
    });
    assert.equal(loginRes.statusCode, 200);
    assert.equal(loginRes.json().username, 'newadmin');
  });

  it('state reports settings and economy', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/state',
      headers: AUTH_HEADER,
    });
    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.equal(data.settings.dailyAllowance, DEFAULT_DAILY_ALLOWANCE);
    assert.deepEqual(data.overrides, {});
    assert.deepEqual(Object.keys(data.settings.prices).sort(), [...CARE_ACTIONS].sort());
    assert.equal(data.economy.treasury, '0x' + 'de'.repeat(20));
    assert.equal(data.counts.registeredDevices, null); // absent table is not a fake zero
    assert.equal(data.counts.syncAccounts, null);
    assert.equal(data.audit[0].action, 'create_user');
    assert.deepEqual(data.audit[0].detail, { username: 'dutch' });
  });

  it('device count is not a fren count', async () => {
    db.exec('CREATE TABLE IF NOT EXISTS pets(id TEXT, code TEXT, token TEXT, profile TEXT);');
    db.exec('CREATE TABLE IF NOT EXISTS device_sync_members(account TEXT, device TEXT, joined INTEGER);');
    db.prepare('INSERT INTO pets(id, code, token, profile) VALUES(?, ?, ?, ?)').run('device-a', 'code-a', 'tok-a', '{}');
    db.prepare('INSERT INTO pets(id, code, token, profile) VALUES(?, ?, ?, ?)').run('device-b', 'code-b', 'tok-b', '{}');
    db.prepare('INSERT INTO device_sync_members(account, device, joined) VALUES(?, ?, ?)').run('shared', 'device-a', 1000);
    db.prepare('INSERT INTO device_sync_members(account, device, joined) VALUES(?, ?, ?)').run('shared', 'device-b', 1000);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/state',
      headers: AUTH_HEADER,
    });
    const data = res.json();
    assert.equal(data.counts.registeredDevices, 2);
    assert.equal(data.counts.syncAccounts, 1);
    assert.equal('pets' in data.counts, false);
  });

  it('market is guarded and independent of credit economy', async () => {
    const unauth = await app.inject({
      method: 'GET',
      url: '/api/admin/market',
    });
    assert.equal(unauth.statusCode, 401);

    // Mock MarketQuote
    context.marketQuote = new MarketQuote(() => 1000, async () => {
      return [
        [
          {
            chainId: 'base',
            pairAddress: '0xpair',
            baseToken: { address: '0x1a96226727a1d0a46334b3a4b3878b32b7659ba3' },
            quoteToken: { address: '0x4200000000000000000000000000000000000006' },
            priceNative: '0.000001',
            priceUsd: '0.002',
            liquidity: { usd: '50000' },
          },
        ],
        [
          {
            chainId: 'base',
            pairAddress: '0xethpair',
            baseToken: { address: '0x4200000000000000000000000000000000000006' },
            quoteToken: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
            priceNative: '1',
            priceUsd: '2000',
            liquidity: { usd: '10000000' },
          },
        ],
      ];
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/market',
      headers: AUTH_HEADER,
    });
    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.equal(data.status, 'available');
    assert.equal(data.source, 'DEX Screener · Base pools');
  });

  it('update settings and audit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/settings',
      headers: AUTH_HEADER,
      payload: { gameRewardCredits: 750 },
    });
    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.equal(data.settings.gameRewardCredits, 750);
    assert.deepEqual(data.overrides, { gameRewardCredits: 750 });

    const again = await app.inject({
      method: 'GET',
      url: '/api/admin/state',
      headers: AUTH_HEADER,
    });
    const stateData = again.json();
    assert.equal(stateData.settings.gameRewardCredits, 750);
    assert.deepEqual(stateData.overrides, { gameRewardCredits: 750 });
    assert.equal(stateData.audit[0].action, 'settings');
    assert.deepEqual(stateData.audit[0].detail, { gameRewardCredits: 750 });
  });

  it('update prices and allowance', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/settings',
      headers: AUTH_HEADER,
      payload: { dailyAllowance: 12, prices: { feed: 99, play: 88 } },
    });
    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.equal(data.settings.dailyAllowance, 12);
    assert.equal(data.settings.prices.feed, 99);
    assert.equal(data.settings.prices.play, 88);

    const again = await app.inject({
      method: 'GET',
      url: '/api/admin/state',
      headers: AUTH_HEADER,
    });
    const stateData = again.json();
    assert.equal(stateData.settings.dailyAllowance, 12);
    assert.equal(stateData.settings.prices.feed, 99);
  });

  it('bad settings payload rejected', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/settings',
      headers: AUTH_HEADER,
      payload: { dailyAllowance: -5 },
    });
    assert.equal(res.statusCode, 400);
    assert.ok(res.json().error);
  });

  it('ledger route', async () => {
    db.prepare("INSERT INTO credit_accounts(pet_id, balance, updated_at) VALUES('pet-1', 400, 1000)").run();
    db.prepare(
      "INSERT INTO credit_ledger(pet_id, delta, balance, reason, ref_type, ref_id, created) " +
      "VALUES('pet-1', 400, 400, 'deposit', 'tx', '0x1', 1000)"
    ).run();

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/ledger?limit=10',
      headers: AUTH_HEADER,
    });
    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.equal(data.entries.length, 1);
    assert.equal(data.entries[0].petId, 'pet-1');
    assert.equal(data.entries[0].balance, 400);
    assert.equal(data.top[0].petId, 'pet-1');
  });

  it('ledger rejects bad limit', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/ledger?limit=0',
      headers: AUTH_HEADER,
    });
    assert.equal(res.statusCode, 400);
  });

  it('care route validates day', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/care?day=not-a-day',
      headers: AUTH_HEADER,
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, 'day must be YYYY-MM-DD');
  });

  it('care route returns rows', async () => {
    db.prepare("INSERT INTO robot_care_daily(pet_id, day, used, updated) VALUES('pet-1', '2026-10-12', 3, 1000)").run();

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/care?day=2026-10-12',
      headers: AUTH_HEADER,
    });
    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.equal(data.day, '2026-10-12');
    assert.equal(data.allowance, DEFAULT_DAILY_ALLOWANCE);
    assert.equal(data.rows.length, 1);
    assert.equal(data.rows[0].petId, 'pet-1');
    assert.equal(data.rows[0].used, 3);
  });

  it('admin page serves html', async () => {
    for (const url of ['/admin', '/admin/', '/admin.html', '/web/admin.html']) {
      const res = await app.inject({
        method: 'GET',
        url,
      });
      assert.equal(res.statusCode, 200);
      assert.ok(res.headers['content-type']?.includes('text/html'));
      assert.ok(res.body.includes('TinyFrens admin'));
    }
  });
});
