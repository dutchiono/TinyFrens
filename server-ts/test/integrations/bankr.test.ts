import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyHandle,
  BankrHandleMismatchError,
  BankrVerificationUnavailableError,
} from '../../src/integrations/bankr.js';

describe('Bankr Identity (server/bankr_identity.py)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('only matching resolved wallet is accepted', async () => {
    // 1. Resolved with matching address (case-insensitive) -> succeeds
    globalThis.fetch = (async (url: string | URL) => {
      const u = new URL(url.toString());
      assert.strictEqual(u.origin, 'https://api.bankr.bot');
      assert.strictEqual(u.pathname, '/addresses/resolve');
      assert.strictEqual(u.searchParams.get('value'), 'test');
      assert.strictEqual(u.searchParams.get('type'), 'twitter');
      return new Response(JSON.stringify({ resolved: true, address: '0xABC' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    await assert.doesNotReject(async () => {
      await verifyHandle('test', '0xabc');
    });

    // 2. Resolved with mismatching address -> throws BankrHandleMismatchError
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ resolved: true, address: '0xdef' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    await assert.rejects(
      async () => {
        await verifyHandle('test', '0xabc');
      },
      (err: Error) => {
        assert.ok(err instanceof BankrHandleMismatchError);
        assert.strictEqual(err.message, 'Bankr does not link this X handle to the signing wallet');
        return true;
      }
    );

    // 3. Not resolved -> throws BankrHandleMismatchError
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ resolved: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    await assert.rejects(
      async () => {
        await verifyHandle('test', '0xabc');
      },
      (err: Error) => {
        assert.ok(err instanceof BankrHandleMismatchError);
        assert.strictEqual(err.message, 'Bankr does not link this X handle to the signing wallet');
        return true;
      }
    );
  });

  test('non-200 HTTP response throws BankrVerificationUnavailableError', async () => {
    globalThis.fetch = (async () => {
      return new Response('Service Unavailable', { status: 503 });
    }) as any;

    await assert.rejects(
      async () => {
        await verifyHandle('test', '0xabc');
      },
      (err: Error) => {
        assert.ok(err instanceof BankrVerificationUnavailableError);
        assert.strictEqual(err.message, 'Bankr X verification unavailable. Retry the connection.');
        return true;
      }
    );
  });

  test('fetch network error or timeout throws BankrVerificationUnavailableError', async () => {
    globalThis.fetch = (async () => {
      throw new Error('Connection reset');
    }) as any;

    await assert.rejects(
      async () => {
        await verifyHandle('test', '0xabc');
      },
      (err: Error) => {
        assert.ok(err instanceof BankrVerificationUnavailableError);
        assert.strictEqual(err.message, 'Bankr X verification unavailable. Retry the connection.');
        return true;
      }
    );
  });
});
