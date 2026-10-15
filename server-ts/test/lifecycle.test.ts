import assert from 'node:assert';
import { describe, test } from 'node:test';
import { createGracefulShutdown, ShutdownTimeoutError } from '../src/lifecycle.js';

describe('graceful shutdown', () => {
  test('stops workers before closing the app', async () => {
    const calls: string[] = [];
    const shutdown = createGracefulShutdown({
      stopWorkers: async () => {
        calls.push('workers');
      },
      closeApp: async () => {
        calls.push('app');
      },
    });

    await shutdown();
    assert.deepStrictEqual(calls, ['workers', 'app']);
  });

  test('is idempotent when multiple signals arrive', async () => {
    let workerStops = 0;
    let appCloses = 0;
    const shutdown = createGracefulShutdown({
      stopWorkers: async () => {
        workerStops += 1;
      },
      closeApp: async () => {
        appCloses += 1;
      },
    });

    await Promise.all([shutdown(), shutdown(), shutdown()]);
    assert.strictEqual(workerStops, 1);
    assert.strictEqual(appCloses, 1);
  });

  test('still closes the app when worker shutdown fails', async () => {
    let appClosed = false;
    const expected = new Error('worker failed');
    const shutdown = createGracefulShutdown({
      stopWorkers: async () => {
        throw expected;
      },
      closeApp: async () => {
        appClosed = true;
      },
    });

    await assert.rejects(shutdown(), error => error === expected);
    assert.strictEqual(appClosed, true);
  });

  test('rejects when the shutdown deadline is exceeded', async () => {
    const shutdown = createGracefulShutdown(
      {
        stopWorkers: () => new Promise(() => undefined),
        closeApp: async () => undefined,
      },
      20
    );

    await assert.rejects(shutdown(), ShutdownTimeoutError);
  });
});
