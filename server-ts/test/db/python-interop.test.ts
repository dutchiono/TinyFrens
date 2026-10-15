import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import { createRepositories } from '../../src/db/repositories/index.js';

describe('Database: Python <-> TypeScript Cross-Compatibility', () => {
  test('TypeScript server reads Python fixture DB and Python reads TypeScript updates', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyfrens-db-interop-'));
    const dbPath = path.join(tmpDir, 'interop.db');

    try {
      // 1. Python script creates schema and populates fixture data
      const pythonPopulateScript = `
import sqlite3, time

db = sqlite3.connect(r"${dbPath.replace(/\\/g, '\\\\')}")
with db:
    db.execute("CREATE TABLE pets(id TEXT PRIMARY KEY, code TEXT UNIQUE, token TEXT UNIQUE, profile TEXT)")
    db.execute("CREATE TABLE friends(a TEXT, b TEXT, PRIMARY KEY(a,b))")
    db.execute("CREATE TABLE wallet_links(pet_id TEXT, address TEXT COLLATE NOCASE NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(pet_id, address))")
    db.execute("CREATE TABLE credit_accounts(pet_id TEXT PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)")
    db.execute("CREATE TABLE credit_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT, pet_id TEXT NOT NULL, delta INTEGER NOT NULL, balance INTEGER NOT NULL, reason TEXT NOT NULL, ref_type TEXT, ref_id TEXT, created INTEGER NOT NULL)")
    db.execute("CREATE TABLE account_profiles(account TEXT PRIMARY KEY, display_name TEXT NOT NULL DEFAULT '', x_handle TEXT NOT NULL DEFAULT '', updated INTEGER NOT NULL)")
    db.execute("CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL)")

    db.execute("INSERT INTO pets VALUES(?, ?, ?, ?)", ("py-pet-1", "PYCODE", "pytok", '{"name":"PythonPet"}'))
    db.execute("INSERT INTO wallet_links VALUES(?, ?, ?)", ("py-pet-1", "0x5dA18b0D346b201d5c81b90c92699ECF44F6CC3B", 1700000000))
    db.execute("INSERT INTO credit_accounts VALUES(?, ?, ?)", ("py-pet-1", 1000, 1700000000))
    db.execute("INSERT INTO account_profiles VALUES(?, ?, ?, ?)", ("acc-py", "Python Dev", "@pydev", 1700000000))
    db.execute("INSERT INTO app_settings VALUES(?, ?, ?)", ("dailyAllowance", "100", 1700000000))
db.close()
`;
      execFileSync('python', ['-c', pythonPopulateScript], { stdio: 'pipe' });

      // 2. Open in TypeScript with BetterSqliteConnection
      const db = createDbConnection(dbPath);
      // Run migrations to ensure all permanent tables are also added if missing
      runMigrations(db);
      const repos = createRepositories(db);

      // Verify TypeScript reads Python's data accurately
      const pet = repos.pets.findById('py-pet-1');
      assert.ok(pet);
      assert.strictEqual(pet.code, 'PYCODE');
      assert.strictEqual(pet.profile, '{"name":"PythonPet"}');

      const wallets = repos.wallets.getLinkedWallets('py-pet-1');
      assert.deepStrictEqual(wallets, ['0x5dA18b0D346b201d5c81b90c92699ECF44F6CC3B']);

      const balance = repos.economy.getCreditBalance('py-pet-1');
      assert.strictEqual(balance, 1000);

      const profile = repos.accounts.getProfile('acc-py');
      assert.strictEqual(profile?.display_name, 'Python Dev');
      assert.strictEqual(profile?.x_handle, '@pydev');

      const setting = repos.admin.getSetting('dailyAllowance');
      assert.strictEqual(setting, '100');

      // 3. Mutate and add rows using TypeScript repositories
      repos.economy.adjustCredits('py-pet-1', -250, 'care_action', 'robot', '42', 1700000500);
      repos.pets.createPet('ts-pet-2', 'TSCODE', 'tstok', '{"name":"TypeScriptPet"}');
      repos.pets.addFriendship('py-pet-1', 'ts-pet-2');
      repos.admin.setSetting('dailyAllowance', '200', 1700000500);

      db.close();

      // 4. Verify Python can read TypeScript's mutations cleanly
      const pythonVerifyScript = `
import sqlite3, json

db = sqlite3.connect(r"${dbPath.replace(/\\/g, '\\\\')}")
# Verify credit account updated
cur = db.execute("SELECT balance FROM credit_accounts WHERE pet_id='py-pet-1'")
balance = cur.fetchone()[0]
assert balance == 750, f"Expected 750, got {balance}"

# Verify credit ledger entry added
cur = db.execute("SELECT delta, balance, reason FROM credit_ledger WHERE pet_id='py-pet-1'")
ledger_entry = cur.fetchone()
assert ledger_entry == (-250, 750, 'care_action'), f"Unexpected ledger entry: {ledger_entry}"

# Verify TS pet created
cur = db.execute("SELECT id, code, profile FROM pets WHERE id='ts-pet-2'")
ts_pet = cur.fetchone()
assert ts_pet[0] == 'ts-pet-2' and ts_pet[1] == 'TSCODE', f"Unexpected pet: {ts_pet}"

# Verify mutual friendship added
cur = db.execute("SELECT b FROM friends WHERE a='py-pet-1'")
friends = [r[0] for r in cur.fetchall()]
assert friends == ['ts-pet-2'], f"Unexpected friends: {friends}"

# Verify app setting updated
cur = db.execute("SELECT value FROM app_settings WHERE key='dailyAllowance'")
val = cur.fetchone()[0]
assert val == '200', f"Unexpected setting: {val}"

db.close()
print("OK")
`;
      const output = execFileSync('python', ['-c', pythonVerifyScript], { encoding: 'utf-8' });
      assert.ok(output.includes('OK'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
