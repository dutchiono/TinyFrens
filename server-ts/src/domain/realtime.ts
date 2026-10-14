import crypto from 'node:crypto';
import { AppContext } from '../context.js';
import { normalizeProfile, PetProfile } from './profile.js';
import { pushOffline } from './push.js';

export interface RealtimeSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string | Buffer): void;
  ping?(): void;
  terminate?(): void;
  alive?: boolean;
}

interface Session {
  sender: string;
  receiver: string;
  expires: number;
}

interface RoomMember {
  pet: PetProfile;
  updated: number;
}

export class RealtimeHub {
  readonly sockets = new Map<string, RealtimeSocket>();
  readonly visits = new Map<string, Session>();
  readonly pendingVisits = new Map<string, Session>();
  readonly battles = new Map<string, Session>();
  readonly pendingBattles = new Map<string, Session>();
  readonly rooms = new Map<string, Map<string, RoomMember>>();
  readonly roomByPet = new Map<string, string>();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pendingTasks = new Set<Promise<unknown>>();

  constructor(private context: AppContext) {}

  start(): void {
    if (!this.cleanupTimer) {
      this.cleanupTimer = setInterval(() => this.cleanupExpired(), 5_000);
      this.cleanupTimer.unref();
    }
    if (!this.heartbeatTimer) {
      this.heartbeatTimer = setInterval(() => {
        for (const socket of this.sockets.values()) {
          if (socket.alive === false) {
            socket.terminate?.();
            continue;
          }
          socket.alive = false;
          socket.ping?.();
        }
      }, 30_000);
      this.heartbeatTimer.unref();
    }
  }

  track(task: Promise<unknown>): void {
    this.pendingTasks.add(task);
    void task.then(
      () => this.pendingTasks.delete(task),
      () => this.pendingTasks.delete(task)
    );
  }

  async stop(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.cleanupTimer = null;
    this.heartbeatTimer = null;
    for (const socket of this.sockets.values()) socket.close(1001, 'Server stopping');
    await Promise.resolve();
    while (this.pendingTasks.size > 0) {
      await Promise.allSettled([...this.pendingTasks]);
    }
    this.sockets.clear();
    this.rooms.clear();
    this.roomByPet.clear();
    this.visits.clear();
    this.pendingVisits.clear();
    this.battles.clear();
    this.pendingBattles.clear();
  }

  async attach(petId: string, socket: RealtimeSocket): Promise<void> {
    const existing = this.sockets.get(petId);
    if (existing && existing !== socket) existing.close(4001, 'Opened on another screen');
    socket.alive = true;
    this.sockets.set(petId, socket);
    await this.sendState(petId);
    for (const friend of this.context.repos.pets.getFriends(petId)) await this.sendState(friend);
  }

  async detach(petId: string, socket: RealtimeSocket): Promise<void> {
    if (this.sockets.get(petId) !== socket) return;
    this.sockets.delete(petId);
    await this.leaveRoom(petId);
    for (const [id, visit] of [...this.visits]) {
      if (this.inSession(visit, petId)) await this.endVisit(id);
    }
    for (const [id, visit] of [...this.pendingVisits]) {
      if (this.inSession(visit, petId)) this.pendingVisits.delete(id);
    }
    for (const [id, battle] of [...this.battles]) {
      if (this.inSession(battle, petId)) await this.endBattle(id);
    }
    for (const [id, battle] of [...this.pendingBattles]) {
      if (this.inSession(battle, petId)) this.pendingBattles.delete(id);
    }
    for (const friend of this.context.repos.pets.getFriends(petId)) await this.sendState(friend);
  }

  async handle(petId: string, message: unknown): Promise<void> {
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid message');
    const input = message as Record<string, unknown>;
    const type = input.type;
    if (type === 'profile') await this.updateProfile(petId, input);
    else if (type === 'party-join') await this.joinParty(petId, input);
    else if (type === 'party-leave') await this.partyLeave(petId);
    else if (type === 'party-action') await this.partyAction(petId, input);
    else if (type === 'friend-request') await this.friendRequest(petId, input);
    else if (type === 'friend-answer') await this.friendAnswer(petId, input);
    else if (type === 'friend-remove') await this.friendRemove(petId, input);
    else if (type === 'visit-request') await this.visitRequest(petId, input);
    else if (type === 'visit-answer') await this.visitAnswer(petId, input);
    else if (type === 'visit-end') await this.visitEnd(petId, input);
    else if (type === 'visit-action') await this.visitAction(petId, input);
    else if (type === 'battle-request') await this.battleRequest(petId, input);
    else if (type === 'battle-answer') await this.battleAnswer(petId, input);
    else if (type === 'battle-action') await this.battleAction(petId, input);
    else if (type === 'battle-end') await this.battleEnd(petId, input);
    else throw new Error('Unknown action');
  }

  async cleanupExpired(): Promise<void> {
    const now = this.context.now();
    for (const [id, visit] of [...this.visits]) {
      if (visit.expires < now) await this.endVisit(id);
    }
    for (const [id, visit] of [...this.pendingVisits]) {
      if (visit.expires < now) {
        this.pendingVisits.delete(id);
        await this.sendSession(visit, { type: 'visit-request-ended', id });
      }
    }
    for (const [id, battle] of [...this.battles]) {
      if (battle.expires < now) await this.endBattle(id);
    }
    for (const [id, battle] of [...this.pendingBattles]) {
      if (battle.expires < now) {
        this.pendingBattles.delete(id);
        await this.sendSession(battle, { type: 'battle-request-ended', id });
      }
    }
    this.context.rateLimiter.prune(now, 3600);
  }

  pet(petId: string): Record<string, unknown> {
    const row = this.context.repos.pets.findById(petId);
    if (!row) throw new Error('Device credential not recognized');
    return {
      id: petId,
      code: row.code,
      pet: JSON.parse(row.profile),
      online: this.sockets.has(petId),
    };
  }

  private async updateProfile(petId: string, input: Record<string, unknown>): Promise<void> {
    const profile = normalizeProfile(input.pet);
    this.context.repos.pets.updateProfile(petId, JSON.stringify(profile));
    for (const friend of this.context.repos.pets.getFriends(petId)) await this.sendState(friend);
    for (const [id, visit] of this.visits) {
      if (visit.sender === petId) await this.send(visit.receiver, { type: 'visit-profile', id, pet: profile });
    }
    const room = this.roomByPet.get(petId);
    if (room) {
      this.rooms.get(room)?.set(petId, { pet: profile, updated: this.context.now() });
      await this.sendRoomState(room);
    }
  }

  private async joinParty(petId: string, input: Record<string, unknown>): Promise<void> {
    this.context.rateLimiter.limit(`party:${petId}`, 20, 3600, this.context.now());
    const profile = normalizeProfile(input.pet);
    const mode = String(input.room || 'public').toLowerCase();
    let room: string;
    if (mode === 'public') room = 'public';
    else if (mode === 'chat') {
      const platform = String(input.platform || '').toLowerCase();
      if (platform !== 'telegram' && platform !== 'discord') throw new Error('Unknown chat platform');
      const chatId = String(input.chatId || '').replace(/[^0-9A-Za-z:_-]/g, '').slice(0, 64);
      if (!chatId) throw new Error('Missing chat id');
      room = `${platform === 'telegram' ? 'tg' : 'dc'}:${chatId}`;
    } else if (mode === 'private') {
      const code = String(input.code || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24);
      if (code.length < 3 || code.length > 24) throw new Error('Enter a party code');
      room = `private:${code}`;
    } else throw new Error('Unknown party room');
    if ((this.rooms.get(room)?.size || 0) >= 80) throw new Error('That party room is full');
    await this.leaveRoom(petId);
    let members = this.rooms.get(room);
    if (!members) {
      members = new Map();
      this.rooms.set(room, members);
    }
    this.roomByPet.set(petId, room);
    members.set(petId, { pet: profile, updated: this.context.now() });
    await this.sendRoomState(room);
  }

  private async partyLeave(petId: string): Promise<void> {
    await this.leaveRoom(petId);
    await this.send(petId, { type: 'party-state', room: 'none', code: '', members: [] });
  }

  private async partyAction(petId: string, input: Record<string, unknown>): Promise<void> {
    const room = this.roomByPet.get(petId);
    const member = room ? this.rooms.get(room)?.get(petId) : null;
    if (!room || !member) return;
    const action = String(input.action || 'wave').toLowerCase();
    if (!['wave', 'dance', 'berry', 'pet', 'heart'].includes(action)) return;
    const payload: Record<string, unknown> = { type: 'party-action', sender: petId, action, pet: member.pet };
    if (input.target) payload.target = input.target;
    if (input.text) payload.text = String(input.text).slice(0, 100);
    for (const other of this.rooms.get(room)?.keys() || []) await this.send(other, payload);
  }

  private async friendRequest(petId: string, input: Record<string, unknown>): Promise<void> {
    this.context.rateLimiter.limit(`requests:${petId}`, 15, 3600, this.context.now());
    const code = String(input.code || '').replace(/[- ]/g, '').toUpperCase();
    const otherRow = this.context.repos.pets.findByCode(code);
    if (!otherRow || otherRow.id === petId) throw new Error('Check your friend’s code');
    const other = otherRow.id;
    if (this.context.repos.pets.areFriends(petId, other)) throw new Error('Already friends');
    if (this.context.repos.pets.getIncomingRequests(other).length >= 30) throw new Error('Try again later');
    const alreadyPending = this.context.repos.pets.getOutgoingRequests(petId).includes(other);
    this.context.repos.pets.createRequest(petId, other);
    await this.sendState(other);
    await this.send(petId, { type: 'notice', text: 'Friend request sent. They need to accept.' });
    if (!alreadyPending) this.pushWhenOffline(other, 'New friend request', `${this.profileName(petId)} wants to be friends with your fren.`);
  }

  private async friendAnswer(petId: string, input: Record<string, unknown>): Promise<void> {
    const other = String(input.id || '');
    if (!this.context.repos.pets.getIncomingRequests(petId).includes(other)) throw new Error('Request no longer available');
    if (input.accept === true) {
      if (this.context.repos.pets.getFriends(petId).length >= 100 || this.context.repos.pets.getFriends(other).length >= 100) {
        throw new Error('Friends list is full');
      }
      this.context.repos.pets.addFriendship(petId, other);
    } else {
      this.context.repos.pets.deleteRequest(other, petId);
    }
    await this.sendState(petId);
    await this.sendState(other);
    if (input.accept === true) this.pushWhenOffline(other, 'Friend request accepted', `${this.profileName(petId)} is now friends with your fren.`);
  }

  private async friendRemove(petId: string, input: Record<string, unknown>): Promise<void> {
    const other = String(input.id || '');
    this.context.repos.pets.removeFriendship(petId, other);
    for (const [id, visit] of [...this.visits]) if (this.samePair(visit, petId, other)) await this.endVisit(id);
    for (const [id, visit] of [...this.pendingVisits]) if (this.samePair(visit, petId, other)) this.pendingVisits.delete(id);
    for (const [id, battle] of [...this.battles]) if (this.samePair(battle, petId, other)) await this.endBattle(id);
    for (const [id, battle] of [...this.pendingBattles]) if (this.samePair(battle, petId, other)) this.pendingBattles.delete(id);
    await this.sendState(petId);
    await this.sendState(other);
  }

  private async visitRequest(petId: string, input: Record<string, unknown>): Promise<void> {
    this.context.rateLimiter.limit(`visits:${petId}`, 12, 60, this.context.now());
    const other = String(input.id || '');
    if (!this.context.repos.pets.areFriends(petId, other) || !this.sockets.has(other)) {
      throw new Error('Your friend needs to open TinyFrens first');
    }
    if (this.sessionBusy(petId, other, this.visits, this.pendingVisits)) throw new Error('Finish the current visit first');
    const id = crypto.randomBytes(12).toString('hex');
    this.pendingVisits.set(id, { sender: petId, receiver: other, expires: this.context.now() + 60 });
    await this.send(other, { type: 'visit-request', id, friend: this.pet(petId) });
    await this.send(petId, { type: 'notice', text: 'Visit requested. Waiting for your friend.' });
  }

  private async visitAnswer(petId: string, input: Record<string, unknown>): Promise<void> {
    const id = String(input.id || '');
    const visit = this.pendingVisits.get(id);
    if (!visit || visit.receiver !== petId || visit.expires < this.context.now()) throw new Error('Visit request expired');
    this.pendingVisits.delete(id);
    if (input.accept === true && this.sockets.has(visit.sender) && this.context.repos.pets.areFriends(petId, visit.sender)) {
      visit.expires = this.context.now() + 1800;
      this.visits.set(id, visit);
      await this.send(petId, { type: 'visit-start', id, role: 'host', pet: (this.pet(visit.sender).pet), expires: Math.trunc(visit.expires * 1000) });
      await this.send(visit.sender, { type: 'visit-start', id, role: 'visitor', friend: this.pet(petId), expires: Math.trunc(visit.expires * 1000) });
    } else await this.send(visit.sender, { type: 'notice', text: 'Not visiting right now.' });
  }

  private async visitEnd(petId: string, input: Record<string, unknown>): Promise<void> {
    const id = String(input.id || '');
    const visit = this.visits.get(id);
    if (!visit || !this.inSession(visit, petId)) throw new Error('Visit no longer available');
    await this.endVisit(id);
  }

  private async visitAction(petId: string, input: Record<string, unknown>): Promise<void> {
    const id = String(input.id || '');
    const visit = this.visits.get(id);
    if (!visit || !this.inSession(visit, petId) || (input.action !== 'wave' && input.action !== 'dance')) {
      throw new Error('Invalid visit action');
    }
    await this.sendSession(visit, { type: 'visit-action', id, action: input.action });
  }

  private async battleRequest(petId: string, input: Record<string, unknown>): Promise<void> {
    this.context.rateLimiter.limit(`battles:${petId}`, 12, 60, this.context.now());
    const other = String(input.id || '');
    if (!this.context.repos.pets.areFriends(petId, other) || !this.sockets.has(other)) {
      throw new Error('Your friend needs to open TinyFrens first');
    }
    if (this.sessionBusy(petId, other, this.battles, this.pendingBattles)) throw new Error('Finish the current spar first');
    const id = crypto.randomBytes(12).toString('hex');
    this.pendingBattles.set(id, { sender: petId, receiver: other, expires: this.context.now() + 60 });
    await this.send(other, { type: 'battle-request', id, friend: this.pet(petId) });
    await this.send(petId, { type: 'notice', text: 'Spar requested. Waiting for your friend.' });
    this.pushWhenOffline(other, 'TinyFrens Spar Challenge!', `${this.profileName(petId)} challenged your fren to a spar!`);
  }

  private async battleAnswer(petId: string, input: Record<string, unknown>): Promise<void> {
    const id = String(input.id || '');
    const battle = this.pendingBattles.get(id);
    if (!battle || battle.receiver !== petId || battle.expires < this.context.now()) throw new Error('Battle request expired');
    this.pendingBattles.delete(id);
    if (input.accept === true && this.sockets.has(battle.sender) && this.context.repos.pets.areFriends(petId, battle.sender)) {
      battle.expires = this.context.now() + 600;
      this.battles.set(id, battle);
      await this.send(petId, { type: 'battle-start', id, role: 'defender', friend: this.pet(battle.sender), expires: Math.trunc(battle.expires * 1000) });
      await this.send(battle.sender, { type: 'battle-start', id, role: 'challenger', friend: this.pet(petId), expires: Math.trunc(battle.expires * 1000) });
    } else await this.send(battle.sender, { type: 'notice', text: 'Not sparring right now.' });
  }

  private async battleAction(petId: string, input: Record<string, unknown>): Promise<void> {
    const id = String(input.id || '');
    const battle = this.battles.get(id);
    if (!battle || !this.inSession(battle, petId)) throw new Error('Invalid battle action');
    await this.sendSession(battle, { type: 'battle-action', id, sender: petId, action: String(input.action || 'boop') });
  }

  private async battleEnd(petId: string, input: Record<string, unknown>): Promise<void> {
    const id = String(input.id || '');
    const battle = this.battles.get(id);
    if (!battle || !this.inSession(battle, petId)) throw new Error('Battle no longer available');
    await this.endBattle(id);
  }

  private async sendState(petId: string): Promise<void> {
    if (!this.context.repos.pets.findById(petId)) return;
    const friends = this.context.repos.pets.getFriends(petId).map(id => this.pet(id));
    const requests = this.context.repos.pets.getIncomingRequests(petId).map(id => this.pet(id));
    await this.send(petId, { type: 'state', self: this.pet(petId), friends, requests });
  }

  private async send(petId: string, payload: Record<string, unknown>): Promise<void> {
    const socket = this.sockets.get(petId);
    if (socket?.readyState === 1) socket.send(JSON.stringify(payload));
  }

  private async sendSession(session: Session, payload: Record<string, unknown>): Promise<void> {
    await this.send(session.sender, payload);
    await this.send(session.receiver, payload);
  }

  private async endVisit(id: string): Promise<void> {
    const visit = this.visits.get(id);
    if (!visit) return;
    this.visits.delete(id);
    await this.sendSession(visit, { type: 'visit-ended', id });
  }

  private async endBattle(id: string): Promise<void> {
    const battle = this.battles.get(id);
    if (!battle) return;
    this.battles.delete(id);
    await this.sendSession(battle, { type: 'battle-ended', id });
  }

  private async leaveRoom(petId: string): Promise<void> {
    const room = this.roomByPet.get(petId);
    this.roomByPet.delete(petId);
    if (!room) return;
    const members = this.rooms.get(room);
    members?.delete(petId);
    if (members?.size) await this.sendRoomState(room);
    else this.rooms.delete(room);
  }

  private async sendRoomState(room: string): Promise<void> {
    const members = this.rooms.get(room);
    if (!members) return;
    let kind = 'private';
    let platform = '';
    let code = room.split(':', 2)[1] || '';
    if (room === 'public') {
      kind = 'public';
      code = '';
    } else if (room.startsWith('tg:') || room.startsWith('dc:')) {
      kind = 'chat';
      platform = room.startsWith('tg:') ? 'telegram' : 'discord';
      code = room.slice(3);
    }
    const payload: Record<string, unknown> = {
      type: 'party-state',
      room: kind,
      code,
      members: [...members].map(([id, value]) => ({ id, pet: value.pet })),
    };
    if (platform) payload.platform = platform;
    for (const petId of members.keys()) await this.send(petId, payload);
  }

  private profileName(petId: string): string {
    const profile = this.pet(petId).pet as Record<string, unknown>;
    return String(profile.name || 'A fren');
  }

  private pushWhenOffline(petId: string, title: string, body: string): void {
    if (this.sockets.has(petId)) return;
    void pushOffline(
      this.context.db,
      this.context.config,
      this.context.rateLimiter,
      this.context.now(),
      petId,
      title,
      body
    ).catch(() => undefined);
  }

  private inSession(session: Session, petId: string): boolean {
    return session.sender === petId || session.receiver === petId;
  }

  private samePair(session: Session, first: string, second: string): boolean {
    return (session.sender === first && session.receiver === second) ||
      (session.sender === second && session.receiver === first);
  }

  private sessionBusy(
    first: string,
    second: string,
    active: Map<string, Session>,
    pending: Map<string, Session>
  ): boolean {
    return [...active.values(), ...pending.values()].some(session =>
      this.inSession(session, first) || this.inSession(session, second)
    );
  }
}
