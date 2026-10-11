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
console.log('Built welcome page and web pet in dist/');
