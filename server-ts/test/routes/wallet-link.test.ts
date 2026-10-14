import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { FastifyInstance } from 'fastify';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { buildApp } from '../../src/app.js';
import { createAppContext, AppContext } from '../../src/context.js';
import { loadConfig } from '../../src/config.js';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import { HOOD_TURTLE_COLLECTION } from '../../src/domain/turtle-ownership.js';
import { rpcCandidates, discoverWallets, TurtleOwnership } from '../../src/domain/turtle-ownership.js';

describe('Turtle Connect & EVM Wallet Linking (server/test_turtle_connect.py)', () => {
  const ORIGIN = 'https://tinyfrens.lol';
  let app: FastifyInstance;
  let context: AppContext;
  let rpcServer: http.Server;
  let rpcUrl: string;

  let rpcState = {
    calls: 0,
    unavailable: false,
    malformed: false,
    burned: false,
    owner: '',
    metadata: {
      name: 'Hood Turtle #7',
      image: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="5" y="18" width="3" height="2"/><rect x="7" y="20" width="1" height="4"/><rect x="12" y="21" width="1" height="4"/><rect x="17" y="20" width="1" height="4"/><rect x="21" y="21" width="1" height="4"/></svg>').toString('base64'),
    },
  };

  const account = privateKeyToAccount(generatePrivateKey());

  before(async () => {
    // Start local mock RPC server
    rpcServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
      });
      req.on('end', () => {
        rpcState.calls++;
        if (rpcState.unavailable) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: -32000 } }));
          return;
        }

        const parsed = JSON.parse(body);
        const params = parsed.params?.[0] || {};
        const data = String(params.data || '');

        if (rpcState.burned && data.startsWith('0x6352211e')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 3, message: 'execution reverted' } }));
          return;
        }

        if (rpcState.malformed) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result: '0x1234' }));
          return;
        }

        if (data.startsWith('0x6352211e')) {
          // ownerOf
          const cleanAddr = rpcState.owner.toLowerCase().replace('0x', '').padStart(64, '0');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result: '0x' + cleanAddr }));
          return;
        }

        if (data.startsWith('0xc87b56dd')) {
          // tokenURI
          const uriStr = 'data:application/json;base64,' + Buffer.from(JSON.stringify(rpcState.metadata)).toString('base64');
          const uriBuf = Buffer.from(uriStr, 'utf-8');
          const offsetHex = (32).toString(16).padStart(64, '0');
          const lengthHex = uriBuf.length.toString(16).padStart(64, '0');
          const uriHex = uriBuf.toString('hex');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result: '0x' + offsetHex + lengthHex + uriHex }));
          return;
        }

        if (parsed.method === 'eth_blockNumber') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result: '0x' + (100).toString(16) }));
          return;
        }

        if (parsed.method === 'eth_getLogs') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              result: [
                {
                  address: HOOD_TURTLE_COLLECTION,
                  topics: [
                    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                    '0x' + '0'.repeat(64),
                    '0x' + rpcState.owner.toLowerCase().replace('0x', '').padStart(64, '0'),
                    '0x' + (7).toString(16).padStart(64, '0'),
                  ],
                },
              ],
            })
          );
          return;
        }

        if (data.startsWith('0x70a08231')) {
          // balanceOf
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result: '0x' + (1).toString(16).padStart(64, '0') }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: '0x' }));
      });
    });

    await new Promise<void>(resolve => {
      rpcServer.listen(0, '127.0.0.1', () => {
        const addr = rpcServer.address() as any;
        rpcUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    const config = loadConfig({
      ALLOWED_ORIGINS: ORIGIN,
      ROBINHOOD_RPC_URL: rpcUrl,
      BANKR_API_URL: 'https://api.bankr.bot',
    });
    const db = createDbConnection(':memory:');
    runMigrations(db);

    context = createAppContext(config, db);
    app = await buildApp({ context });
    await app.ready();
  });

  after(async () => {
    await app.close();
    await new Promise(resolve => rpcServer.close(resolve));
  });

  beforeEach(() => {
    rpcState.calls = 0;
    rpcState.unavailable = false;
    rpcState.malformed = false;
    rpcState.burned = false;
    rpcState.owner = account.address;
    context.rateLimiter.clear();
  });

  async function registerPhone() {
    const res = await app.inject({
      method: 'POST',
      url: '/api/register',
      headers: { Origin: ORIGIN },
      payload: { pet: { name: 'Turtle', shape: 'turtle', color: '#82eba1' } },
    });
    assert.strictEqual(res.statusCode, 200, res.payload);
    return res.json() as { token: string; id: string };
  }

  async function postTurtle(
    name: string,
    body: Record<string, unknown>,
    phone?: { token: string },
    agent = false
  ) {
    const payload = { ...body };
    if (!agent) {
      payload.token = phone?.token;
    }
    return app.inject({
      method: 'POST',
      url: `/api/turtle-connect/${name}`,
      headers: agent ? {} : { Origin: ORIGIN },
      payload,
    });
  }

  test('wallet-wide pairing does not require a token for challenge/confirm', async () => {
    const phone = await registerPhone();

    const startRes = await postTurtle('start', {}, phone);
    assert.strictEqual(startRes.statusCode, 200);
    const pairing = startRes.json();

    const challengeRes = await postTurtle(
      'challenge',
      { code: pairing.code, address: account.address },
      undefined,
      true
    );
    assert.strictEqual(challengeRes.statusCode, 200);
    const challenge = challengeRes.json();

    const signature = await account.signMessage({ message: challenge.message });
    const confirmRes = await postTurtle(
      'confirm',
      { code: pairing.code, challengeId: challenge.challengeId, signature },
      undefined,
      true
    );
    assert.strictEqual(confirmRes.statusCode, 200);
    assert.strictEqual(rpcState.calls, 0); // No tokenId specified, no RPC call

    const acceptRes = await postTurtle('accept', { code: pairing.code }, phone);
    assert.strictEqual(acceptRes.statusCode, 200);
    const data = acceptRes.json();
    assert.strictEqual(data.address.toLowerCase(), account.address.toLowerCase());
    assert.strictEqual(data.tokenId, null);
  });

  test('X handle is signed and saved only after device accepts', async () => {
    const phone = await registerPhone();

    // Mock fetch for bankr
    const originalFetch = globalThis.fetch;
    let bankrVerified = false;
    globalThis.fetch = (async (url: string | URL) => {
      if (url.toString().includes('bankr.bot')) {
        bankrVerified = true;
        return new Response(JSON.stringify({ resolved: true, address: account.address }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(url);
    }) as any;

    try {
      const pairing = (await postTurtle('start', {}, phone)).json();
      const challengeRes = await postTurtle(
        'challenge',
        { code: pairing.code, address: account.address, xHandle: '@robot_owner' },
        undefined,
        true
      );
      assert.strictEqual(challengeRes.statusCode, 200);
      assert.strictEqual(bankrVerified, true);

      const challenge = challengeRes.json();
      assert.ok(challenge.message.includes('X handle: @robot_owner (Bankr verified)'));

      const signature = await account.signMessage({ message: challenge.message });
      const confirmRes = await postTurtle(
        'confirm',
        { code: pairing.code, challengeId: challenge.challengeId, signature },
        undefined,
        true
      );
      assert.strictEqual(confirmRes.statusCode, 200);

      // Social profile must not be saved yet before accept
      const profileBefore = context.repos.wallets.getSocialProfile(account.address);
      assert.strictEqual(profileBefore, undefined);

      const acceptRes = await postTurtle('accept', { code: pairing.code }, phone);
      assert.strictEqual(acceptRes.statusCode, 200);

      const profileAfter = context.repos.wallets.getSocialProfile(account.address);
      assert.ok(profileAfter);
      assert.strictEqual(profileAfter.x_handle, 'robot_owner');
      assert.strictEqual(profileAfter.source, 'bankr-verified');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('bankr mismatch and outage never create verified handle', async () => {
    const phone = await registerPhone();
    const originalFetch = globalThis.fetch;

    try {
      const pairing = (await postTurtle('start', {}, phone)).json();

      // Mismatch
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ resolved: true, address: '0x0000000000000000000000000000000000000001' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as any;

      const mismatchRes = await postTurtle(
        'challenge',
        { code: pairing.code, address: account.address, xHandle: 'someone' },
        undefined,
        true
      );
      assert.strictEqual(mismatchRes.statusCode, 400);

      // Outage
      globalThis.fetch = (async () => {
        return new Response('Error', { status: 503 });
      }) as any;

      const outageRes = await postTurtle(
        'challenge',
        { code: pairing.code, address: account.address, xHandle: 'someone' },
        undefined,
        true
      );
      assert.strictEqual(outageRes.statusCode, 503);

      // Normal challenge without xHandle succeeds
      const normalRes = await postTurtle(
        'challenge',
        { code: pairing.code, address: account.address },
        undefined,
        true
      );
      assert.strictEqual(normalRes.statusCode, 200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('wallet code survives restart and explicit renewal invalidates it', async () => {
    const phone = await registerPhone();

    const original = (await postTurtle('start', {}, phone)).json();
    const second = (await postTurtle('start', {}, phone)).json();
    assert.deepStrictEqual(original, second);

    const renewed = (await postTurtle('start', { renew: true }, phone)).json();
    assert.notStrictEqual(original.code, renewed.code);

    const oldStatus = await postTurtle('status', { code: original.code }, phone);
    assert.strictEqual(oldStatus.statusCode, 400);
  });

  test('multiple wallets discovery and targeted disconnect', async () => {
    const phone = await registerPhone();
    const otherAccount = privateKeyToAccount(generatePrivateKey());

    for (const acc of [otherAccount, account]) {
      const pairing = (await postTurtle('start', {}, phone)).json();
      const challenge = (
        await postTurtle('challenge', { code: pairing.code, address: acc.address }, undefined, true)
      ).json();
      const signature = await acc.signMessage({ message: challenge.message });
      const confirmRes = await postTurtle(
        'confirm',
        { code: pairing.code, challengeId: challenge.challengeId, signature },
        undefined,
        true
      );
      assert.strictEqual(confirmRes.statusCode, 200);
      const acceptRes = await postTurtle('accept', { code: pairing.code }, phone);
      assert.strictEqual(acceptRes.statusCode, 200);
    }

    async function api(path: string, values: Record<string, unknown> = {}) {
      return app.inject({
        method: 'POST',
        url: `/api/${path}`,
        headers: { Origin: ORIGIN },
        payload: { token: phone.token, ...values },
      });
    }

    const statusRes = await api('wallet-link/status');
    const status = statusRes.json();
    assert.strictEqual(new Set(status.addresses.map((a: string) => a.toLowerCase())).size, 2);

    const featuredRes = await api('featured/hood-turtle', { tokenId: 7 });
    assert.strictEqual(featuredRes.statusCode, 200);
    const displayed = featuredRes.json();
    assert.strictEqual(displayed.active, true);
    assert.strictEqual(displayed.wallet.toLowerCase(), account.address.toLowerCase());

    // Disconnect primary account
    const disconnectRes = await api('wallet-link/disconnect', { address: account.address });
    assert.strictEqual(disconnectRes.statusCode, 200);
    const removed = disconnectRes.json();
    assert.strictEqual(removed.addresses.length, 1);
    assert.strictEqual(removed.linked, true);

    // Cached ownership for the removed address must not grant display
    const displayedAfter = (await api('featured/hood-turtle', { tokenId: 7 })).json();
    assert.strictEqual(displayedAfter.active, false);

    // Re-link via direct challenge/confirm
    const directChallenge = (await api('wallet-link/challenge', { address: account.address })).json();
    const directSig = await account.signMessage({ message: directChallenge.message });
    const directConfirm = (await api('wallet-link/confirm', { signature: directSig })).json();
    assert.strictEqual(new Set(directConfirm.addresses.map((a: string) => a.toLowerCase())).size, 2);
  });

  test('pairing requires signature ownership and phone acceptance', async () => {
    const phone = await registerPhone();
    const otherPhone = await registerPhone();

    const pairing = (await postTurtle('start', {}, phone)).json();
    const challenge = (
      await postTurtle('challenge', { code: pairing.code, address: account.address, tokenId: 7 }, undefined, true)
    ).json();

    // Accept before confirm fails
    const prematureAccept = await postTurtle('accept', { code: pairing.code }, phone);
    assert.strictEqual(prematureAccept.statusCode, 400);

    // Wrong signature fails
    const wrongSig = await account.signMessage({ message: 'wrong message' });
    const wrongConfirm = await postTurtle(
      'confirm',
      { code: pairing.code, challengeId: challenge.challengeId, signature: wrongSig },
      undefined,
      true
    );
    assert.strictEqual(wrongConfirm.statusCode, 400);

    // Correct signature succeeds
    const correctSig = await account.signMessage({ message: challenge.message });
    const confirmRes = await postTurtle(
      'confirm',
      { code: pairing.code, challengeId: challenge.challengeId, signature: correctSig },
      undefined,
      true
    );
    assert.strictEqual(confirmRes.statusCode, 200);
    assert.strictEqual(confirmRes.headers['cache-control'], 'no-store');

    // Confirm already used fails
    const reConfirm = await postTurtle(
      'confirm',
      { code: pairing.code, challengeId: challenge.challengeId, signature: correctSig },
      undefined,
      true
    );
    assert.strictEqual(reConfirm.statusCode, 400);

    // Other phone cannot check status or accept
    const otherStatus = await postTurtle('status', { code: pairing.code }, otherPhone);
    assert.strictEqual(otherStatus.statusCode, 400);
    const otherAccept = await postTurtle('accept', { code: pairing.code }, otherPhone);
    assert.strictEqual(otherAccept.statusCode, 400);

    // Not linked yet
    const linkStatus = await app.inject({
      method: 'POST',
      url: '/api/wallet-link/status',
      headers: { Origin: ORIGIN },
      payload: { token: phone.token },
    });
    assert.strictEqual(linkStatus.json().linked, false);

    // Phone accepts
    const acceptRes = await postTurtle('accept', { code: pairing.code }, phone);
    assert.strictEqual(acceptRes.statusCode, 200);
    assert.strictEqual(acceptRes.json().address.toLowerCase(), account.address.toLowerCase());

    // Repeat accept fails
    const reAccept = await postTurtle('accept', { code: pairing.code }, phone);
    assert.strictEqual(reAccept.statusCode, 400);
  });

  test('non-owner wallet confirm fails with does not currently own', async () => {
    const phone = await registerPhone();
    const otherWallet = privateKeyToAccount(generatePrivateKey());

    // RPC owner is set to someone else
    rpcState.owner = otherWallet.address;

    const pairing = (await postTurtle('start', {}, phone)).json();
    const challenge = (
      await postTurtle('challenge', { code: pairing.code, address: account.address, tokenId: 7 }, undefined, true)
    ).json();
    const signature = await account.signMessage({ message: challenge.message });

    const confirmRes = await postTurtle(
      'confirm',
      { code: pairing.code, challengeId: challenge.challengeId, signature },
      undefined,
      true
    );
    assert.strictEqual(confirmRes.statusCode, 400);
    assert.ok(confirmRes.json().error.includes('does not currently own that Hood Turtle'));
  });

  test('agent access does not open device endpoints or bad origins', async () => {
    // start without origin fails with 403
    const badStart = await postTurtle('start', {}, undefined, true);
    assert.strictEqual(badStart.statusCode, 403);

    // challenge with unauthorized origin fails with 403
    const badOrigin = await app.inject({
      method: 'POST',
      url: '/api/turtle-connect/challenge',
      headers: { Origin: 'https://evil.example' },
      payload: {},
    });
    assert.strictEqual(badOrigin.statusCode, 403);

    // invalid tokenId out of range fails with 400
    const phone = await registerPhone();
    const pairing = (await postTurtle('start', {}, phone)).json();

    for (const invalidTid of [true, 0, 2223]) {
      const res = await postTurtle(
        'challenge',
        { code: pairing.code, address: account.address, tokenId: invalidTid },
        undefined,
        true
      );
      assert.strictEqual(res.statusCode, 400);
    }
  });

  test('public preview does not grant display and disconnect revokes pending pairing', async () => {
    // Preview returns image without auth
    const previewRes = await app.inject({
      method: 'GET',
      url: '/api/hood-turtles/preview?tokenId=7',
    });
    assert.strictEqual(previewRes.statusCode, 200);
    const preview = previewRes.json();
    assert.ok(preview.image);
    assert.strictEqual(preview.active, undefined);
    assert.strictEqual(preview.wallet, undefined);

    const phone = await registerPhone();

    // Featured requires linked wallet
    const featuredBefore = await app.inject({
      method: 'POST',
      url: '/api/featured/hood-turtle',
      headers: { Origin: ORIGIN },
      payload: { token: phone.token, tokenId: 7 },
    });
    assert.strictEqual(featuredBefore.statusCode, 403);

    // Start & confirm pairing
    const pairing = (await postTurtle('start', {}, phone)).json();
    const challenge = (
      await postTurtle('challenge', { code: pairing.code, address: account.address, tokenId: 7 }, undefined, true)
    ).json();
    const signature = await account.signMessage({ message: challenge.message });
    await postTurtle(
      'confirm',
      { code: pairing.code, challengeId: challenge.challengeId, signature },
      undefined,
      true
    );

    // Disconnect removes pending pairings for device
    const disconnectRes = await app.inject({
      method: 'POST',
      url: '/api/wallet-link/disconnect',
      headers: { Origin: ORIGIN },
      payload: { token: phone.token },
    });
    assert.strictEqual(disconnectRes.statusCode, 200);

    // Accept now fails
    const acceptRes = await postTurtle('accept', { code: pairing.code }, phone);
    assert.strictEqual(acceptRes.statusCode, 400);
  });

  test('link from existing device requires link and target acceptance', async () => {
    const phone = await registerPhone();
    const otherPhone = await registerPhone();

    // Link wallet on primary device
    const pairing = (await postTurtle('start', {}, phone)).json();
    const challenge = (
      await postTurtle('challenge', { code: pairing.code, address: account.address, tokenId: 7 }, undefined, true)
    ).json();
    const signature = await account.signMessage({ message: challenge.message });
    await postTurtle(
      'confirm',
      { code: pairing.code, challengeId: challenge.challengeId, signature },
      undefined,
      true
    );
    await postTurtle('accept', { code: pairing.code }, phone);

    // Target device starts pairing
    const target = (await postTurtle('start', {}, otherPhone)).json();
    const req = { code: target.code, address: account.address };

    // Approving from unlinked device fails
    const badFrom = await postTurtle('from-device', req, otherPhone);
    assert.strictEqual(badFrom.statusCode, 400);

    // Approving from linked device succeeds
    const goodFrom = await postTurtle('from-device', req, phone);
    assert.strictEqual(goodFrom.statusCode, 200);

    // Re-approving fails
    const reFrom = await postTurtle('from-device', req, phone);
    assert.strictEqual(reFrom.statusCode, 400);

    // Target device is not linked until accept
    const targetStatus = await app.inject({
      method: 'POST',
      url: '/api/wallet-link/status',
      headers: { Origin: ORIGIN },
      payload: { token: otherPhone.token },
    });
    assert.strictEqual(targetStatus.json().linked, false);

    // Target device accepts
    const acceptRes = await postTurtle('accept', { code: target.code }, otherPhone);
    assert.strictEqual(acceptRes.statusCode, 200);
    assert.strictEqual(acceptRes.json().address.toLowerCase(), account.address.toLowerCase());
  });

  test('partial scan reports missing collections in wallet-link/nfts', async () => {
    const phone = await registerPhone();

    // Link wallet
    const pairing = (await postTurtle('start', {}, phone)).json();
    const challenge = (
      await postTurtle('challenge', { code: pairing.code, address: account.address }, undefined, true)
    ).json();
    const signature = await account.signMessage({ message: challenge.message });
    await postTurtle(
      'confirm',
      { code: pairing.code, challengeId: challenge.challengeId, signature },
      undefined,
      true
    );
    await postTurtle('accept', { code: pairing.code }, phone);

    // Mock robot verifier to throw
    const originalRobots = context.robotsVerifier;
    context.robotsVerifier = {
      discover: async () => {
        throw new Error('archive denied');
      },
      read: async () => ({ active: false }),
      ownerOf: async () => false,
    };

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/wallet-link/nfts',
        headers: { Origin: ORIGIN },
        payload: { token: phone.token },
      });
      assert.strictEqual(res.statusCode, 200);
      const data = res.json();
      assert.strictEqual(data.partial, true);
      assert.ok(data.errors.some((e: string) => e.includes('Robots v1 discovery unavailable')));
    } finally {
      context.robotsVerifier = originalRobots;
    }
  });

  test('daily cache transfer unlink and rpc failure', async () => {
    const phone = await registerPhone();

    // Link wallet
    const pairing = (await postTurtle('start', {}, phone)).json();
    const challenge = (
      await postTurtle('challenge', { code: pairing.code, address: account.address, tokenId: 7 }, undefined, true)
    ).json();
    const signature = await account.signMessage({ message: challenge.message });
    await postTurtle(
      'confirm',
      { code: pairing.code, challengeId: challenge.challengeId, signature },
      undefined,
      true
    );
    await postTurtle('accept', { code: pairing.code }, phone);

    async function featured() {
      return app.inject({
        method: 'POST',
        url: '/api/featured/hood-turtle',
        headers: { Origin: ORIGIN },
        payload: { token: phone.token, tokenId: 7 },
      });
    }

    const first = await featured();
    assert.strictEqual(first.statusCode, 200);
    const initial = first.json();
    const calls = rpcState.calls;

    // Second call reads from cache; no additional RPC calls
    const second = await featured();
    assert.strictEqual(second.statusCode, 200);
    assert.strictEqual(rpcState.calls, calls);

    // Fast-forward time past validUntil and trigger RPC failure
    const originalNow = context.now;
    context.now = () => initial.validUntil + 1;
    rpcState.unavailable = true;

    try {
      const failRes = await featured();
      assert.strictEqual(failRes.statusCode, 503);
    } finally {
      context.now = originalNow;
      rpcState.unavailable = false;
    }

    // Disconnect revokes access
    await app.inject({
      method: 'POST',
      url: '/api/wallet-link/disconnect',
      headers: { Origin: ORIGIN },
      payload: { token: phone.token },
    });
    const afterDisconnect = await featured();
    assert.strictEqual(afterDisconnect.statusCode, 403);
  });

  test('rpc discovery uses bounded logs and rejects missing ranges', async () => {
    let fail = false;
    const seen: any[] = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
      });
      req.on('end', () => {
        const parsed = JSON.parse(body);
        if (parsed.method === 'eth_call') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result: '0x' + (1).toString(16).padStart(64, '0') }));
          return;
        }
        if (parsed.method === 'eth_blockNumber') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result: '0x' + (10_000_005).toString(16) }));
          return;
        }
        seen.push(parsed.params[0]);
        if (fail) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: -32000 } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            result: [
              {
                address: HOOD_TURTLE_COLLECTION,
                topics: [
                  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                  '0x' + '0'.repeat(64),
                  '0x' + account.address.slice(2).toLowerCase().padStart(64, '0'),
                  '0x' + (7).toString(16).padStart(64, '0'),
                ],
              },
            ],
          })
        );
      });
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const sAddr = server.address() as any;
    const sUrl = `http://127.0.0.1:${sAddr.port}`;

    try {
      const { candidates, partial } = await rpcCandidates(account.address, sUrl);
      assert.deepStrictEqual(Array.from(candidates), [7]);
      assert.strictEqual(partial, false);
      assert.strictEqual(seen.length, 2);
      assert.strictEqual(seen[1].fromBlock, '0x' + (10_000_000).toString(16));

      fail = true;
      await assert.rejects(async () => {
        await rpcCandidates(account.address, sUrl);
      }, /unavailable/);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  test('empty indexer checks rpc and verifies owner', async () => {
    const indexerServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items: [] }));
    });
    await new Promise<void>(resolve => indexerServer.listen(0, '127.0.0.1', resolve));
    const iAddr = indexerServer.address() as any;
    const iUrl = `http://127.0.0.1:${iAddr.port}`;

    const testDb = createDbConnection(':memory:');
    const ownership = new TurtleOwnership(testDb, rpcUrl);

    try {
      const result = await discoverWallets([account.address], ownership, rpcUrl, iUrl);
      assert.deepStrictEqual(
        result.nfts.map(n => n.tokenId),
        [7]
      );
    } finally {
      testDb.close();
      await new Promise(resolve => indexerServer.close(resolve));
    }
  });

  test('indexer failure falls back to rpc and verifies owner', async () => {
    const indexerServer = http.createServer((req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'broken indexer' }));
    });
    await new Promise<void>(resolve => indexerServer.listen(0, '127.0.0.1', resolve));
    const iAddr = indexerServer.address() as any;
    const iUrl = `http://127.0.0.1:${iAddr.port}`;

    const testDb = createDbConnection(':memory:');
    const ownership = new TurtleOwnership(testDb, rpcUrl);

    try {
      let result = await discoverWallets([account.address], ownership, rpcUrl, iUrl);
      assert.strictEqual(result.nfts[0].tokenId, 7);
      assert.strictEqual(result.nfts[0].wallet.toLowerCase(), account.address.toLowerCase());
      assert.strictEqual(result.partial, false);

      // Burned NFT
      rpcState.burned = true;
      result = await discoverWallets([account.address], ownership, rpcUrl, iUrl);
      assert.deepStrictEqual(result.nfts, []);
      rpcState.burned = false;

      // RPC unavailable
      rpcState.unavailable = true;
      await assert.rejects(async () => {
        await discoverWallets([account.address], ownership, rpcUrl, iUrl);
      }, /temporarily unavailable/);
      rpcState.unavailable = false;
    } finally {
      testDb.close();
      await new Promise(resolve => indexerServer.close(resolve));
    }
  });
});
