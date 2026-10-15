import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_INVENTORY, loadConfig } from '../dist/config.js';
import { compareServers, parityRequests } from './parity-requests.mjs';

const serverTsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(serverTsRoot, '..');

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

function cleanEnvironment(database, port) {
  const defaults = loadConfig({});
  const environment = {};
  for (const key of [
    'APPDATA', 'HOME', 'LOCALAPPDATA', 'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'WINDIR',
  ]) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  for (const { key } of CONFIG_INVENTORY) {
    const value = defaults[key];
    environment[key] = value === undefined ? '' : String(value);
  }
  return {
    ...environment,
    HOST: '127.0.0.1',
    PORT: String(port),
    DB_PATH: database,
    ALLOWED_ORIGINS: 'https://tinyfrens.lol,https://www.tinyfrens.lol',
    INDEXER_ENABLED: 'false',
    FRENS_TREASURY_INDEXER: 'false',
    TELEGRAM_MODERATION: 'false',
  };
}

function launch(command, args, cwd, env) {
  const output = [];
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => output.push(chunk.toString()));
  child.stderr.on('data', chunk => output.push(chunk.toString()));
  return { child, output };
}

async function waitForHealth(runtime, baseUrl) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    assert.equal(runtime.child.exitCode, null, `server exited during startup\n${runtime.output.join('')}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  assert.fail(`server did not become healthy\n${runtime.output.join('')}`);
}

async function stop(runtime) {
  if (runtime.child.exitCode !== null) return;
  runtime.child.kill('SIGTERM');
  await new Promise(resolve => runtime.child.once('exit', resolve));
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'tinyfrens-differential-'));
const seed = path.join(tempRoot, 'seed.db');
const pythonDatabase = path.join(tempRoot, 'python.db');
const typescriptDatabase = path.join(tempRoot, 'typescript.db');
await writeFile(seed, '');
await copyFile(seed, pythonDatabase);
await copyFile(seed, typescriptDatabase);
const pythonPort = await availablePort();
const typescriptPort = await availablePort();
const python = launch(
  process.env.PYTHON || 'python',
  [path.join(repoRoot, 'server/app.py')],
  repoRoot,
  cleanEnvironment(pythonDatabase, pythonPort)
);
const typescript = launch(
  process.execPath,
  ['dist/main.js'],
  serverTsRoot,
  cleanEnvironment(typescriptDatabase, typescriptPort)
);

try {
  const pythonUrl = `http://127.0.0.1:${pythonPort}`;
  const typescriptUrl = `http://127.0.0.1:${typescriptPort}`;
  await Promise.all([waitForHealth(python, pythonUrl), waitForHealth(typescript, typescriptUrl)]);

  await compareServers(pythonUrl, typescriptUrl);
  process.stdout.write(`Compared ${parityRequests.length} side-effect-free requests across Python and TypeScript.\n`);
} finally {
  await Promise.all([stop(python), stop(typescript)]);
  await rm(tempRoot, { recursive: true, force: true });
}
