import { appendFile } from 'node:fs/promises';

const expected = process.env.GITHUB_SHA;
if (!/^[0-9a-f]{40}$/.test(expected || '')) {
  throw new Error('GITHUB_SHA must be a full lowercase Git revision');
}

let current = '';
try {
  const response = await fetch('https://tinyfrens.miono.live/health/revision', {
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok) current = String((await response.json()).revision || '');
} catch {
  // An unreachable or old server needs reconciliation too.
}

const output = process.env.GITHUB_OUTPUT;
if (!output) throw new Error('GITHUB_OUTPUT is unavailable');
await appendFile(output, `deploy=${current !== expected}\n`, 'utf8');
