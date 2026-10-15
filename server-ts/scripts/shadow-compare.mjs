import assert from 'node:assert/strict';
import { compareServers, parityRequests } from '../test/parity-requests.mjs';

function requiredUrl(name) {
  const value = process.env[name];
  assert.ok(value, `${name} is required`);
  const url = new URL(value);
  assert.ok(['http:', 'https:'].includes(url.protocol), `${name} must use http or https`);
  assert.equal(url.username, '', `${name} must not contain credentials`);
  assert.equal(url.password, '', `${name} must not contain credentials`);
  return url.toString().replace(/\/$/, '');
}

assert.equal(
  process.env.SHADOW_CONFIRM,
  'side-effects-disabled',
  'Set SHADOW_CONFIRM=side-effects-disabled only after both staging services have outbound side effects disabled.'
);

const pythonUrl = requiredUrl('PYTHON_SHADOW_URL');
const typescriptUrl = requiredUrl('TYPESCRIPT_SHADOW_URL');
assert.notEqual(pythonUrl, typescriptUrl, 'Python and TypeScript shadow URLs must be different');

await compareServers(pythonUrl, typescriptUrl);
process.stdout.write(`Shadow comparison passed for ${parityRequests.length} side-effect-free requests.\n`);
