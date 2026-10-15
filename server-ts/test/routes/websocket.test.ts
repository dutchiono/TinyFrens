import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createAppContext } from '../../src/context.js';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';

function nextMessage(socket: WebSocket): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for socket message')), 2000);
    socket.once('message', raw => {
      clearTimeout(timer);
      resolve(JSON.parse(raw.toString()));
    });
  });
}

function nextClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise(resolve => socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
}

describe('WebSocket route parity', () => {
  let app: FastifyInstance;
  let context: ReturnType<typeof createAppContext>;

  before(async () => {
    const db = createDbConnection(':memory:');
    runMigrations(db);
    context = createAppContext(loadConfig({ ALLOWED_ORIGINS: 'https://tinyfrens.lol' }), db, { now: () => 1000 });
    context.repos.pets.createPet(
      'pet-a',
      'AAAAAAAA',
      crypto.createHash('sha256').update('secret-token').digest('hex'),
      JSON.stringify({ name: 'Ada', shape: 'cat', color: '#a474f1' })
    );
    app = await buildApp({ context });
    await app.ready();
  });

  after(async () => {
    for (const socket of app.websocketServer.clients) socket.terminate();
    await app.close();
  });

  test('authenticates, sends state, reports action errors, and replaces duplicate sessions', async () => {
    const first = await app.injectWS('/ws', { headers: { origin: 'https://tinyfrens.lol' } });
    const firstState = nextMessage(first);
    first.send(JSON.stringify({ type: 'auth', token: 'secret-token' }));
    assert.equal((await firstState).type, 'state');

    const actionError = nextMessage(first);
    first.send(JSON.stringify({ type: 'not-real' }));
    assert.match((await actionError).text, /Unknown action/);

    const duplicateClose = nextClose(first);
    const second = await app.injectWS('/ws', { headers: { origin: 'https://tinyfrens.lol' } });
    const secondState = nextMessage(second);
    second.send(JSON.stringify({ type: 'auth', token: 'secret-token' }));
    assert.equal((await secondState).self.id, 'pet-a');
    assert.equal((await duplicateClose).code, 4001);
    const secondClose = nextClose(second);
    second.close();
    await secondClose;
  });

  test('rejects invalid credentials with close code 4003', async () => {
    const socket = await app.injectWS('/ws', { headers: { origin: 'https://tinyfrens.lol' } });
    const closed = nextClose(socket);
    socket.send(JSON.stringify({ type: 'auth', token: 'wrong' }));
    assert.equal((await closed).code, 4003);
  });

  test('enforces the 4096-byte websocket message limit', async () => {
    const socket = await app.injectWS('/ws', { headers: { origin: 'https://tinyfrens.lol' } });
    const closed = nextClose(socket);
    socket.send('x'.repeat(4097));
    assert.equal((await closed).code, 1009);
  });

  test('origin guard rejects disallowed websocket upgrades', async () => {
    await assert.rejects(
      app.injectWS('/ws', { headers: { origin: 'https://evil.example' } }),
      /Unexpected server response: 403/
    );
  });
});
