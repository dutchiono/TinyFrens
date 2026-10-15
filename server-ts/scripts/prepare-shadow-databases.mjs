import assert from 'node:assert/strict';
import { mkdir, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';

const [sourceArgument, outputArgument] = process.argv.slice(2);
assert.ok(sourceArgument, 'Usage: npm run shadow:prepare -- <source.db> <shadow-directory>');
assert.ok(outputArgument, 'Usage: npm run shadow:prepare -- <source.db> <shadow-directory>');

const source = path.resolve(sourceArgument);
const output = path.resolve(outputArgument);
const seed = path.join(output, 'seed.db');
const python = path.join(output, 'python.db');
const typescript = path.join(output, 'typescript.db');
assert.ok(![seed, python, typescript].includes(source), 'Shadow output must not contain the source database');

await mkdir(output, { recursive: true });
await Promise.all([seed, python, typescript].map(file => rm(file, { force: true })));

const sourceDatabase = new Database(source, { readonly: true, fileMustExist: true });
try {
  await sourceDatabase.backup(seed);
} finally {
  sourceDatabase.close();
}

const seedDatabase = new Database(seed, { readonly: true, fileMustExist: true });
try {
  const result = seedDatabase.pragma('integrity_check', { simple: true });
  assert.equal(result, 'ok', `SQLite integrity_check failed: ${result}`);
} finally {
  seedDatabase.close();
}

await Promise.all([copyFile(seed, python), copyFile(seed, typescript)]);
process.stdout.write(`Prepared verified shadow databases in ${output}\n`);
