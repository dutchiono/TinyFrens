import assert from 'node:assert';
import { describe, test } from 'node:test';
import { createDbConnection } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations.js';
import { loadConfig } from '../src/config.js';
import { createAppContext } from '../src/context.js';
import { startWorkers } from '../src/workers.js';

const rpcStub = async () =>
  ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x1' }) } as any);

function ctx(env: Record<string, string>) {
  const db = createDbConnection(':memory:');
  runMigrations(db);
  return createAppContext(loadConfig(env), db);
}

describe('Workers startup rules', () => {
  test('nothing starts without an RPC URL', async () => {
    const w = startWorkers(ctx({ FRENS_TREASURY_INDEXER: 'true', FRENS_TREASURY: '0x' + '7'.repeat(40) }), rpcStub);
    assert.strictEqual(w.deposit, null);
    assert.strictEqual(w.treasury, null);
    await w.stop();
  });

  test('auto mode needs router, controller key and RPC; false suppresses', async () => {
    const base = { BASE_RPC_URL: 'http://127.0.0.1:1' };
    const off = startWorkers(ctx(base), rpcStub);
    assert.strictEqual(off.deposit, null);
    await off.stop();

    const full = {
      ...base,
      DEPOSIT_ROUTER_PROXY: '0x' + '1'.repeat(40),
      GAME_CONTROLLER_PRIVATE_KEY: '0x' + '2'.repeat(64),
    };
    const on = startWorkers(ctx(full), rpcStub);
    assert.ok(on.deposit);
    await on.stop();

    const suppressed = startWorkers(ctx({ ...full, INDEXER_ENABLED: 'false' }), rpcStub);
    assert.strictEqual(suppressed.deposit, null);
    await suppressed.stop();
  });

  test('treasury indexer fails closed on invalid address and starts on valid config', async () => {
    const base = { BASE_RPC_URL: 'http://127.0.0.1:1', FRENS_TREASURY_INDEXER: 'true' };
    const bad = startWorkers(ctx({ ...base, FRENS_TREASURY: 'not-an-address' }), rpcStub);
    assert.strictEqual(bad.treasury, null);
    await bad.stop();

    const good = startWorkers(ctx({ ...base, FRENS_TREASURY: '0x' + '7'.repeat(40) }), rpcStub);
    assert.ok(good.treasury);
    await good.stop();
  });

  test('restores moderation challenges only when moderation and bot token are configured', async () => {
    const off = startWorkers(ctx({ TELEGRAM_MODERATION: 'false', TELEGRAM_BOT_TOKEN: 'token' }), rpcStub);
    assert.strictEqual(off.moderation, null);
    await off.stop();

    const missingToken = startWorkers(ctx({ TELEGRAM_MODERATION: 'true' }), rpcStub);
    assert.strictEqual(missingToken.moderation, null);
    await missingToken.stop();

    const on = startWorkers(ctx({ TELEGRAM_MODERATION: 'true', TELEGRAM_BOT_TOKEN: 'token' }), rpcStub);
    assert.ok(on.moderation);
    await on.stop();
  });

  test('reports provider failures instead of silently swallowing them', async () => {
    const expected = new Error('RPC unavailable');
    let reported: { worker: string; error: unknown } | undefined;
    let resolveReported!: () => void;
    const reportedPromise = new Promise<void>(resolve => { resolveReported = resolve; });
    const workers = startWorkers(
      ctx({
        BASE_RPC_URL: 'http://127.0.0.1:1',
        DEPOSIT_ROUTER_PROXY: '0x' + '1'.repeat(40),
        GAME_CONTROLLER_PRIVATE_KEY: '0x' + '2'.repeat(64),
        INDEXER_POLL_SECONDS: '1',
      }),
      async () => { throw expected; },
      (worker, error) => {
        reported = { worker, error };
        resolveReported();
      }
    );

    await reportedPromise;
    assert.deepStrictEqual(reported, { worker: 'deposit', error: expected });
    await workers.stop();
  });
});
