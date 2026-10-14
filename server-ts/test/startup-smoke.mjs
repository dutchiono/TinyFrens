import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
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

try {
  let response;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, `server exited during startup\n${output.join('')}`);
    try {
      response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  assert.ok(response, `server did not become healthy\n${output.join('')}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.ok((await stat(database)).size > 0, 'startup did not initialize SQLite');

  child.kill('SIGTERM');
  const exit = await new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const expectedExit = process.platform === 'win32'
    ? { code: null, signal: 'SIGTERM' }
    : { code: 0, signal: null };
  assert.deepEqual(exit, expectedExit, `server did not shut down cleanly\n${output.join('')}`);
} finally {
  if (child.exitCode === null) child.kill('SIGKILL');
  await rm(tempRoot, { recursive: true, force: true });
}
