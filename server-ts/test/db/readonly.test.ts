import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDbConnection } from '../../src/db/connection.js';

test('read-only connection reads existing data and rejects writes', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tinyfrens-readonly-'));
  const file = path.join(root, 'database.db');
  const writable = createDbConnection(file);
  writable.exec('CREATE TABLE proof (value TEXT NOT NULL); INSERT INTO proof VALUES (\'python-authority\')');
  writable.close();

  const readonly = createDbConnection(file, { readonly: true });
  try {
    assert.equal(readonly.prepare<{ value: string }>('SELECT value FROM proof').get()?.value, 'python-authority');
    assert.throws(() => readonly.prepare('INSERT INTO proof VALUES (?)').run('typescript'), /readonly/i);
  } finally {
    readonly.close();
    rmSync(root, { recursive: true, force: true });
  }
});
