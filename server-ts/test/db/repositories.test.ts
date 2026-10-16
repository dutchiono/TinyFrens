import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDbConnection, DatabaseConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import { createRepositories, Repositories } from '../../src/db/repositories/index.js';

describe('Database: Repositories', () => {
  let db: DatabaseConnection;
  let repos: Repositories;

  beforeEach(() => {
    db = createDbConnection(':memory:');
    runMigrations(db);
    repos = createRepositories(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('PetRepository', () => {
    test('creates and retrieves pets by id, code, and token', () => {
      repos.pets.createPet('pid-1', 'CODE123', 'tok-abc', '{"name":"Frenny"}');

      const byId = repos.pets.findById('pid-1');
      assert.ok(byId);
      assert.strictEqual(byId.id, 'pid-1');
      assert.strictEqual(byId.code, 'CODE123');

      const byCode = repos.pets.findByCode('CODE123');
      assert.strictEqual(byCode?.id, 'pid-1');

      const byToken = repos.pets.findByToken('tok-abc');
      assert.strictEqual(byToken?.id, 'pid-1');

      repos.pets.updateProfile('pid-1', '{"name":"UpdatedFrenny"}');
      const updated = repos.pets.findById('pid-1');
      assert.strictEqual(updated?.profile, '{"name":"UpdatedFrenny"}');
    });

    test('maintains symmetrical friendships and removes mutual requests upon accepting', () => {
      repos.pets.createRequest('pid-1', 'pid-2');
      assert.deepStrictEqual(repos.pets.getIncomingRequests('pid-2'), ['pid-1']);
      assert.deepStrictEqual(repos.pets.getOutgoingRequests('pid-1'), ['pid-2']);

      repos.pets.addFriendship('pid-1', 'pid-2');
      assert.ok(repos.pets.areFriends('pid-1', 'pid-2'));
      assert.ok(repos.pets.areFriends('pid-2', 'pid-1'));
      assert.deepStrictEqual(repos.pets.getFriends('pid-1'), ['pid-2']);
      assert.deepStrictEqual(repos.pets.getIncomingRequests('pid-2'), []);

      repos.pets.removeFriendship('pid-1', 'pid-2');
      assert.strictEqual(repos.pets.areFriends('pid-1', 'pid-2'), false);
    });

    test('manages magic links and push subscriptions', () => {
      repos.pets.createMagicLink('ml-1', 'pid-1', 1000, 2000);
      assert.strictEqual(repos.pets.getMagicLink('ml-1')?.pet_id, 'pid-1');

      repos.pets.deleteExpiredMagicLinks(2500);
      assert.strictEqual(repos.pets.getMagicLink('ml-1'), undefined);

      repos.pets.upsertPushSubscription('https://push.example/1', 'p256', 'auth', 'pid-1', 100);
      const subs = repos.pets.getPushSubscriptionsForPet('pid-1');
      assert.strictEqual(subs.length, 1);
      assert.strictEqual(subs[0].endpoint, 'https://push.example/1');
    });
  });

  describe('AccountRepository', () => {
    test('upserts profile and identities, and merges accounts cleanly', () => {
      repos.accounts.upsertProfile('acc-source', 'Source Display', '@source', 100);
      repos.accounts.upsertProfile('acc-target', 'Target Display', '', 100);
      repos.accounts.upsertIdentity('acc-target', 'telegram', '12345', 'tguser', 'TG Name', true, 100);

      repos.accounts.mergeAccounts('acc-source', 'acc-target', 200);

      const targetProfile = repos.accounts.getProfile('acc-target');
      assert.strictEqual(targetProfile, undefined);

      const sourceProfile = repos.accounts.getProfile('acc-source');
      assert.strictEqual(sourceProfile?.display_name, 'Source Display');

      const identities = repos.accounts.getIdentities('acc-source');
      assert.strictEqual(identities.length, 1);
      assert.strictEqual(identities[0].subject, '12345');
    });

    test('merges purchased Energy without multiplying rechargeable Energy', () => {
      db.prepare(
        `INSERT INTO player_energy VALUES
         (?, ?, ?, ?, 0, ?, ?, 1, ?),
         (?, ?, ?, ?, 0, ?, ?, 1, ?)`
      ).run(
        'acc-source', 10_000, 2_000, 100, 24_000, 72_000, 100,
        'acc-target', 15_000, 3_000, 100, 24_000, 72_000, 100
      );

      repos.accounts.mergeAccounts('acc-source', 'acc-target', 200);

      const merged = repos.energy.get('acc-source');
      assert.equal(merged?.rechargeable_milli, 15_000);
      assert.equal(merged?.purchased_milli, 5_000);
      assert.equal(repos.energy.get('acc-target'), undefined);
      const mergeEntry = repos.energy.history('acc-source')[0];
      assert.equal(mergeEntry.reason, 'account_merge');
      assert.equal(mergeEntry.rechargeable_delta_milli, 5_000);
      assert.equal(mergeEntry.purchased_delta_milli, 3_000);
    });
  });

  describe('WalletRepository', () => {
    test('links, unlinks, and resolves multiple wallets per device', () => {
      const w1 = '0x1111111111111111111111111111111111111111';
      const w2 = '0x2222222222222222222222222222222222222222';

      repos.wallets.linkWallet('dev-1', w1, 100);
      repos.wallets.linkWallet('dev-1', w2, 200);

      const wallets = repos.wallets.getLinkedWallets('dev-1');
      assert.deepStrictEqual(wallets, [w1, w2]);

      const devices = repos.wallets.getDevicesForWallet(w1.toLowerCase());
      assert.deepStrictEqual(devices, ['dev-1']);

      repos.wallets.unlinkWallet('dev-1', w1);
      assert.deepStrictEqual(repos.wallets.getLinkedWallets('dev-1'), [w2]);
    });
  });

  describe('DeviceSyncRepository', () => {
    test('enforces optimistic concurrency control with revision', () => {
      const aid = repos.deviceSync.ensureAccount('dev-1');
      assert.ok(aid);

      const state0 = repos.deviceSync.getAccountState(aid);
      assert.strictEqual(state0?.revision, 0);

      // Updating with matching revision succeeds and increments revision
      const success = repos.deviceSync.updateAccountSelection(aid, '[{"tokenId":1}]', 0);
      assert.ok(success);

      const state1 = repos.deviceSync.getAccountState(aid);
      assert.strictEqual(state1?.revision, 1);
      assert.strictEqual(state1?.selection, '[{"tokenId":1}]');

      // Updating with stale revision fails
      const conflict = repos.deviceSync.updateAccountSelection(aid, '[{"tokenId":2}]', 0);
      assert.strictEqual(conflict, false);
    });

    test('manages pairing lifecycle from challenge to verification', () => {
      repos.deviceSync.createTurtlePairing('PAIR123', 'pid-1', 5000, 1000);
      const pairing = repos.deviceSync.getTurtlePairing('PAIR-123');
      assert.ok(pairing);
      assert.strictEqual(pairing.verified, 0);

      repos.deviceSync.updateTurtlePairingChallenge(
        'PAIR-123',
        'chal-1',
        '0x1234567890123456789012345678901234567890',
        42,
        'Sign this'
      );
      repos.deviceSync.verifyTurtlePairing('PAIR123', 'chal-1');

      const verified = repos.deviceSync.getTurtlePairing('PAIR123');
      assert.strictEqual(verified?.verified, 1);
      assert.strictEqual(verified?.token_id, 42);
    });
  });

  describe('EconomyRepository', () => {
    test('handles credit deposits, deductions, and maintains ledger consistency', () => {
      const initial = repos.economy.getCreditBalance('pet-1');
      assert.strictEqual(initial, 0);

      const bal1 = repos.economy.adjustCredits('pet-1', 500, 'deposit', 'session', 'sess-1', 100);
      assert.strictEqual(bal1, 500);

      const bal2 = repos.economy.adjustCredits('pet-1', -150, 'care_action', 'robot', '12', 101);
      assert.strictEqual(bal2, 350);

      // Fails on insufficient credits
      assert.throws(() => {
        repos.economy.adjustCredits('pet-1', -400, 'care_action', 'robot', '12', 102);
      });

      const history = repos.economy.getCreditLedger('pet-1');
      assert.strictEqual(history.length, 2);
      assert.strictEqual(history[0].delta, -150);
      assert.strictEqual(history[0].balance, 350);
      assert.strictEqual(history[1].delta, 500);
      assert.strictEqual(history[1].balance, 500);
    });
  });

  describe('VoteRepository', () => {
    test('tracks collection suggestions, votes, and leaderboard ranking', () => {
      const c1 = repos.votes.createSuggestion(8453, '0xaaa', 'Collection A', 100);
      const c2 = repos.votes.createSuggestion(8453, '0xbbb', 'Collection B', 101);

      repos.votes.recordVote(c1, 'pet-1', 50, '5000000', 102);
      repos.votes.recordVote(c1, 'pet-2', 100, '10000000', 103);
      repos.votes.recordVote(c2, 'pet-3', 25, '2500000', 104);

      const ranked = repos.votes.listSuggestionsWithVotes();
      assert.strictEqual(ranked.length, 2);
      assert.strictEqual(ranked[0].id, c1);
      assert.strictEqual(ranked[0].total_credits, 150);
      assert.strictEqual(ranked[0].total_voters, 2);
      assert.strictEqual(ranked[1].id, c2);
      assert.strictEqual(ranked[1].total_credits, 25);
    });
  });

  describe('AdminRepository', () => {
    test('manages app settings, admin users, and audit records', () => {
      repos.admin.setSetting('dailyAllowance', '500', 100);
      assert.strictEqual(repos.admin.getSetting('dailyAllowance'), '500');

      repos.admin.createUser('admin', 'salt1', 'hash1', 100);
      assert.strictEqual(repos.admin.countUsers(), 1);
      assert.strictEqual(repos.admin.getUser('admin')?.password_hash, 'hash1');

      repos.admin.recordAudit('update_setting', 'dailyAllowance=500', 100);
      const logs = repos.admin.listAuditLogs(10);
      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0].action, 'update_setting');
    });
  });

  describe('RobotRepository', () => {
    test('tracks daily care allowance and caches token ownership', () => {
      assert.strictEqual(repos.robots.getDailyCareUsed('pet-1', '2026-10-14'), 0);
      repos.robots.recordDailyCareUsage('pet-1', '2026-10-14', 1, 100);
      assert.strictEqual(repos.robots.getDailyCareUsed('pet-1', '2026-10-14'), 1);

      repos.robots.setRobotOwnership('0xabc', 42, 100, '{"valid":true}');
      const ownership = repos.robots.getRobotOwnership('0xABC', 42);
      assert.ok(ownership);
      assert.strictEqual(ownership.payload, '{"valid":true}');
    });
  });

  describe('TelegramRepository', () => {
    test('handles moderation filters, blocklists, and strikes', () => {
      repos.telegram.setFilter('chat-1', '/rules', 'Be friendly!', 'admin', 100);
      assert.strictEqual(repos.telegram.getFilter('chat-1', '/rules'), 'Be friendly!');

      repos.telegram.addBlocklistPattern('chat-1', 'spam', 'admin', 100);
      assert.deepStrictEqual(repos.telegram.listBlocklist('chat-1'), ['spam']);

      repos.telegram.recordStrike('chat-1', 'user-1', 1, 'bad word', 100);
      const strikes = repos.telegram.getStrikes('chat-1', 'user-1');
      assert.strictEqual(strikes.strikes, 1);
      assert.strictEqual(strikes.lastViolation, 'bad word');
    });
  });
});
