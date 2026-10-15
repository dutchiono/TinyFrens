import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'tinyfrens-startup-'));
const database = path.join(tempRoot, 'tinyfrens.db');
const port = await availablePort();
const output = [];
const child = spawn(process.execPath, ['dist/main.js'], {
  cwd: path.resolve(import.meta.dirname, '..'),
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    DB_PATH: database,
    INDEXER_ENABLED: 'false',
    FRENS_TREASURY_INDEXER: 'false',
    TELEGRAM_MODERATION: 'false',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', chunk => output.push(chunk.toString()));
child.stderr.on('data', chunk => output.push(chunk.toString()));
let readonlyChild;

async function databaseHash() {
  return createHash('sha256').update(await readFile(database)).digest('hex');
}

async function waitForHealth(process, processOutput) {
  let response;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    assert.equal(process.exitCode, null, `server exited during startup\n${processOutput.join('')}`);
    try {
      response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return response;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  assert.fail(`server did not become healthy\n${processOutput.join('')}`);
}

try {
  const response = await waitForHealth(child, output);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.ok((await stat(database)).size > 0, 'startup did not initialize SQLite');

  child.kill('SIGTERM');
  const exit = await new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const expectedExit = process.platform === 'win32'
    ? { code: null, signal: 'SIGTERM' }
    : { code: 0, signal: null };
  assert.deepEqual(exit, expectedExit, `server did not shut down cleanly\n${output.join('')}`);

  const beforeReadonly = await databaseHash();
  const readonlyOutput = [];
  readonlyChild = spawn(process.execPath, ['dist/main.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DB_PATH: database,
      DB_READ_ONLY: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  readonlyChild.stdout.on('data', chunk => readonlyOutput.push(chunk.toString()));
  readonlyChild.stderr.on('data', chunk => readonlyOutput.push(chunk.toString()));
  const readonlyResponse = await waitForHealth(readonlyChild, readonlyOutput);
  assert.deepEqual(await readonlyResponse.json(), { ok: true });
  readonlyChild.kill('SIGTERM');
  await new Promise(resolve => readonlyChild.once('exit', resolve));
  assert.equal(await databaseHash(), beforeReadonly, 'read-only startup changed SQLite');
} finally {
  if (child.exitCode === null) child.kill('SIGKILL');
  if (readonlyChild?.exitCode === null) readonlyChild.kill('SIGKILL');
  await rm(tempRoot, { recursive: true, force: true });
}
