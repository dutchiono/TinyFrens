import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabaseConnection } from '../../src/db/connection.js';
import { initSchema } from '../../src/db/schema.js';
import {
  Economy,
  AddressPool,
  EconomyError,
  UnknownSession,
  SessionExpired,
  InsufficientCredits,
} from '../../src/domain/economy.js';
import {
  creditsFromWei,
  weiFromFrens,
  CREDITS_PER_FRENS,
} from '../../src/domain/economy-math.js';

class FakeClock {
  t: number;
  constructor(t: number = 1_000_000) {
    this.t = t;
  }
  now = () => this.t;
  advance(seconds: number) {
    this.t += seconds;
  }
}

const ADDRESS = '0x' + 'ab'.repeat(20);

describe('Credits Math Unit Tests (server/test_economy.py)', () => {
  it('test_credits_from_wei', () => {
    assert.equal(creditsFromWei(10n * 10n ** 18n), 1_000n);
    assert.equal(creditsFromWei(0), 0n);
    assert.equal(weiFromFrens(10), 10n * 10n ** 18n);
  });

  it('test_credits_from_wei_rejects_negative', () => {
    assert.throws(() => creditsFromWei(-1), /amount must be >= 0/);
  });

  it('test_packages_are_consistent', () => {
    const db = createDatabaseConnection(':memory:');
    initSchema(db);
    const e = new Economy(db);
    for (const pkg of e.packages()) {
      assert.equal(Number(creditsFromWei(pkg.amountWei)), pkg.credits);
    }
  });
});

describe('Deposit Session Unit Tests (server/test_economy.py)', () => {
  let clock: FakeClock;
  let db: ReturnType<typeof createDatabaseConnection>;
  let e: Economy;

  beforeEach(() => {
    clock = new FakeClock();
    db = createDatabaseConnection(':memory:');
    initSchema(db);
    e = new Economy(db, clock.now);
  });

  it('test_open_session_fields', () => {
    const s = e.openSession('pet-1', ADDRESS, 50, { token: '0xfrens', chainId: 84532 });
    assert.equal(s.petId, 'pet-1');
    assert.equal(s.address, ADDRESS);
    assert.equal(s.expectedAmount, (50n * 10n ** 18n).toString());
    assert.equal(s.credits, 5_000);
    assert.equal(s.status, 'open');
  });

  it('test_open_expires_previous_open_session', () => {
    const first = e.openSession('pet-1', ADDRESS, 10);
    const second = e.openSession('pet-1', ADDRESS, 10);
    assert.notEqual(first.id, second.id);
    assert.equal(e.session(first.id).status, 'expired');
    assert.equal(e.session(second.id).status, 'open');
  });

  it('test_unknown_session_raises', () => {
    assert.throws(() => e.session('nope'), UnknownSession);
  });

  it('test_expire_stale', () => {
    const s = e.openSession('pet-1', ADDRESS, 10, { ttl: 900 });
    clock.advance(901);
    assert.equal(e.expireStale(), 1);
    assert.equal(e.session(s.id).status, 'expired');
  });

  it('test_session_by_address', () => {
    const s = e.openSession('pet-1', ADDRESS, 10);
    const found = e.openSessionForAddress(ADDRESS);
    assert.ok(found);
    assert.equal(found!.id, s.id);
  });

  it('test_open_rejects_non_positive', () => {
    assert.throws(() => e.openSession('pet-1', ADDRESS, 0), /frens must be > 0/);
    assert.throws(() => e.openSession('pet-1', ADDRESS, -10), /frens must be > 0/);
  });
});

describe('Deposit Confirm Unit Tests (server/test_economy.py)', () => {
  let clock: FakeClock;
  let db: ReturnType<typeof createDatabaseConnection>;
  let e: Economy;

  beforeEach(() => {
    clock = new FakeClock();
    db = createDatabaseConnection(':memory:');
    initSchema(db);
    e = new Economy(db, clock.now);
  });

  it('test_confirm_grants_credits', () => {
    const s = e.openSession('pet-1', ADDRESS, 50, { chainId: 84532 });
    const result = e.confirm(s.id, '0xTX', 50n * 10n ** 18n, 84532);
    assert.equal(result.status, 'confirmed');
    assert.equal(result.credits, 5_000);
    assert.equal(e.balance('pet-1'), 5_000);
    assert.equal(e.session(s.id).status, 'confirmed');
  });

  it('test_confirm_is_idempotent_on_tx', () => {
    const s = e.openSession('pet-1', ADDRESS, 50, { chainId: 84532 });
    e.confirm(s.id, '0xTX', 50n * 10n ** 18n, 84532);
    const again = e.confirm(s.id, '0xTX', 50n * 10n ** 18n, 84532);
    assert.equal(again.status, 'duplicate');
    assert.equal(e.balance('pet-1'), 5_000);
  });

  it('test_second_distinct_deposit_rejected', () => {
    const s = e.openSession('pet-1', ADDRESS, 10, { chainId: 84532 });
    e.confirm(s.id, '0xTX1', 10n * 10n ** 18n, 84532);
    assert.throws(() => e.confirm(s.id, '0xTX2', 10n * 10n ** 18n, 84532), SessionExpired);
    assert.equal(e.balance('pet-1'), 1_000);
  });

  it('test_underpaid_rejected', () => {
    const s = e.openSession('pet-1', ADDRESS, 50, { chainId: 84532 });
    assert.throws(() => e.confirm(s.id, '0xTX', 1n * 10n ** 18n, 84532), EconomyError);
  });

  it('test_expired_session_rejected', () => {
    const s = e.openSession('pet-1', ADDRESS, 10, { chainId: 84532, ttl: 900 });
    clock.advance(901);
    assert.throws(() => e.confirm(s.id, '0xTX', 10n * 10n ** 18n, 84532), SessionExpired);
  });

  it('test_address_mismatch_rejected', () => {
    const s = e.openSession('pet-1', ADDRESS, 10, { chainId: 84532 });
    assert.throws(() => e.confirm(s.id, '0xTX', 10n * 10n ** 18n, 84532, 0, '0xdead'), UnknownSession);
  });

  it('test_null_address_skips_check', () => {
    const s = e.openSession('pet-1', ADDRESS, 10, { chainId: 84532 });
    const result = e.confirm(s.id, '0xTX', 10n * 10n ** 18n, 84532, 0, null);
    assert.equal(result.status, 'confirmed');
  });
});

describe('Credit Ledger Unit Tests (server/test_economy.py)', () => {
  let db: ReturnType<typeof createDatabaseConnection>;
  let e: Economy;

  beforeEach(() => {
    db = createDatabaseConnection(':memory:');
    initSchema(db);
    e = new Economy(db);
  });

  it('test_grant_and_spend', () => {
    e.grant('pet-1', 500, 'welcome');
    assert.equal(e.balance('pet-1'), 500);
    e.spend('pet-1', 200, 'hat');
    assert.equal(e.balance('pet-1'), 300);
  });

  it('test_spend_beyond_balance_rejected', () => {
    e.grant('pet-1', 100);
    assert.throws(() => e.spend('pet-1', 101), InsufficientCredits);
    assert.equal(e.balance('pet-1'), 100);
  });

  it('test_grant_rejects_non_positive', () => {
    assert.throws(() => e.grant('pet-1', 0), /credits must be > 0/);
    assert.throws(() => e.grant('pet-1', -10), /credits must be > 0/);
    assert.throws(() => (e as any).grant('pet-1', '50'), /credits must be > 0/);
    assert.throws(() => (e as any).grant('pet-1', true), /credits must be > 0/);
  });

  it('test_spend_rejects_non_positive_and_invalid_types', () => {
    e.grant('pet-1', 100);
    assert.throws(() => e.spend('pet-1', 0), /credits must be > 0/);
    assert.throws(() => e.spend('pet-1', -50), /credits must be > 0/);
    assert.throws(() => (e as any).spend('pet-1', '50'), /credits must be > 0/);
    assert.throws(() => (e as any).spend('pet-1', true), /credits must be > 0/);
    assert.throws(() => (e as any).spend('pet-1', 50.5), /credits must be > 0/);
    assert.equal(e.balance('pet-1'), 100);
  });

  it('test_history_is_append_only_descending', () => {
    e.grant('pet-1', 100, 'a');
    e.grant('pet-1', 50, 'b');
    e.spend('pet-1', 30, 'c');
    const history = e.history('pet-1');
    assert.deepEqual(history.map(h => h.reason), ['c', 'b', 'a']);
    assert.equal(history[0].balance, 120);
  });
});

describe('Treasury Transfer Unit Tests (server/test_economy.py)', () => {
  let clock: FakeClock;
  let db: ReturnType<typeof createDatabaseConnection>;
  let e: Economy;

  beforeEach(() => {
    clock = new FakeClock();
    db = createDatabaseConnection(':memory:');
    initSchema(db);
    e = new Economy(db, clock.now);
  });

  function credit(kw: Partial<Parameters<Economy['creditTransfer']>[0]> = {}) {
    return e.creditTransfer({
      txHash: '0x' + 'aa'.repeat(32),
      chainId: 8453,
      logIndex: 0,
      sender: ADDRESS,
      amountWei: 10n * 10n ** 18n,
      ...kw,
    });
  }

  it('test_credits_resolved_sender', () => {
    const result = credit({ petId: 'pet-1' });
    assert.deepEqual(result, { status: 'credited', credits: 1_000, petId: 'pet-1' });
    assert.equal(e.balance('pet-1'), 1_000);
    const reasons = e.history('pet-1').map(h => h.reason);
    assert.deepEqual(reasons, ['treasury']);
  });

  it('test_idempotent_on_chain_tx_index', () => {
    const first = credit({ petId: 'pet-1' });
    const again = credit({ petId: 'pet-1' });
    assert.equal(first.status, 'credited');
    assert.equal(again.status, 'duplicate');
    assert.equal(e.balance('pet-1'), 1_000);
  });

  it('test_unmatched_sender_credits_nothing', () => {
    const result = credit({ petId: null });
    assert.equal(result.status, 'unmatched');
    assert.equal(result.credits, 0);
    assert.equal(e.balance('pet-1'), 0);
    assert.ok(e.treasuryTransfer(8453, '0x' + 'aa'.repeat(32), 0));
  });

  it('test_over_cap_records_but_credits_nothing', () => {
    const result = credit({ petId: 'pet-1', amountWei: 10n ** 21n, maxCredits: 100 });
    assert.equal(result.status, 'over_cap');
    assert.equal(result.credits, 0);
    assert.equal(e.balance('pet-1'), 0);
  });

  it('test_dust_below_one_credit_recorded', () => {
    const result1 = credit({ petId: 'pet-1', amountWei: 10n ** 16n }); // 0.01 FRENS -> 1 credit
    assert.equal(result1.credits, 1);
    const result2 = credit({ petId: 'pet-1', amountWei: 10n ** 15n, logIndex: 1 }); // below one credit
    assert.equal(result2.status, 'dust');
    assert.equal(result2.credits, 0);
  });

  it('test_configurable_credits_per_frens', () => {
    const customDb = createDatabaseConnection(':memory:');
    initSchema(customDb);
    const customE = new Economy(customDb, clock.now, 250);
    assert.equal(customE.creditsPerFrens, 250);
    const result = customE.creditTransfer({
      txHash: '0x' + 'bb'.repeat(32),
      amountWei: 10n * 10n ** 18n,
      chainId: 8453,
      logIndex: 0,
      sender: ADDRESS,
      petId: 'pet-1',
    });
    assert.equal(result.credits, 2_500);
  });
});

describe('AddressPool Unit Tests', () => {
  it('allocates free address and detects busy ones', () => {
    const db = createDatabaseConnection(':memory:');
    initSchema(db);
    const pool = new AddressPool(db, ['0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222']);
    const economy = new Economy(db);

    const addr1 = pool.allocate('pet-1');
    assert.equal(addr1, '0x1111111111111111111111111111111111111111');

    economy.openSession('pet-1', addr1, 10);
    const addr2 = pool.allocate('pet-2');
    assert.equal(addr2, '0x2222222222222222222222222222222222222222');

    economy.openSession('pet-2', addr2, 10);
    assert.throws(() => pool.allocate('pet-3'), /no deposit address available/);
  });
});
