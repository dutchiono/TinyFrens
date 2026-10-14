// Build docs offline with marked 15.0.12 (MIT; bundled in vendor/).
import { marked } from './vendor/marked.mjs';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

export async function buildDocs(root, output) {
  const files = (await readdir(path.join(root, 'docs'))).filter(name => name.endsWith('.md')).map(name => 'docs/' + name);
  files.push('README.md', 'GITHUB_SETUP.md', 'GAMEPLAY.md', 'ONCHAIN-ECONOMY.md',
    'server/README.md', 'server/WEB_HOSTING.md', 'ios/README.md', 'desktop/README.md', 'TELEGRAM-DISCORD.md');
  const available = new Set(files);
  for (const file of files) {
    const source = await readFile(path.join(root, file), 'utf8');
    let html = marked.parse(source);
    html = html.replace(/href="([^"#]+)(#[^"]*)?"/g, (match, href, fragment = '') => {
      if (/^(https?:|mailto:|\/)/.test(href)) return match;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), href));
      return available.has(target)
        ? `href="/${target.replace(/\.md$/, '.html')}${fragment}"`
        : `href="https://github.com/dutchiono/TinyFrens/blob/main/${target}${fragment}"`;
    });
    const title = (source.match(/^#\s+(.+)$/m)?.[1] || 'TinyFrens docs').replace(/[<>&"]/g, '');
    const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline'; img-src 'self' https: data:"><title>${title}</title><style>body{max-width:900px;margin:auto;padding:24px;color:#eee8fa;background:#17142a;font:16px/1.65 system-ui}a{color:#c9a5ff}pre{padding:16px;background:#211c39;overflow:auto}code{overflow-wrap:anywhere}table{display:block;overflow:auto;border-collapse:collapse}td,th{padding:8px;border:1px solid #544177}img{max-width:100%}nav{display:flex;gap:24px;margin-bottom:32px}h1,h2,h3{line-height:1.3}</style></head><body><nav><a href="/">TinyFrens</a><a href="/docs/">Docs</a><a href="/web/">Open app</a></nav><main>${html}</main></body></html>`;
    const destination = path.join(output, file.replace(/\.md$/, '.html'));
    await mkdir(path.dirname(destination), {recursive:true}); await writeFile(destination, page);
    if (file === 'docs/README.md') await writeFile(path.join(output, 'docs/index.html'), page);
  }
}
