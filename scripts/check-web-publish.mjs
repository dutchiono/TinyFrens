import { appendFile } from 'node:fs/promises';

let current = null;
try {
  const response = await fetch('https://tinyfrens.lol/release.json', { signal: AbortSignal.timeout(15_000) });
  if (response.ok) current = (await response.json()).revision;
} catch {
  current = null;
}

await appendFile(process.env.GITHUB_OUTPUT, `publish=${current !== process.env.GITHUB_SHA}\n`);
