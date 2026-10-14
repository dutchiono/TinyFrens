import assert from 'node:assert';
import { after, before, describe, test } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import { createAppContext } from '../../src/context.js';
import { Config, loadConfig } from '../../src/config.js';

describe('Snap Frame Routes Parity (GET/POST /snap, /api/snap, /api/snap/interact)', () => {
  let app: FastifyInstance;
  let sharedContext: ReturnType<typeof createAppContext>;
  let testConfig: Config;

  before(async () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);

    testConfig = loadConfig({
      PET_DOMAIN: 'tinyfrens.lol',
      ORIGIN: 'https://tinyfrens.lol',
      ALLOWED_ORIGINS: 'https://tinyfrens.lol,https://www.tinyfrens.lol',
    });

    sharedContext = createAppContext(testConfig, db, {
      now: () => 1000,
    });

    app = await buildApp({ context: sharedContext });
  });

  after(async () => {
    await app.close();
  });

  describe('GET snap endpoints', () => {
    test('returns snap JSON with Accept: application/vnd.farcaster.snap+json', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/snap',
        headers: {
          accept: 'application/vnd.farcaster.snap+json',
        },
      });

      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.headers['content-type']?.includes('application/vnd.farcaster.snap+json'));
      assert.strictEqual(res.headers['vary'], 'Accept');
      assert.ok(res.headers['link']?.includes('rel="alternate"'));

      const data = res.json();
      assert.strictEqual(data.version, '2.0');
      assert.deepStrictEqual(data.theme, { accent: 'purple' });
      assert.strictEqual(data.ui.root, 'page');
      assert.ok(data.ui.elements['btn-pet']);
      assert.ok(data.ui.elements['btn-feed']);
      assert.ok(data.ui.elements['btn-play']);
      assert.ok(data.ui.elements['open-miniapp-btn']);
    });

    test('recognizes on-chain NFT id trait generation in snap payload', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/snap?nft=42',
        headers: {
          accept: 'application/vnd.farcaster.snap+json',
        },
      });

      assert.strictEqual(res.statusCode, 200);
      const data = res.json();
      assert.ok(data.ui.elements.header.props.content.startsWith('TinyFren #42 · '));
      assert.ok(data.ui.elements['hero-img'].props.subtitle.includes('Public Plaza'));
      assert.ok(data.ui.elements['open-miniapp-btn'].on.press.params.target.includes('nft=42'));
    });

    test('recognizes custom pet name and species', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/snap?name=Mochi&species=Cat',
        headers: {
          accept: 'application/vnd.farcaster.snap+json',
        },
      });

      assert.strictEqual(res.statusCode, 200);
      const data = res.json();
      assert.strictEqual(data.ui.elements.header.props.content, 'Mochi · Cat');
      assert.ok(data.ui.elements['hero-img'].props.subtitle.includes('Mochi is hanging out'));
    });

    test('returns HTML fallback when Accept is text/html without snap JSON', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/snap?name=Mochi&species=Cat',
        headers: {
          accept: 'text/html,application/xhtml+xml',
        },
      });

      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.headers['content-type']?.includes('text/html'));
      assert.ok(res.body.includes('Mochi · Cat · Farcaster Snap'));
      assert.ok(res.body.includes('Open Full Web App 🐾'));
    });
  });

  describe('POST snap interaction endpoints', () => {
    test('handles action in query params with confetti effect', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/snap/interact?action=feed&name=Mochi&species=Cat',
      });

      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.headers['content-type']?.includes('application/vnd.farcaster.snap+json'));
      const data = res.json();
      assert.deepStrictEqual(data.effects, ['confetti']);
      assert.ok(data.ui.elements['hero-img'].props.subtitle.includes('fed Mochi a fresh strawberry'));
    });

    test('handles action in raw JSON body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/snap/interact?name=Wiggles',
        payload: {
          action: 'pet',
        },
      });

      assert.strictEqual(res.statusCode, 200);
      const data = res.json();
      assert.deepStrictEqual(data.effects, ['confetti']);
      assert.ok(data.ui.elements['hero-img'].props.subtitle.includes('petted Wiggles'));
    });

    test('handles action in base64url encoded payload', async () => {
      const inner = JSON.stringify({ inputs: { action: 'play' } });
      const b64 = Buffer.from(inner).toString('base64url');

      const res = await app.inject({
        method: 'POST',
        url: '/api/snap/interact?name=Tumble',
        payload: {
          payload: b64,
        },
      });

      assert.strictEqual(res.statusCode, 200);
      const data = res.json();
      assert.deepStrictEqual(data.effects, ['confetti']);
      assert.ok(data.ui.elements['hero-img'].props.subtitle.includes('played ball with Tumble'));
    });
  });
});
