import assert from 'node:assert';
import { after, before, describe, test } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import { createAppContext } from '../../src/context.js';
import { Config, loadConfig } from '../../src/config.js';
import { mintPet } from '../../src/domain/account.js';
import { startCommunityLink } from '../../src/domain/device-sync.js';

describe('Account & Device Sync Parity (Phase 6 Slice 6A)', () => {
  let app: FastifyInstance;
  let sharedContext: ReturnType<typeof createAppContext>;
  let testConfig: Config;
  let currentTime = 1000;
  const originalFetch = globalThis.fetch;

  before(async () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);

    testConfig = loadConfig({
      PET_DOMAIN: 'tinyfrens.lol',
      ORIGIN: 'https://tinyfrens.lol',
      ALLOWED_ORIGINS: 'https://tinyfrens.lol,https://www.tinyfrens.lol',
      SQLITE_PATH: ':memory:',
      TELEGRAM_BOT_TOKEN: '123456:TEST_BOT_TOKEN',
      TELEGRAM_WEBHOOK_SECRET: 'test-tg-secret',
    });

    sharedContext = createAppContext(testConfig, db, {
      now: () => currentTime,
    });

    app = await buildApp({ context: sharedContext });
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
  });

  describe('POST /api/register', () => {
    test('successfully registers a valid pet profile and returns id, token, and pairing code', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/register',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: {
          pet: {
            name: 'Beep',
            shape: 'robot',
            color: '#a474f1',
          },
        },
      });

      assert.strictEqual(response.statusCode, 200);
      const data = response.json();
      assert.ok(data.id && typeof data.id === 'string' && data.id.length === 32);
      assert.ok(data.token && typeof data.token === 'string' && data.token.length > 30);
      assert.ok(data.code && typeof data.code === 'string' && data.code.length === 8);

      const petRow = sharedContext.repos.pets.findById(data.id);
      assert.ok(petRow);
      assert.strictEqual(petRow.code, data.code);
      const parsedProfile = JSON.parse(petRow.profile);
      assert.strictEqual(parsedProfile.name, 'Beep');
      assert.strictEqual(parsedProfile.shape, 'robot');
      assert.strictEqual(parsedProfile.color, '#a474f1');
    });

    test('rejects missing pet in payload with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/register',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: {},
      });
      assert.strictEqual(response.statusCode, 400);
    });

    test('rejects invalid pet shape or color with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/register',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: {
          pet: {
            name: 'A',
            shape: 'unsafe',
            color: 'no',
          },
        },
      });
      assert.strictEqual(response.statusCode, 400);
      const data = response.json();
      assert.strictEqual(data.error, 'Invalid pet');
    });

    test('rejects unauthorized origin with 403', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/register',
        headers: { origin: 'https://bad.example' },
        payload: {
          pet: {
            name: 'A',
            shape: 'robot',
            color: '#123456',
          },
        },
      });
      assert.strictEqual(response.statusCode, 403);
    });

    test('enforces sliding window rate limit of 10 registrations per IP per hour', async () => {
      sharedContext.rateLimiter.clear();
      const payload = { pet: { name: 'Fren', shape: 'blob', color: '#112233' } };

      for (let i = 0; i < 10; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/register',
          headers: { origin: 'https://tinyfrens.lol' },
          payload,
        });
        assert.strictEqual(res.statusCode, 200);
      }

      const blockedRes = await app.inject({
        method: 'POST',
        url: '/api/register',
        headers: { origin: 'https://tinyfrens.lol' },
        payload,
      });
      assert.strictEqual(blockedRes.statusCode, 400);
      assert.strictEqual(blockedRes.json().error, 'Please wait before trying again');

      // Advancing time past the 3600-second window permits registration again
      currentTime += 3601;
      const allowedRes = await app.inject({
        method: 'POST',
        url: '/api/register',
        headers: { origin: 'https://tinyfrens.lol' },
        payload,
      });
      assert.strictEqual(allowedRes.statusCode, 200);
    });
  });

  describe('POST /api/account/profile', () => {
    test('rejects unrecognized device credential with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/account/profile',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: 'nonexistent-token' },
      });
      assert.strictEqual(response.statusCode, 400);
      assert.strictEqual(response.json().error, 'Device credential not recognized');
    });

    test('rejects manual editing of xHandle with 400', async () => {
      const regRes = await app.inject({
        method: 'POST',
        url: '/api/register',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { pet: { name: 'Tess', shape: 'robot', color: '#a474f1' } },
      });
      const pet = regRes.json();

      const response = await app.inject({
        method: 'POST',
        url: '/api/account/profile',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: {
          token: pet.token,
          displayName: 'Spoof',
          xHandle: '@someone_else',
        },
      });

      assert.strictEqual(response.statusCode, 400);
      assert.strictEqual(
        response.json().error,
        'X handles require verified X ownership and cannot be edited manually'
      );
    });

    test('returns empty profile defaults for newly registered device', async () => {
      const regRes = await app.inject({
        method: 'POST',
        url: '/api/register',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { pet: { name: 'Fresh', shape: 'robot', color: '#a474f1' } },
      });
      const pet = regRes.json();

      const response = await app.inject({
        method: 'POST',
        url: '/api/account/profile',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: pet.token },
      });

      assert.strictEqual(response.statusCode, 200);
      const profile = response.json();
      assert.strictEqual(profile.displayName, '');
      assert.strictEqual(profile.xHandle, '');
      assert.strictEqual(profile.xHandleSource, null);
      assert.deepStrictEqual(profile.identities, []);
    });

    test('updates displayName and validates length', async () => {
      const regRes = await app.inject({
        method: 'POST',
        url: '/api/register',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { pet: { name: 'Namer', shape: 'robot', color: '#a474f1' } },
      });
      const pet = regRes.json();

      // Update valid display name
      const updateRes = await app.inject({
        method: 'POST',
        url: '/api/account/profile',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: pet.token, displayName: 'Captain Fren' },
      });
      assert.strictEqual(updateRes.statusCode, 200);
      assert.strictEqual(updateRes.json().displayName, 'Captain Fren');

      // Subsequent read preserves displayName
      const readRes = await app.inject({
        method: 'POST',
        url: '/api/account/profile',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: pet.token },
      });
      assert.strictEqual(readRes.statusCode, 200);
      assert.strictEqual(readRes.json().displayName, 'Captain Fren');

      // Too long display name is rejected
      const invalidRes = await app.inject({
        method: 'POST',
        url: '/api/account/profile',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: pet.token, displayName: 'A'.repeat(33) },
      });
      assert.strictEqual(invalidRes.statusCode, 400);
      assert.strictEqual(invalidRes.json().error, 'Display name must be 1 to 32 characters');
    });

    test('resolves bankr-verified social profile and verified-identity precedence', async () => {
      const regRes = await app.inject({
        method: 'POST',
        url: '/api/register',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { pet: { name: 'PrecedencePet', shape: 'robot', color: '#a474f1' } },
      });
      const pet = regRes.json();
      const account = sharedContext.repos.deviceSync.ensureAccount(pet.id);

      // Link wallet to pet with bankr-verified profile
      const walletAddress = '0x1234567890123456789012345678901234567890';
      sharedContext.repos.wallets.linkAccountWallet(
        account,
        walletAddress,
        'bankr_verified',
        currentTime,
        'bankr'
      );
      sharedContext.repos.wallets.upsertSocialProfile(
        walletAddress,
        'bankr_handle',
        'bankr-verified',
        currentTime
      );

      const bankrProfileRes = await app.inject({
        method: 'POST',
        url: '/api/account/profile',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: pet.token },
      });
      assert.strictEqual(bankrProfileRes.statusCode, 200);
      assert.strictEqual(bankrProfileRes.json().xHandle, 'bankr_handle');
      assert.strictEqual(bankrProfileRes.json().xHandleSource, 'bankr');

      // Verified X identity in account_identities takes precedence over bankr-verified wallet
      sharedContext.repos.accounts.upsertIdentity(
        account,
        'x',
        'x-subject-99',
        'verified_x_handle',
        'Verified User',
        true,
        currentTime
      );

      const verifiedProfileRes = await app.inject({
        method: 'POST',
        url: '/api/account/profile',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: pet.token },
      });
      assert.strictEqual(verifiedProfileRes.statusCode, 200);
      assert.strictEqual(verifiedProfileRes.json().xHandle, 'verified_x_handle');
      assert.strictEqual(verifiedProfileRes.json().xHandleSource, 'verified-identity');
    });
  });

  describe('Device Sync Protocol (POST /api/device-sync/*)', () => {
    let petA: { id: string; token: string; code: string };
    let petB: { id: string; token: string; code: string };
    let petC: { id: string; token: string; code: string };

    const validCompanion = {
      chainId: 8453,
      originalAddress: '0x8d446c126d4873bfa3eb195b7f0094acc1187a75',
      tokenId: 50,
      motion: { mode: 'bubble', speed: 45, size: 97 },
    };

    before(async () => {
      const regA = await app.inject({
        method: 'POST',
        url: '/api/register',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { pet: { name: 'DeviceA', shape: 'robot', color: '#a474f1' } },
      });
      petA = regA.json();

      const regB = await app.inject({
        method: 'POST',
        url: '/api/register',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { pet: { name: 'DeviceB', shape: 'robot', color: '#33bb88' } },
      });
      petB = regB.json();

      const regC = await app.inject({
        method: 'POST',
        url: '/api/register',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { pet: { name: 'DeviceC', shape: 'robot', color: '#ee6622' } },
      });
      petC = regC.json();
    });

    test('state endpoint returns initial snapshot with revision 0 and empty companion list', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/device-sync/state',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petA.token },
      });
      assert.strictEqual(res.statusCode, 200);
      const data = res.json();
      assert.strictEqual(data.revision, 0);
      assert.deepStrictEqual(data.selection, []);
      assert.deepStrictEqual(data.telegramSelection, []);
      assert.strictEqual(data.devices, 1);
      assert.deepStrictEqual(data.addresses, []);
    });

    test('start generates 12-character sync code with 10-minute expiry and reuses active code', async () => {
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/device-sync/start',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petA.token },
      });
      assert.strictEqual(res1.statusCode, 200);
      const code1 = res1.json();
      assert.strictEqual(code1.code.length, 12);
      assert.strictEqual(code1.expires, currentTime + 600);

      // Re-invoking start without renew returns identical active code
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/device-sync/start',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petA.token },
      });
      assert.strictEqual(res2.statusCode, 200);
      assert.deepStrictEqual(res2.json(), code1);

      // Re-invoking start with renew: true yields a new code
      const resRenew = await app.inject({
        method: 'POST',
        url: '/api/device-sync/start',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petA.token, renew: true },
      });
      assert.strictEqual(resRenew.statusCode, 200);
      const codeRenew = resRenew.json();
      assert.notStrictEqual(codeRenew.code, code1.code);
    });

    test('request creates pending request on active sync code and enforces single request limit', async () => {
      const startRes = await app.inject({
        method: 'POST',
        url: '/api/device-sync/start',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petA.token, renew: true },
      });
      const { code } = startRes.json();

      // Device B requests sync
      const reqRes = await app.inject({
        method: 'POST',
        url: '/api/device-sync/request',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petB.token, code, label: 'iPad Air' },
      });
      assert.strictEqual(reqRes.statusCode, 200);
      const reqData = reqRes.json();
      assert.strictEqual(reqData.waiting, true);
      assert.ok(reqData.requestId);

      // Duplicate request on same code from another device fails
      const dupRes = await app.inject({
        method: 'POST',
        url: '/api/device-sync/request',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petC.token, code, label: 'iPhone' },
      });
      assert.strictEqual(dupRes.statusCode, 400);
      assert.strictEqual(dupRes.json().error, 'This code already has a request. Create a new code.');
    });

    test('request rejects expired or invalid code with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/device-sync/request',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petB.token, code: 'NONEXISTENT1' },
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json().error, 'Code expired or not found. Create a new code.');
    });

    test('status reports pending status to code owner and requester but rejects third party', async () => {
      const startRes = await app.inject({
        method: 'POST',
        url: '/api/device-sync/start',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petA.token, renew: true },
      });
      const { code } = startRes.json();

      const reqRes = await app.inject({
        method: 'POST',
        url: '/api/device-sync/request',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petB.token, code, label: 'Desktop Chrome' },
      });
      const { requestId } = reqRes.json();

      // Status seen by Device A (owner)
      const statusOwner = await app.inject({
        method: 'POST',
        url: '/api/device-sync/status',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petA.token, code },
      });
      assert.strictEqual(statusOwner.statusCode, 200);
      assert.deepStrictEqual(statusOwner.json(), {
        pending: true,
        requestId,
        label: 'Desktop Chrome',
        expires: currentTime + 600,
      });

      // Status seen by Device B (requester)
      const statusReq = await app.inject({
        method: 'POST',
        url: '/api/device-sync/status',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petB.token, code },
      });
      assert.strictEqual(statusReq.statusCode, 200);
      assert.strictEqual(statusReq.json().requestId, requestId);

      // Third party Device C is rejected
      const statusOther = await app.inject({
        method: 'POST',
        url: '/api/device-sync/status',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petC.token, code },
      });
      assert.strictEqual(statusOther.statusCode, 400);
      assert.strictEqual(statusOther.json().error, 'This request belongs to another device');
    });

    test('accept approves pairing, merges accounts and wallets, and consumes sync code', async () => {
      // Give each device a wallet link with distinct timestamps
      sharedContext.repos.wallets.linkAccountWallet(
        sharedContext.repos.deviceSync.ensureAccount(petA.id),
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'personal_sign',
        100
      );
      sharedContext.repos.wallets.linkAccountWallet(
        sharedContext.repos.deviceSync.ensureAccount(petB.id),
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'personal_sign',
        200
      );

      // Set companion selection on Device A
      await app.inject({
        method: 'POST',
        url: '/api/device-sync/state',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: {
          token: petA.token,
          revision: 0,
          selection: [validCompanion],
          telegramSelection: [{
            chainId: validCompanion.chainId,
            originalAddress: validCompanion.originalAddress,
            tokenId: validCompanion.tokenId,
            slot: 2,
          }],
        },
      });

      const startRes = await app.inject({
        method: 'POST',
        url: '/api/device-sync/start',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petA.token, renew: true },
      });
      const { code } = startRes.json();

      const reqRes = await app.inject({
        method: 'POST',
        url: '/api/device-sync/request',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petB.token, code, label: 'MacBook' },
      });
      const { requestId } = reqRes.json();

      // Reject invalid requestId
      const badReqRes = await app.inject({
        method: 'POST',
        url: '/api/device-sync/accept',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petA.token, code, requestId: 'invalid-id' },
      });
      assert.strictEqual(badReqRes.statusCode, 400);

      // Reject accept attempted by requester device B
      const nonOwnerRes = await app.inject({
        method: 'POST',
        url: '/api/device-sync/accept',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petB.token, code, requestId },
      });
      assert.strictEqual(nonOwnerRes.statusCode, 400);

      // Owner A accepts pairing
      const acceptRes = await app.inject({
        method: 'POST',
        url: '/api/device-sync/accept',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petA.token, code, requestId },
      });
      assert.strictEqual(acceptRes.statusCode, 200);
      const snapshotA = acceptRes.json();
      assert.strictEqual(snapshotA.devices, 2);
      assert.strictEqual(snapshotA.selection.length, 1);
      assert.deepStrictEqual(snapshotA.telegramSelection.map((item: { slot: number }) => item.slot), [2]);
      assert.strictEqual(snapshotA.addresses.length, 2);

      // Device B state now matches Device A exactly
      const stateB = await app.inject({
        method: 'POST',
        url: '/api/device-sync/state',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petB.token },
      });
      assert.strictEqual(stateB.statusCode, 200);
      assert.deepStrictEqual(stateB.json(), snapshotA);

      // Both devices share the same account ID
      assert.strictEqual(
        sharedContext.repos.deviceSync.getAccountForDevice(petA.id),
        sharedContext.repos.deviceSync.getAccountForDevice(petB.id)
      );

      // Code is consumed; repeated accept fails
      const reusedRes = await app.inject({
        method: 'POST',
        url: '/api/device-sync/accept',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petA.token, code, requestId },
      });
      assert.strictEqual(reusedRes.statusCode, 400);

      // Both devices have identical ordered wallet links
      const linksA = sharedContext.repos.wallets.getLinkedWallets(petA.id);
      const linksB = sharedContext.repos.wallets.getLinkedWallets(petB.id);
      assert.deepStrictEqual(linksA, linksB);
    });

    test('detects revision conflict on companion selection and returns 409', async () => {
      const stateRes = await app.inject({
        method: 'POST',
        url: '/api/device-sync/state',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petA.token },
      });
      const current = stateRes.json();

      // Submit with stale revision (e.g. revision - 1)
      const conflictRes = await app.inject({
        method: 'POST',
        url: '/api/device-sync/state',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: {
          token: petA.token,
          revision: current.revision - 1,
          selection: [],
        },
      });
      assert.strictEqual(conflictRes.statusCode, 409);
      const conflictData = conflictRes.json();
      assert.strictEqual(
        conflictData.error,
        'Another device changed your selection. Refreshing.'
      );
      assert.strictEqual(conflictData.revision, current.revision);
    });

    test('leave unlinks a device into a solo account while keeping selection', async () => {
      // Device B leaves the synced group
      const leaveRes = await app.inject({
        method: 'POST',
        url: '/api/device-sync/leave',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petB.token },
      });
      assert.strictEqual(leaveRes.statusCode, 200);
      const soloB = leaveRes.json();
      assert.strictEqual(soloB.devices, 1);
      assert.strictEqual(soloB.revision, 1);
      assert.strictEqual(soloB.selection.length, 1);
      assert.deepStrictEqual(soloB.telegramSelection.map((item: { slot: number }) => item.slot), [2]);

      // Device A is now solo as well
      const stateA = await app.inject({
        method: 'POST',
        url: '/api/device-sync/state',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petA.token },
      });
      assert.strictEqual(stateA.json().devices, 1);
      assert.notStrictEqual(stateA.json().account, soloB.account);
    });

    test('Telegram /link command requests sync through webhook', async () => {
      let sentMessage: Record<string, unknown> | null = null;
      globalThis.fetch = async (_url: unknown, options: unknown) => {
        const bodyStr = (options as { body?: string }).body;
        sentMessage = bodyStr ? JSON.parse(bodyStr) : null;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      };

      const startRes = await app.inject({
        method: 'POST',
        url: '/api/device-sync/start',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petA.token, renew: true },
      });
      const { code } = startRes.json();

      const webhookUpdate = {
        message: {
          text: `/link ${code}`,
          chat: { id: 777, type: 'private' },
          from: { id: 999, first_name: 'Linker', username: 'tele_linker' },
        },
      };

      const webhookRes = await app.inject({
        method: 'POST',
        url: '/api/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': 'test-tg-secret' },
        payload: webhookUpdate,
      });
      assert.strictEqual(webhookRes.statusCode, 200);
      assert.ok(sentMessage);
      assert.strictEqual((sentMessage as Record<string, unknown>).chat_id, 777);

      // Verify the sync code now has a pending request from Telegram
      const statusRes = await app.inject({
        method: 'POST',
        url: '/api/device-sync/status',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petA.token, code },
      });
      assert.strictEqual(statusRes.statusCode, 200);
      assert.strictEqual(statusRes.json().label, 'Telegram @tele_linker');
      assert.strictEqual(statusRes.json().pending, true);

      const bridgePetId = sharedContext.repos.telegram.getPetIdForTgUser('999');
      assert.ok(bridgePetId);
      const acceptRes = await app.inject({
        method: 'POST',
        url: '/api/device-sync/accept',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: petA.token, code, requestId: statusRes.json().requestId },
      });
      assert.strictEqual(acceptRes.statusCode, 200);
      assert.strictEqual(acceptRes.json().devices, 2);
      assert.strictEqual(sharedContext.repos.telegram.getPetIdForTgUser('999'), bridgePetId);
      assert.strictEqual(
        sharedContext.repos.deviceSync.getAccountForDevice(bridgePetId),
        sharedContext.repos.deviceSync.getAccountForDevice(petA.id)
      );
    });

    test('Telegram /link without a code creates a private one-tap request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': 'test-tg-secret' },
        payload: {
          message: {
            text: '/link',
            chat: { id: 778, type: 'private' },
            from: { id: 1000, first_name: 'Goober', username: 'goober' },
          },
        },
      });
      assert.strictEqual(response.statusCode, 200);
      const bridgePetId = sharedContext.repos.telegram.getPetIdForTgUser('1000');
      assert.ok(bridgePetId);
      const request = sharedContext.db.prepare<{ platform: string; label: string; expires: number }>(
        'SELECT platform, label, expires FROM community_link_requests WHERE device=?'
      ).get(bridgePetId);
      assert.deepStrictEqual(request, {
        platform: 'telegram',
        label: 'Telegram @goober',
        expires: currentTime + 600,
      });
    });

    test('one-tap community link confirms on an established device and consumes the request', async () => {
      const existing = mintPet(sharedContext.db, { name: 'Existing device' });
      const bridge = mintPet(sharedContext.db, { name: 'Discord bridge' });
      const account = sharedContext.repos.deviceSync.ensureAccount(existing.id);
      sharedContext.repos.wallets.linkAccountWallet(
        account,
        '0x1234500000000000000000000000000000000000',
        'personal_sign',
        currentTime
      );
      const link = startCommunityLink(sharedContext, bridge.id, 'discord', 'Discord @goober');

      const status = await app.inject({
        method: 'POST',
        url: '/api/device-sync/community-link/status',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: existing.token, linkToken: link.token },
      });
      assert.strictEqual(status.statusCode, 200);
      assert.strictEqual(status.json().label, 'Discord @goober');
      assert.strictEqual(status.json().alreadyLinked, false);

      const accepted = await app.inject({
        method: 'POST',
        url: '/api/device-sync/community-link/accept',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: existing.token, linkToken: link.token },
      });
      assert.strictEqual(accepted.statusCode, 200);
      assert.strictEqual(accepted.json().devices, 2);
      assert.strictEqual(
        sharedContext.repos.deviceSync.getAccountForDevice(existing.id),
        sharedContext.repos.deviceSync.getAccountForDevice(bridge.id)
      );

      const replay = await app.inject({
        method: 'POST',
        url: '/api/device-sync/community-link/accept',
        headers: { origin: 'https://tinyfrens.lol' },
        payload: { token: existing.token, linkToken: link.token },
      });
      assert.strictEqual(replay.statusCode, 400);
      assert.match(replay.json().error, /invalid or expired/);
    });
  });
});
