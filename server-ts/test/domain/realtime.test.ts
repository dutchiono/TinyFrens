import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, test } from 'node:test';
import { loadConfig } from '../../src/config.js';
import { createAppContext } from '../../src/context.js';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import { RealtimeHub, RealtimeSocket } from '../../src/domain/realtime.js';

class MemorySocket implements RealtimeSocket {
  readyState = 1;
  alive = true;
  messages: Record<string, any>[] = [];
  closes: Array<{ code?: number; reason?: string | Buffer }> = [];

  send(data: string): void {
    this.messages.push(JSON.parse(data));
  }

  close(code?: number, reason?: string | Buffer): void {
    this.closes.push({ code, reason });
    this.readyState = 3;
  }

  ofType(type: string): Record<string, any>[] {
    return this.messages.filter(message => message.type === type);
  }
}

function createHub() {
  let now = 1000;
  const db = createDbConnection(':memory:');
  runMigrations(db);
  const context = createAppContext(loadConfig({}), db, { now: () => now });
  const profile = (name: string) => JSON.stringify({ name, shape: 'cat', color: '#a474f1' });
  context.repos.pets.createPet('a', 'AAAAAAAA', crypto.createHash('sha256').update('token-a').digest('hex'), profile('Ada'));
  context.repos.pets.createPet('b', 'BBBBBBBB', crypto.createHash('sha256').update('token-b').digest('hex'), profile('Bob'));
  const hub = new RealtimeHub(context);
  return { hub, context, setNow: (value: number) => { now = value; } };
}

describe('Realtime hub protocol parity', () => {
  test('handles friendship, profile, party, visit, and battle flows', async () => {
    const { hub, context } = createHub();
    const alice = new MemorySocket();
    const bob = new MemorySocket();
    await hub.attach('a', alice);
    await hub.attach('b', bob);
    assert.equal(alice.ofType('state').at(-1)?.self.online, true);

    await hub.handle('a', { type: 'friend-request', code: 'BBBB-BBBB' });
    assert.equal(bob.ofType('state').at(-1)?.requests[0].id, 'a');
    await hub.handle('b', { type: 'friend-answer', id: 'a', accept: true });
    assert.equal(context.repos.pets.areFriends('a', 'b'), true);
    assert.equal(alice.ofType('state').at(-1)?.friends[0].id, 'b');

    await hub.handle('a', { type: 'party-join', room: 'public', pet: { name: 'Ada', shape: 'cat', color: '#a474f1' } });
    await hub.handle('b', { type: 'party-join', room: 'public', pet: { name: 'Bob', shape: 'blob', color: '#66c7d2' } });
    assert.equal(alice.ofType('party-state').at(-1)?.members.length, 2);
    await hub.handle('a', { type: 'party-action', action: 'heart', target: 'b', text: 'x'.repeat(150) });
    assert.equal(bob.ofType('party-action').at(-1)?.text.length, 100);
    await hub.handle('a', { type: 'profile', pet: { name: 'Ada 2', shape: 'bunny', color: '#ff82a7' } });
    assert.equal(bob.ofType('party-state').at(-1)?.members.find((member: any) => member.id === 'a').pet.name, 'Ada 2');

    await hub.handle('a', { type: 'visit-request', id: 'b' });
    const visitId = bob.ofType('visit-request').at(-1)?.id;
    assert.equal(typeof visitId, 'string');
    await hub.handle('b', { type: 'visit-answer', id: visitId, accept: true });
    assert.equal(alice.ofType('visit-start').at(-1)?.role, 'visitor');
    await hub.handle('a', { type: 'visit-action', id: visitId, action: 'wave' });
    assert.equal(bob.ofType('visit-action').at(-1)?.action, 'wave');
    await hub.handle('b', { type: 'visit-end', id: visitId });
    assert.equal(alice.ofType('visit-ended').at(-1)?.id, visitId);

    await hub.handle('a', { type: 'battle-request', id: 'b' });
    const battleId = bob.ofType('battle-request').at(-1)?.id;
    await hub.handle('b', { type: 'battle-answer', id: battleId, accept: true });
    assert.equal(alice.ofType('battle-start').at(-1)?.role, 'challenger');
    await hub.handle('a', { type: 'battle-action', id: battleId, action: 'boop' });
    assert.equal(bob.ofType('battle-action').at(-1)?.sender, 'a');
    await hub.handle('b', { type: 'battle-end', id: battleId });
    assert.equal(alice.ofType('battle-ended').at(-1)?.id, battleId);

    await hub.handle('a', { type: 'party-leave' });
    assert.equal(alice.ofType('party-state').at(-1)?.room, 'none');
    context.db.close();
  });

  test('expires pending and active sessions and cleans disconnect state', async () => {
    const { hub, context, setNow } = createHub();
    context.repos.pets.addFriendship('a', 'b');
    const alice = new MemorySocket();
    const bob = new MemorySocket();
    await hub.attach('a', alice);
    await hub.attach('b', bob);

    await hub.handle('a', { type: 'visit-request', id: 'b' });
    const pendingVisitId = bob.ofType('visit-request').at(-1)?.id;
    await hub.handle('a', { type: 'battle-request', id: 'b' });
    const pendingBattleId = bob.ofType('battle-request').at(-1)?.id;
    setNow(1061);
    await hub.cleanupExpired();
    assert.equal(alice.ofType('visit-request-ended').at(-1)?.id, pendingVisitId);
    assert.equal(bob.ofType('battle-request-ended').at(-1)?.id, pendingBattleId);

    setNow(2000);
    await hub.handle('a', { type: 'visit-request', id: 'b' });
    const visitId = bob.ofType('visit-request').at(-1)?.id;
    await hub.handle('b', { type: 'visit-answer', id: visitId, accept: true });
    await hub.handle('a', { type: 'battle-request', id: 'b' });
    const battleId = bob.ofType('battle-request').at(-1)?.id;
    await hub.handle('b', { type: 'battle-answer', id: battleId, accept: true });
    setNow(3801);
    await hub.cleanupExpired();
    assert.equal(alice.ofType('visit-ended').at(-1)?.id, visitId);
    assert.equal(alice.ofType('battle-ended').at(-1)?.id, battleId);

    await hub.handle('a', { type: 'party-join', room: 'chat', platform: 'telegram', chatId: '-100:room', pet: { name: 'Ada', shape: 'cat', color: '#a474f1' } });
    await hub.detach('a', alice);
    assert.equal(hub.sockets.has('a'), false);
    assert.equal(hub.roomByPet.has('a'), false);
    assert.equal(bob.ofType('state').at(-1)?.friends.find((friend: any) => friend.id === 'a').online, false);
    context.db.close();
  });

  test('closes an older duplicate socket and validates actions', async () => {
    const { hub, context } = createHub();
    const oldSocket = new MemorySocket();
    const newSocket = new MemorySocket();
    await hub.attach('a', oldSocket);
    await hub.attach('a', newSocket);
    assert.equal(oldSocket.closes[0]?.code, 4001);
    await assert.rejects(hub.handle('a', { type: 'unknown' }), /Unknown action/);
    await assert.rejects(hub.handle('a', { type: 'party-join', room: 'private', code: 'x', pet: { name: 'Ada', shape: 'cat', color: '#a474f1' } }), /party code/);
    context.db.close();
  });
});
