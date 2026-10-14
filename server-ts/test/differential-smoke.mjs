import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_INVENTORY, loadConfig } from '../dist/config.js';

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

async function snapshot(baseUrl, request) {
  const response = await fetch(`${baseUrl}${request.path}`, {
    method: request.method || 'GET',
    headers: request.headers,
    body: request.body,
    redirect: 'manual',
  });
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('/json') || contentType.includes('+json');
  const body = isJson
    ? await response.json()
    : Buffer.from(await response.arrayBuffer()).toString('base64');
  const headers = {};
  for (const name of [
    'access-control-allow-headers',
    'access-control-allow-methods',
    'access-control-allow-origin',
    'cache-control',
    'content-type',
    'link',
    'vary',
  ]) {
    const value = response.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return { status: response.status, headers, body };
}

const allowedOrigin = { origin: 'https://tinyfrens.lol' };
const requests = [
  { name: 'health', path: '/health' },
  { name: 'static asset', path: '/web/app.js' },
  { name: 'snap default response', path: '/' },
  { name: 'snap HTML', path: '/', headers: { accept: 'text/html' } },
  { name: 'snap JSON', path: '/api/snap', headers: { accept: 'application/vnd.farcaster.snap+json' } },
  { name: 'Farcaster manifest', path: '/.well-known/farcaster.json' },
  { name: 'Bankr status', path: '/api/bankr/status', headers: allowedOrigin },
  { name: 'economy status', path: '/api/economy/status', headers: allowedOrigin },
  { name: 'empty suggestions', path: '/api/collections/suggestions', headers: allowedOrigin },
  { name: 'vote status', path: '/api/vote/status', headers: allowedOrigin },
  { name: 'gallery collections', path: '/api/gallery/collections', headers: allowedOrigin },
  { name: 'push key', path: '/api/push/public-key', headers: allowedOrigin },
  {
    name: 'generic preflight',
    method: 'OPTIONS',
    path: '/api/wallet-link/status',
    headers: { origin: 'https://tinyfrens.lol' },
  },
  {
    name: 'rejected origin',
    method: 'POST',
    path: '/api/register',
    headers: { 'content-type': 'application/json', origin: 'https://malicious.example' },
    body: '{}',
  },
  {
    name: 'rejected registration',
    method: 'POST',
    path: '/api/register',
    headers: { 'content-type': 'application/json', origin: 'https://tinyfrens.lol' },
    body: '{}',
  },
  {
    name: 'malformed JSON registration',
    method: 'POST',
    path: '/api/register',
    headers: { 'content-type': 'application/json', origin: 'https://tinyfrens.lol' },
    body: '{',
  },
  {
    name: 'oversized registration',
    method: 'POST',
    path: '/api/register',
    headers: { 'content-type': 'application/json', origin: 'https://tinyfrens.lol' },
    body: JSON.stringify({ pet: { name: 'x'.repeat(5000) } }),
  },
];

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

  for (const request of requests) {
    const [expected, actual] = await Promise.all([
      snapshot(pythonUrl, request),
      snapshot(typescriptUrl, request),
    ]);
    assert.deepEqual(actual, expected, `${request.name} diverged`);
  }
  process.stdout.write(`Compared ${requests.length} side-effect-free requests across Python and TypeScript.\n`);
} finally {
  await Promise.all([stop(python), stop(typescript)]);
  await rm(tempRoot, { recursive: true, force: true });
}
