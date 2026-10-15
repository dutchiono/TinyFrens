#!/usr/bin/env node
import { createWriteStream } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const BASE = '/var/www/tinyfrens';
export const NOTIFY_SECRET = '/etc/tinyfrens/deploy-notify.secret';
export const MAX_COMPRESSED_BYTES = 256 * 1024 * 1024;
export const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024;
export const MAX_ENTRIES = 20_000;
export const REQUIRED = [
  'index.html',
  'web/index.html',
  'web/gallery.html',
  '.well-known/farcaster.json',
  'snap-v2.json',
  'import/skill.md',
  'web/sw.js',
  'docs/index.html',
];

export function parseCommand(value) {
  const match = /^(publish|notify) ([a-f0-9]{40})$/.exec(value || '');
  if (!match) throw new Error('Only publish <commit SHA> or notify <commit SHA> is permitted');
  return { action: match[1], revision: match[2] };
}

export function validateRelativePath(value) {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  const parts = normalized.split('/').filter(Boolean);
  if (!normalized || normalized.startsWith('/') || parts.includes('..')) throw new Error('Unsafe archive entry');
  if (parts.some(part => part.startsWith('.') && part !== '.well-known' && part !== '.nojekyll')) {
    throw new Error('Private file in artifact');
  }
  if (normalized === 'admin.html' || normalized === 'web/admin.html' || parts[0] === 'admin') {
    throw new Error('Admin must not be published');
  }
  return normalized;
}

async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} failed: ${stderr.trim()}`)));
  });
}

async function archiveEntries(archive) {
  const names = [];
  const types = [];
  await new Promise((resolve, reject) => {
    const child = spawn('tar', ['-tvzf', archive]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => {
      if (code !== 0) return reject(new Error(`tar list failed: ${stderr.trim()}`));
      try {
        for (const line of stdout.split('\n').filter(Boolean)) {
          const type = line[0];
          const fields = line.trim().split(/\s+/);
          const name = fields.slice(5).join(' ').replace(/ -> .*$/, '');
          if (!name) throw new Error('Invalid archive listing');
          if ((name === '.' || name === './') && type === 'd') continue;
          types.push(type);
          names.push(validateRelativePath(name.replace(/\/$/, '')));
        }
      } catch (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  if (names.length > MAX_ENTRIES) throw new Error('Artifact exceeds deployment limits');
  if (types.some(type => type !== '-' && type !== 'd')) throw new Error('Unsafe archive entry type');
  return names;
}

async function inspectTree(root) {
  let count = 0;
  let bytes = 0;
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      count += 1;
      if (count > MAX_ENTRIES) throw new Error('Artifact exceeds deployment limits');
      const candidate = path.join(directory, entry.name);
      const stat = await lstat(candidate);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('Unsafe extracted entry');
      if (stat.isDirectory()) {
        await chmod(candidate, 0o755);
        await walk(candidate);
      } else {
        bytes += stat.size;
        if (bytes > MAX_EXPANDED_BYTES) throw new Error('Artifact exceeds deployment limits');
        await chmod(candidate, 0o644);
      }
    }
  }
  await walk(root);
  await chmod(root, 0o755);
}

export async function unpack(archive, destination) {
  await archiveEntries(archive);
  await mkdir(destination, { recursive: true });
  await run('tar', ['-xzf', archive, '-C', destination]);
  await inspectTree(destination);
  for (const name of REQUIRED) {
    const stat = await lstat(path.join(destination, name)).catch(() => null);
    if (!stat?.isFile()) throw new Error(`Missing required public file: ${name}`);
  }
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.request(url, options, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode || 0, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

export function loopbackLookup(_hostname, options, callback) {
  if (options.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
  else callback(null, '127.0.0.1', 4);
}

export async function verify(revision) {
  for (const host of ['tinyfrens.lol', 'www.tinyfrens.lol']) {
    for (const [requestPath, accept] of [
      ['/release.json', 'application/json'],
      ['/', 'text/html'],
      ['/web/', 'text/html'],
      ['/snap', 'application/vnd.farcaster.snap+json'],
    ]) {
      const response = await request(`https://${host}${requestPath}`, {
        headers: { Accept: accept },
        lookup: loopbackLookup,
        servername: host,
        timeout: 20_000,
      });
      if (response.status !== 200) throw new Error(`${host}${requestPath}: HTTP ${response.status}`);
      if (requestPath === '/release.json' && JSON.parse(response.body.toString()).revision !== revision) {
        throw new Error('Published revision does not match artifact');
      }
    }
  }
}

async function activateSymlink(candidate, current) {
  if (process.platform === 'win32') await unlink(current).catch(() => undefined);
  await rename(candidate, current);
}

export async function publish(archive, revision, base = BASE, verifier = verify) {
  const releases = path.join(base, 'releases');
  await mkdir(releases, { recursive: true });
  const incoming = await mkdtemp(path.join(releases, 'incoming-'));
  const stage = path.join(incoming, 'site');
  const target = path.join(releases, revision);
  let previous = null;
  try {
    await unpack(archive, stage);
    await writeFile(path.join(stage, 'release.json'), `${JSON.stringify({ revision, publishedAt: Math.floor(Date.now() / 1000) })}\n`);
    await lstat(target).then(() => { throw new Error('Revision already published; refuse to overwrite an immutable release'); }, () => undefined);
    await rename(stage, target);
    await rm(incoming, { recursive: true, force: true });

    const current = path.join(base, 'current');
    previous = await readlink(current).catch(() => null);
    const candidate = path.join(base, 'current.next');
    await unlink(candidate).catch(() => undefined);
    await symlink(target, candidate, 'dir');
    await activateSymlink(candidate, current);
    try {
      await verifier(revision);
    } catch (error) {
      if (previous) {
        await symlink(previous, candidate, 'dir');
        await activateSymlink(candidate, current);
      } else {
        await unlink(current).catch(() => undefined);
      }
      await rm(target, { recursive: true, force: true });
      throw error;
    }
  } finally {
    await rm(incoming, { recursive: true, force: true });
  }
  process.stdout.write(`Published ${revision}\n`);
}

export async function notifyServer(revision, verifier = verify, secretPath = NOTIFY_SECRET) {
  await verifier(revision);
  const secret = (await readFile(secretPath, 'utf8')).trim();
  if (!secret) throw new Error('Deployment notification relay secret is empty');
  const body = Buffer.from(JSON.stringify({ revision }));
  const response = await request('http://127.0.0.1:8790/api/internal/website-published', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(body.length),
      'X-TinyFrens-Deploy-Secret': secret,
    },
    timeout: 20_000,
    body,
  });
  if (response.status !== 200) {
    throw new Error(`Deployment notification failed: HTTP ${response.status}: ${response.body.toString().slice(0, 200)}`);
  }
}

async function acquireLock(base) {
  const lockPath = path.join(base, '.publish.lock');
  try {
    const handle = await open(lockPath, 'wx', 0o600);
    await handle.writeFile(String(process.pid));
    await handle.close();
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const owner = Number((await readFile(lockPath, 'utf8')).trim());
    if (!Number.isInteger(owner) || owner <= 0) {
      await unlink(lockPath);
      return acquireLock(base);
    }
    try {
      process.kill(owner, 0);
      throw new Error('Another publish is already running');
    } catch (processError) {
      if (processError?.code !== 'ESRCH') throw processError;
      await unlink(lockPath);
      return acquireLock(base);
    }
  }
  return async () => unlink(lockPath).catch(() => undefined);
}

async function receiveArchive(destination) {
  let bytes = 0;
  const meter = async function* (source) {
    for await (const chunk of source) {
      bytes += chunk.length;
      if (bytes > MAX_COMPRESSED_BYTES) throw new Error('Compressed artifact too large');
      yield chunk;
    }
  };
  await pipeline(process.stdin, meter, createWriteStream(destination, { mode: 0o600 }));
}

async function main() {
  const { action, revision } = parseCommand(process.env.SSH_ORIGINAL_COMMAND);
  await mkdir(BASE, { recursive: true });
  const release = path.join(BASE, 'current', 'release.json');
  const unlock = await acquireLock(BASE);
  try {
    if (action === 'notify') {
      await notifyServer(revision);
      process.stdout.write(`Notification delivered for ${revision}\n`);
      return;
    }
    const current = await readFile(release, 'utf8').then(JSON.parse).catch(() => null);
    if (current?.revision === revision) {
      await verify(revision);
      process.stdout.write(`Already published ${revision}\n`);
      return;
    }
    const tempRoot = await mkdtemp(path.join(BASE, 'upload-'));
    const archive = path.join(tempRoot, 'website.tar.gz');
    try {
      await receiveArchive(archive);
      await publish(archive, revision);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  } finally {
    await unlock();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
