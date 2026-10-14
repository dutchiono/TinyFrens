import { DatabaseConnection } from '../connection.js';

export interface DailyCareRow {
  pet_id: string;
  day: string;
  used: number;
  updated: number;
}

export interface NftOwnershipRow {
  wallet: string;
  token_id: number;
  checked: number;
  payload: string | null;
}

export interface ExtraCompanionOwnershipRow {
  wallet: string;
  collection: string;
  token: number;
  checked: number;
  payload: string | null;
}

export class RobotRepository {
  constructor(private db: DatabaseConnection) {}

  // Daily Care Allowance
  getDailyCareUsed(petId: string, dayKey: string): number {
    const row = this.db.prepare<{ used: number }>(
      'SELECT used FROM robot_care_daily WHERE pet_id=? AND day=?'
    ).get(petId, dayKey);
    return row?.used ?? 0;
  }

  recordDailyCareUsage(petId: string, dayKey: string, delta: number, nowSeconds: number): number {
    const current = this.getDailyCareUsed(petId, dayKey);
    const nextUsed = current + delta;

    this.db.prepare(
      `INSERT INTO robot_care_daily(pet_id, day, used, updated) VALUES(?, ?, ?, ?)
       ON CONFLICT(pet_id, day) DO UPDATE SET used=used+?, updated=?`
    ).run(petId, dayKey, delta, nowSeconds, delta, nowSeconds);

    return nextUsed;
  }

  // Robot Ownership Cache
  getRobotOwnership(wallet: string, tokenId: number): NftOwnershipRow | undefined {
    return this.db.prepare<NftOwnershipRow>(
      'SELECT wallet, token_id, checked, payload FROM robot_ownership WHERE wallet=? COLLATE NOCASE AND token_id=?'
    ).get(wallet, tokenId);
  }

  setRobotOwnership(wallet: string, tokenId: number, checked: number, payload: string | null): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO robot_ownership(wallet, token_id, checked, payload) VALUES(?, ?, ?, ?)'
    ).run(wallet, tokenId, checked, payload);
  }

  // Turtle Ownership Cache
  getTurtleOwnership(wallet: string, tokenId: number): NftOwnershipRow | undefined {
    return this.db.prepare<NftOwnershipRow>(
      'SELECT wallet, token_id, checked, payload FROM turtle_ownership WHERE wallet=? COLLATE NOCASE AND token_id=?'
    ).get(wallet, tokenId);
  }

  setTurtleOwnership(wallet: string, tokenId: number, checked: number, payload: string | null): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO turtle_ownership(wallet, token_id, checked, payload) VALUES(?, ?, ?, ?)'
    ).run(wallet, tokenId, checked, payload);
  }

  deleteTurtleOwnership(wallet: string, tokenId: number): void {
    this.db.prepare(
      'DELETE FROM turtle_ownership WHERE wallet=? COLLATE NOCASE AND token_id=?'
    ).run(wallet, tokenId);
  }

  // Extra Companion Ownership Cache
  getExtraCompanionOwnership(
    wallet: string,
    collection: string,
    token: number
  ): ExtraCompanionOwnershipRow | undefined {
    return this.db.prepare<ExtraCompanionOwnershipRow>(
      'SELECT wallet, collection, token, checked, payload FROM extra_companion_ownership WHERE wallet=? COLLATE NOCASE AND collection=? COLLATE NOCASE AND token=?'
    ).get(wallet, collection, token);
  }

  setExtraCompanionOwnership(
    wallet: string,
    collection: string,
    token: number,
    checked: number,
    payload: string | null
  ): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO extra_companion_ownership(wallet, collection, token, checked, payload) VALUES(?, ?, ?, ?, ?)'
    ).run(wallet, collection, token, checked, payload);
  }

  // Robot Gallery Metadata & Owners
  getGalleryArt(tokenId: number): string | undefined {
    const row = this.db.prepare<{ metadata: string }>(
      'SELECT metadata FROM robot_gallery_art WHERE token=?'
    ).get(tokenId);
    return row?.metadata;
  }

  setGalleryArt(tokenId: number, metadataJson: string): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO robot_gallery_art(token, metadata) VALUES(?, ?)'
    ).run(tokenId, metadataJson);
  }

  getGalleryOwner(tokenId: number): string | undefined {
    const row = this.db.prepare<{ wallet: string }>(
      'SELECT wallet FROM robot_gallery_owners WHERE token=?'
    ).get(tokenId);
    return row?.wallet;
  }

  setGalleryOwner(tokenId: number, wallet: string): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO robot_gallery_owners(token, wallet) VALUES(?, ?)'
    ).run(tokenId, wallet);
  }
}
