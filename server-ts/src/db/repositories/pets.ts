import { DatabaseConnection } from '../connection.js';

export interface PetRow {
  id: string;
  code: string;
  token: string;
  profile: string;
}

export interface MagicLinkRow {
  code: string;
  pet_id: string;
  created: number;
  expires: number;
}

export interface PushSubRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  pid: string;
  created: number;
}

export class PetRepository {
  constructor(private db: DatabaseConnection) {}

  findById(id: string): PetRow | undefined {
    return this.db.prepare<PetRow>('SELECT id, code, token, profile FROM pets WHERE id=?').get(id);
  }

  findByCode(code: string): PetRow | undefined {
    return this.db.prepare<PetRow>('SELECT id, code, token, profile FROM pets WHERE code=?').get(code);
  }

  findByToken(token: string): PetRow | undefined {
    return this.db.prepare<PetRow>('SELECT id, code, token, profile FROM pets WHERE token=?').get(token);
  }

  createPet(id: string, code: string, token: string, profileJson: string): void {
    this.db.prepare(
      'INSERT INTO pets(id, code, token, profile) VALUES(?, ?, ?, ?)'
    ).run(id, code, token, profileJson);
  }

  updateProfile(id: string, profileJson: string): boolean {
    const result = this.db.prepare('UPDATE pets SET profile=? WHERE id=?').run(profileJson, id);
    return result.changes > 0;
  }

  // Friends & Friend Requests
  getFriends(petId: string): string[] {
    const rows = this.db.prepare<{ b: string }>('SELECT b FROM friends WHERE a=?').all(petId);
    return rows.map(r => r.b);
  }

  areFriends(petA: string, petB: string): boolean {
    const row = this.db.prepare<{ a: string }>(
      'SELECT a FROM friends WHERE a=? AND b=?'
    ).get(petA, petB);
    return !!row;
  }

  addFriendship(petA: string, petB: string): void {
    this.db.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO friends(a, b) VALUES(?, ?)').run(petA, petB);
      this.db.prepare('INSERT OR IGNORE INTO friends(a, b) VALUES(?, ?)').run(petB, petA);
      this.db.prepare('DELETE FROM requests WHERE (sender=? AND receiver=?) OR (sender=? AND receiver=?)').run(
        petA,
        petB,
        petB,
        petA
      );
    })();
  }

  removeFriendship(petA: string, petB: string): void {
    this.db.prepare('DELETE FROM friends WHERE (a=? AND b=?) OR (a=? AND b=?)').run(
      petA,
      petB,
      petB,
      petA
    );
  }

  getIncomingRequests(petId: string): string[] {
    const rows = this.db.prepare<{ sender: string }>('SELECT sender FROM requests WHERE receiver=?').all(petId);
    return rows.map(r => r.sender);
  }

  getOutgoingRequests(petId: string): string[] {
    const rows = this.db.prepare<{ receiver: string }>('SELECT receiver FROM requests WHERE sender=?').all(petId);
    return rows.map(r => r.receiver);
  }

  createRequest(sender: string, receiver: string): void {
    this.db.prepare('INSERT OR IGNORE INTO requests(sender, receiver) VALUES(?, ?)').run(sender, receiver);
  }

  deleteRequest(sender: string, receiver: string): void {
    this.db.prepare('DELETE FROM requests WHERE (sender=? AND receiver=?) OR (sender=? AND receiver=?)').run(
      sender,
      receiver,
      receiver,
      sender
    );
  }

  // Magic Links
  createMagicLink(code: string, petId: string, created: number, expires: number): void {
    this.db.prepare('INSERT INTO magic_links(code, pet_id, created, expires) VALUES(?, ?, ?, ?)').run(
      code,
      petId,
      created,
      expires
    );
  }

  getMagicLink(code: string): MagicLinkRow | undefined {
    return this.db.prepare<MagicLinkRow>('SELECT code, pet_id, created, expires FROM magic_links WHERE code=?').get(code);
  }

  deleteMagicLink(code: string): void {
    this.db.prepare('DELETE FROM magic_links WHERE code=?').run(code);
  }

  deleteExpiredMagicLinks(nowSeconds: number): void {
    this.db.prepare('DELETE FROM magic_links WHERE expires<=?').run(nowSeconds);
  }

  // Push Notifications
  upsertPushSubscription(endpoint: string, p256dh: string, auth: string, pid: string, created: number): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO push_subs(endpoint, p256dh, auth, pid, created) VALUES(?, ?, ?, ?, ?)'
    ).run(endpoint, p256dh, auth, pid, created);
  }

  deletePushSubscription(endpoint: string): void {
    this.db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(endpoint);
  }

  getPushSubscriptionsForPet(pid: string): PushSubRow[] {
    return this.db.prepare<PushSubRow>('SELECT endpoint, p256dh, auth, pid, created FROM push_subs WHERE pid=?').all(pid);
  }
}
