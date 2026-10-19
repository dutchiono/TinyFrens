import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildDocs } from './build-docs.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
execFileSync(process.execPath, [path.join(root, 'scripts/package-robots-launch.mjs'), '--check-files'], { stdio: 'inherit' });
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of ['index.html', 'site', 'web', 'play', 'game', 'updates', 'tokenomics', 'privacy', 'terms', 'discord']) {
  await cp(path.join(root, entry), path.join(output, entry), { recursive: true });
}
await rm(path.join(output, 'web/admin.html'), { force: true });
await rm(path.join(output, 'admin.html'), { force: true });
await rm(path.join(output, 'admin'), { recursive: true, force: true });
await cp(path.join(root, 'web', '.well-known'), path.join(output, '.well-known'), { recursive: true });
await cp(path.join(root, 'web', 'snap-v2.json'), path.join(output, 'snap-v2.json'));
await cp(path.join(root, 'web', 'icons'), path.join(output, 'icons'), { recursive: true });
await cp(path.join(root, 'skills/tinyfrens-connect/SKILL.md'), path.join(output, 'skill.md'));
await mkdir(path.join(output, 'import'), { recursive: true });
await cp(path.join(root, 'skills/tinyfrens-connect/SKILL.md'), path.join(output, 'import/skill.md'));
await mkdir(path.join(output, 'robots'), { recursive: true });
await cp(path.join(root, 'skills/tinyfrens-nft-skill.md'), path.join(output, 'robots/skill.md'));
await mkdir(path.join(output, 'NFTS/robotsv1'), { recursive: true });
await cp(path.join(root, 'skills/tinyfrens-nft-skill.md'), path.join(output, 'NFTS/robotsv1/skill.md'));
await cp(path.join(root, 'web/robots-launch'), path.join(output, 'robots/launch'), { recursive: true });
await cp(path.join(root, 'docs'), path.join(output, 'docs'), { recursive: true });
await buildDocs(root, output);
console.log('Built welcome page, web pet, icons, and Farcaster manifests in dist/');
