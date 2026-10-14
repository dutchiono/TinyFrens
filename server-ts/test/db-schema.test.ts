import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDbConnection } from '../src/db/connection.js';
import { initSchema, getAllTableNames, SCHEMA_STATEMENTS } from '../src/db/schema.js';

describe('SQLite Database Schema & Compatibility', () => {
  test('creates all defined tables cleanly in a fresh database', () => {
    const db = createDbConnection(':memory:');
    initSchema(db);

    const tables = getAllTableNames(db);
    assert.equal(tables.length, SCHEMA_STATEMENTS.length);

    for (const statement of SCHEMA_STATEMENTS) {
      assert.ok(tables.includes(statement.table), `Missing table: ${statement.table}`);
    }

    db.close();
  });

  test('is idempotent when schema initialization runs multiple times', () => {
    const db = createDbConnection(':memory:');
    initSchema(db);
    initSchema(db); // Second run should not throw

    const tables = getAllTableNames(db);
    assert.equal(tables.length, SCHEMA_STATEMENTS.length);
    db.close();
  });

  test('supports transactions, insert, and select across core tables', () => {
    const db = createDbConnection(':memory:');
    initSchema(db);

    const runTx = db.transaction(() => {
      db.prepare('INSERT INTO pets(id, code, token, profile) VALUES(?, ?, ?, ?)').run(
        'pet-123',
        'CODE1234',
        'token-hash',
        JSON.stringify({ name: 'Frenny', color: 'blue' })
      );
      db.prepare('INSERT INTO credit_accounts(pet_id, balance, updated_at) VALUES(?, ?, ?)').run(
        'pet-123',
        1000,
        Math.floor(Date.now() / 1000)
      );
    });

    runTx();

    const pet = db.prepare<{ id: string; code: string }>('SELECT id, code FROM pets WHERE id = ?').get('pet-123');
    assert.ok(pet);
    assert.equal(pet.id, 'pet-123');
    assert.equal(pet.code, 'CODE1234');

    const credit = db.prepare<{ balance: number }>('SELECT balance FROM credit_accounts WHERE pet_id = ?').get('pet-123');
    assert.ok(credit);
    assert.equal(credit.balance, 1000);

    db.close();
  });
});
