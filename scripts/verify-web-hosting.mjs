import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';

const addressIndex = process.argv.indexOf('--address');
const address = addressIndex >= 0 ? process.argv[addressIndex + 1] : undefined;
if (addressIndex >= 0 && !address) throw new Error('--address requires a value');

function request(host, requestPath, { method = 'GET', headers = {}, body, secure = true } = {}) {
  const client = secure ? https : http;
  return new Promise((resolve, reject) => {
    const requestHandle = client.request({
      hostname: host,
      port: secure ? 443 : 80,
      path: requestPath,
      method,
      headers: { Host: host, ...headers },
      lookup: address ? (_hostname, options, callback) => {
        if (options.all) callback(null, [{ address, family: 4 }]);
        else callback(null, address, 4);
      } : undefined,
      servername: secure ? host : undefined,
      timeout: 20_000,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    requestHandle.on('timeout', () => requestHandle.destroy(new Error('Request timed out')));
    requestHandle.on('error', reject);
    if (body) requestHandle.write(body);
    requestHandle.end();
  });
}

for (const host of ['tinyfrens.lol', 'www.tinyfrens.lol']) {
  for (const [requestPath, expectedType] of [
    ['/', 'text/html'],
    ['/web/', 'text/html'],
    ['/web/gallery.html', 'text/html'],
    ['/web/robot-live.mjs', 'application/javascript'],
    ['/web/manifest.webmanifest', 'application/manifest+json'],
    ['/web/sw.js', 'application/javascript'],
    ['/docs/', 'text/html'],
    ['/server/WEB_HOSTING.html', 'text/html'],
    ['/.well-known/farcaster.json', 'application/json'],
    ['/snap-v2.json', 'application/vnd.farcaster.snap+json'],
    ['/import/skill.md', 'text/plain'],
  ]) {
    const response = await request(host, requestPath);
    assert.equal(response.status, 200, `${host}${requestPath}: HTTP ${response.status}`);
    assert.match(response.headers['content-type'] ?? '', new RegExp(expectedType.replace('+', '\\+')));
    assert.ok(response.body.length, `${host}${requestPath}: empty response`);
  }

  for (const requestPath of ['/', '/snap', '/api/snap']) {
    const response = await request(host, requestPath, { headers: { Accept: 'application/vnd.farcaster.snap+json' } });
    assert.equal(response.status, 200, `${host}${requestPath}: HTTP ${response.status}`);
    assert.match(response.headers['content-type'] ?? '', /application\/vnd\.farcaster\.snap\+json/);
    assert.equal(typeof JSON.parse(response.body.toString()), 'object');
    assert.equal(response.headers['access-control-allow-origin'], '*');
  }

  const interaction = await request(host, '/api/snap/interact?action=pet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(interaction.status, 200, `${host} Snap POST: HTTP ${interaction.status}`);

  for (const requestPath of ['/admin', '/api/admin/state', '/.env', '/web/admin.html']) {
    assert.equal((await request(host, requestPath)).status, 404, `${host}${requestPath} must not be public`);
  }

  for (const [requestPath, destination] of [['/skill.md', '/import/skill.md'], ['/web/robot-preview.html', '/web/gallery.html']]) {
    const response = await request(host, requestPath);
    assert.ok([301, 308].includes(response.status));
    assert.ok(response.headers.location?.endsWith(destination));
  }

  const redirect = await request(host, '/', { secure: false });
  assert.ok([301, 308].includes(redirect.status));
  assert.equal(redirect.headers.location, `https://${host}/`);
  process.stdout.write(`${host}: HTTPS, site/app/gallery, manifests, skills, Snap GET/POST, redirects and private-path checks passed\n`);
}
