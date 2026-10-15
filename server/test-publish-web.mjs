import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { parseCommand, publish, REQUIRED, unpack, validateRelativePath } from './publish-web.mjs';

async function fixtureArchive(root, omit = null) {
  const source = path.join(root, 'source');
  await mkdir(source, { recursive: true });
  for (const name of REQUIRED) {
    if (name === omit) continue;
    const target = path.join(source, ...name.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, 'public fixture');
  }
  const archive = path.join(root, `site-${Math.random()}.tar.gz`);
  const result = spawnSync('tar', ['-czf', archive, '-C', source, '.'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return archive;
}

test('restricted command accepts only publish and notify with a full SHA', () => {
  const revision = 'a'.repeat(40);
  assert.deepEqual(parseCommand(`publish ${revision}`), { action: 'publish', revision });
  assert.deepEqual(parseCommand(`notify ${revision}`), { action: 'notify', revision });
  for (const command of ['notify main', `notify ${revision} extra`, `sh -c notify ${revision}`, '']) {
    assert.throws(() => parseCommand(command));
  }
});

test('archive paths reject traversal, private files, and admin files', () => {
  for (const name of ['../escape', '/absolute', '.env', 'web/.git/config', 'web/admin.html', 'admin/private']) {
    assert.throws(() => validateRelativePath(name));
  }
  assert.equal(validateRelativePath('./web/index.html'), 'web/index.html');
});

test('complete release publishes and failed verification rolls back', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tinyfrens-publish-'));
  try {
    const base = path.join(root, 'site');
    const first = await fixtureArchive(path.join(root, 'first'));
    await publish(first, 'a'.repeat(40), base, async () => undefined);
    assert.equal(JSON.parse(await readFile(path.join(base, 'current/release.json'), 'utf8')).revision, 'a'.repeat(40));
    const previous = JSON.parse(await readFile(path.join(base, 'current/release.json'), 'utf8')).revision;
    const second = await fixtureArchive(path.join(root, 'second'));
    await assert.rejects(
      publish(second, 'b'.repeat(40), base, async () => { throw new Error('verification failed'); }),
      /verification failed/
    );
    assert.equal(JSON.parse(await readFile(path.join(base, 'current/release.json'), 'utf8')).revision, previous);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('missing required files fail before publication', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tinyfrens-publish-missing-'));
  try {
    const archive = await fixtureArchive(root, 'web/sw.js');
    await assert.rejects(unpack(archive, path.join(root, 'output')), /Missing required public file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
