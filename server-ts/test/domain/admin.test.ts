import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BetterSqliteConnection, DatabaseConnection } from '../../src/db/connection.js';
import {
  Admin,
  clampInt,
  overridesOnly,
  shapeOverrides,
  effectiveSettings,
  hashPassword,
  verifyPassword,
  BadRequestError,
  UnauthorizedError,
  MAX_ALLOWANCE,
  MAX_GAME_REWARD,
} from '../../src/domain/admin.js';
import {
  CARE_ACTIONS,
  DEFAULT_DAILY_ALLOWANCE,
  DEFAULT_GAME_REWARD_CREDITS,
} from '../../src/domain/robot-care-rules.js';

describe('Admin Settings Unit Tests', () => {
  let db: DatabaseConnection;

  beforeEach(() => {
    db = new BetterSqliteConnection(':memory:');
    new Admin(db, { token: 'secret' }); // creates the schema
  });

  it('defaults when empty', () => {
    const eff = effectiveSettings(db);
    assert.equal(eff.dailyAllowance, DEFAULT_DAILY_ALLOWANCE);
    assert.equal(eff.gameRewardCredits, DEFAULT_GAME_REWARD_CREDITS);
    assert.deepEqual(Object.keys(eff.prices).sort(), [...CARE_ACTIONS].sort());
  });

  it('config overrides default', () => {
    const eff = effectiveSettings(db, {
      ROBOT_CARE_DAILY_ALLOWANCE: 5,
      ROBOT_CARE_PRICE_FEED: 7,
      ROBOT_CARE_GAME_REWARD_CREDITS: 250,
    } as any);
    assert.equal(eff.dailyAllowance, 5);
    assert.equal(eff.gameRewardCredits, 250);
    assert.equal(eff.prices.feed, 7);
  });

  it('admin overrides beat config', () => {
    db.prepare("INSERT INTO app_settings(key, value, updated) VALUES('dailyAllowance', '3', 0)").run();
    db.prepare("INSERT INTO app_settings(key, value, updated) VALUES('price_feed', '11', 0)").run();

    const eff = effectiveSettings(db, {
      ROBOT_CARE_DAILY_ALLOWANCE: 5,
      ROBOT_CARE_PRICE_FEED: 7,
    } as any);
    assert.equal(eff.dailyAllowance, 3);
    assert.equal(eff.prices.feed, 11);
  });

  it('shape overrides', () => {
    const shaped = shapeOverrides({
      dailyAllowance: 4,
      gameRewardCredits: 50,
      price_feed: 9,
      ignored: 1,
    });
    assert.deepEqual(shaped, {
      dailyAllowance: 4,
      gameRewardCredits: 50,
      prices: { feed: 9 },
    });
  });

  it('clamp int rejects bad values', () => {
    const badValues = [true, 'x', null, -1, MAX_ALLOWANCE + 1];
    for (const bad of badValues) {
      assert.throws(
        () => clampInt(bad, 0, MAX_ALLOWANCE),
        BadRequestError
      );
    }
  });

  it('unknown keys are skipped in overrides_only', () => {
    db.prepare("INSERT INTO app_settings(key, value, updated) VALUES('nonsense', '1', 0)").run();
    db.prepare("INSERT INTO app_settings(key, value, updated) VALUES('price_feed', '9', 0)").run();
    assert.deepEqual(overridesOnly(db), { price_feed: 9 });
  });

  it('hash and verify password consistency', () => {
    const salt = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
    const hash = hashPassword('nottodayjunior', salt);
    assert.equal(hash, '761c202deb7f703feceaa87236e231353bac1b7dcb5f248b020b587deb92d217');
    assert.equal(verifyPassword('nottodayjunior', salt.toString('hex'), hash), true);
    assert.equal(verifyPassword('wrongpassword', salt.toString('hex'), hash), false);
  });
});

describe('Admin Store Tests', () => {
  let db: DatabaseConnection;
  let admin: Admin;

  beforeEach(() => {
    db = new BetterSqliteConnection(':memory:');
    admin = new Admin(db, { token: 'secret' });
  });

  it('disabled without token or user', () => {
    const emptyDb1 = new BetterSqliteConnection(':memory:');
    const a1 = new Admin(emptyDb1, { token: null, seedDefaultUser: false });
    assert.equal(a1.enabled, false);

    const emptyDb2 = new BetterSqliteConnection(':memory:');
    const a2 = new Admin(emptyDb2, { token: '   ', seedDefaultUser: false });
    assert.equal(a2.enabled, false);

    assert.equal(admin.enabled, true);
  });

  it('initial user seeded', () => {
    const freshDb = new BetterSqliteConnection(':memory:');
    const a = new Admin(freshDb, {
      token: null,
      initialUser: 'dutch',
      initialPassword: 'nottodayjunior',
    });
    assert.equal(a.enabled, true);
    const { token, username } = a.authenticate('dutch', 'nottodayjunior');
    assert.equal(username, 'dutch');
    assert.ok(token);
    assert.equal(a.validateSession(token), 'dutch');
    assert.deepEqual(a.listUsers().map(user => user.username), ['dutch', 'mantrid', 'michael']);
    assert.equal(a.listUsers().find(user => user.username === 'michael')?.passwordChangeRequired, true);
  });

  it('authentication invalid password', () => {
    assert.throws(() => admin.authenticate('dutch', 'wrongpassword'), UnauthorizedError);
  });

  it('authentication unknown user', () => {
    assert.throws(() => admin.authenticate('unknown', 'pass'), UnauthorizedError);
  });

  it('create user', () => {
    admin.createUser('alice', 'superpassword123');
    const { username } = admin.authenticate('alice', 'superpassword123');
    assert.equal(username, 'alice');
    const users = admin.listUsers().map(u => u.username);
    assert.ok(users.includes('alice'));
    assert.ok(users.includes('dutch'));
    assert.throws(() => admin.createUser('alice', 'anotherpassword123'), /already exists/);
  });

  it('changes only the signed-in admin password and revokes their other sessions', () => {
    admin.createUser('alice', 'superpassword123');
    const first = admin.authenticate('alice', 'superpassword123');
    const second = admin.authenticate('alice', 'superpassword123');
    db.prepare('UPDATE admin_users SET must_change_password=1 WHERE username=?').run('alice');
    assert.equal(admin.passwordChangeRequired('alice'), true);

    admin.changePassword('alice', 'superpassword123', 'differentpassword456', first.token);
    assert.equal(admin.validateSession(first.token), 'alice');
    assert.equal(admin.validateSession(second.token), null);
    assert.equal(admin.passwordChangeRequired('alice'), false);
    assert.throws(() => admin.authenticate('alice', 'superpassword123'), UnauthorizedError);
    assert.equal(admin.authenticate('alice', 'differentpassword456').username, 'alice');
    assert.equal(admin.recentAudit()[0].action, 'login');
    assert.ok(admin.recentAudit().some(entry => entry.action === 'change_password'));
  });

  it('session expiry and logout', () => {
    let mockTime = 1000;
    const timeAdmin = new Admin(db, {
      token: 'secret',
      now: () => mockTime,
      seedDefaultUser: false,
    });
    timeAdmin.createUser('bob', 'password123');
    const { token } = timeAdmin.authenticate('bob', 'password123');

    // Valid immediately
    assert.equal(timeAdmin.validateSession(token), 'bob');

    // Advance 8 days past 7 day expiry
    mockTime += 8 * 86400;
    assert.equal(timeAdmin.validateSession(token), null);

    // Logout
    mockTime = 1000;
    const { token: token2 } = timeAdmin.authenticate('bob', 'password123');
    assert.equal(timeAdmin.validateSession(token2), 'bob');
    assert.equal(timeAdmin.logoutSession(token2), true);
    assert.equal(timeAdmin.validateSession(token2), null);
    assert.equal(timeAdmin.logoutSession(token2), false);
  });

  it('save persists and audits', () => {
    const eff = admin.save({
      dailyAllowance: 7,
      gameRewardCredits: 250,
      prices: { feed: 12 },
    });
    assert.equal(eff.dailyAllowance, 7);
    assert.equal(eff.gameRewardCredits, 250);
    assert.equal(eff.prices.feed, 12);
    assert.deepEqual(overridesOnly(db), {
      dailyAllowance: 7,
      gameRewardCredits: 250,
      price_feed: 12,
    });
    const audit = admin.recentAudit();
    assert.equal(audit[0].action, 'settings');
    assert.deepEqual(audit[0].detail, {
      dailyAllowance: 7,
      gameRewardCredits: 250,
      price_feed: 12,
    });
  });

  it('save rejects bad payloads', () => {
    const badBodies = [
      {},
      { unknown: 1 },
      { prices: { teleport: 1 } },
      { prices: [] },
      { dailyAllowance: 'x' },
      { dailyAllowance: -1 },
      { dailyAllowance: true },
      { gameRewardCredits: -1 },
      { gameRewardCredits: MAX_GAME_REWARD + 1 },
    ];
    for (const body of badBodies) {
      assert.throws(() => admin.save(body), BadRequestError);
    }
  });
});
