import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

function immutableImage(name) {
  const value = process.env[name];
  assert.ok(value, `${name} is required`);
  assert.match(value, /@sha256:[a-f0-9]{64}$/i, `${name} must use an immutable sha256 digest`);
}

async function hash(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

immutableImage('TINYFRENS_PYTHON_SHADOW_IMAGE');
immutableImage('TINYFRENS_TYPESCRIPT_SHADOW_IMAGE');

const shadowRoot = process.env.SHADOW_ROOT;
assert.ok(shadowRoot, 'SHADOW_ROOT is required');
const python = path.join(path.resolve(shadowRoot), 'python.db');
const typescript = path.join(path.resolve(shadowRoot), 'typescript.db');
const [pythonPath, typescriptPath, pythonStat, typescriptStat] = await Promise.all([
  realpath(python),
  realpath(typescript),
  stat(python),
  stat(typescript),
]);
assert.notEqual(pythonPath, typescriptPath, 'Shadow services must use different database files');
assert.ok(pythonStat.isFile() && typescriptStat.isFile(), 'Shadow databases must be regular files');
assert.equal(await hash(python), await hash(typescript), 'Shadow databases must start byte-identical');

process.stdout.write('Shadow configuration validated.\n');
