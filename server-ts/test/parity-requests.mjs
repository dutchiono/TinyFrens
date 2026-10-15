import assert from 'node:assert/strict';

export const parityRequests = [
  { name: 'health', path: '/health' },
  { name: 'static asset', path: '/web/app.js' },
  { name: 'snap default response', path: '/' },
  { name: 'snap HTML', path: '/', headers: { accept: 'text/html' } },
  { name: 'snap JSON', path: '/api/snap', headers: { accept: 'application/vnd.farcaster.snap+json' } },
  { name: 'Farcaster manifest', path: '/.well-known/farcaster.json' },
  { name: 'Bankr status', path: '/api/bankr/status', headers: { origin: 'https://tinyfrens.lol' } },
  { name: 'economy status', path: '/api/economy/status', headers: { origin: 'https://tinyfrens.lol' } },
  { name: 'empty suggestions', path: '/api/collections/suggestions', headers: { origin: 'https://tinyfrens.lol' } },
  { name: 'vote status', path: '/api/vote/status', headers: { origin: 'https://tinyfrens.lol' } },
  { name: 'gallery collections', path: '/api/gallery/collections', headers: { origin: 'https://tinyfrens.lol' } },
  { name: 'push key', path: '/api/push/public-key', headers: { origin: 'https://tinyfrens.lol' } },
  {
    name: 'generic preflight',
    method: 'OPTIONS',
    path: '/api/wallet-link/status',
    headers: { origin: 'https://tinyfrens.lol' },
  },
  {
    name: 'rejected origin',
    method: 'POST',
    path: '/api/register',
    headers: { 'content-type': 'application/json', origin: 'https://malicious.example' },
    body: '{}',
  },
  {
    name: 'rejected registration',
    method: 'POST',
    path: '/api/register',
    headers: { 'content-type': 'application/json', origin: 'https://tinyfrens.lol' },
    body: '{}',
  },
  {
    name: 'malformed JSON registration',
    method: 'POST',
    path: '/api/register',
    headers: { 'content-type': 'application/json', origin: 'https://tinyfrens.lol' },
    body: '{',
  },
  {
    name: 'oversized registration',
    method: 'POST',
    path: '/api/register',
    headers: { 'content-type': 'application/json', origin: 'https://tinyfrens.lol' },
    body: JSON.stringify({ pet: { name: 'x'.repeat(5000) } }),
  },
];

export async function snapshot(baseUrl, request) {
  const response = await fetch(`${baseUrl}${request.path}`, {
    method: request.method || 'GET',
    headers: request.headers,
    body: request.body,
    redirect: 'manual',
  });
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('/json') || contentType.includes('+json');
  const body = isJson
    ? await response.json()
    : Buffer.from(await response.arrayBuffer()).toString('base64');
  const headers = {};
  for (const name of [
    'access-control-allow-headers',
    'access-control-allow-methods',
    'access-control-allow-origin',
    'cache-control',
    'content-type',
    'link',
    'vary',
  ]) {
    const value = response.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return { status: response.status, headers, body };
}

export async function compareServers(pythonUrl, typescriptUrl) {
  const comparisons = [];
  for (const request of parityRequests) {
    const method = request.method || 'GET';
    const safeRead = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
    const rejectedRegistration = method === 'POST' && request.path === '/api/register';
    assert.ok(safeRead || rejectedRegistration, `${request.name} is not safe for shadow replay`);
    const [expected, actual] = await Promise.all([
      snapshot(pythonUrl, request),
      snapshot(typescriptUrl, request),
    ]);
    assert.deepEqual(actual, expected, `${request.name} diverged`);
    comparisons.push(request.name);
  }
  return comparisons;
}
