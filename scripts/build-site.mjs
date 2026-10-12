import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of ['index.html', 'site', 'web', 'play']) {
  await cp(path.join(root, entry), path.join(output, entry), { recursive: true });
}
await cp(path.join(root, 'web', '.well-known'), path.join(output, '.well-known'), { recursive: true });
await cp(path.join(root, 'web', 'snap-v2.json'), path.join(output, 'snap-v2.json'));
await cp(path.join(root, 'web', 'icons'), path.join(output, 'icons'), { recursive: true });
await cp(path.join(root, 'skills/tinyfrens-connect/SKILL.md'), path.join(output, 'skill.md'));
await mkdir(path.join(output, 'import'), { recursive: true });
await cp(path.join(root, 'skills/tinyfrens-connect/SKILL.md'), path.join(output, 'import/skill.md'));
console.log('Built welcome page, web pet, icons, and Farcaster manifests in dist/');
