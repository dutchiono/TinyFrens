import { DatabaseConnection } from '../db/connection.js';
import { toChecksumAddress } from '../crypto/signatures.js';
import { validateRobotTokenId } from './robot-care-rules.js';
export { Robots, type RobotsVerifier } from './robots-verifier.js';
import type { RobotsVerifier } from './robots-verifier.js';

export const ROBOTS_CONTRACT = '0xd745d8005a1ad8f783b97bf55e0d0e6a920ea8ff';
export const ROBOTS_CHAIN_ID = 8453;

export const EXTRA_COLLECTIONS: Record<string, [number, number, string]> = {
  '0x34d9e560ee16662d19e44315a822bd51eea0133c': [4663, 3000, 'The Nubs'],
  '0x8d446c126d4873bfa3eb195b7f0094acc1187a75': [8453, 10000, 'Bots Computers'],
};

export interface ExtraCompanionsVerifier {
  discover(addresses: string[], collection: string): Promise<{ nfts: any[]; partial: boolean }>;
  read(address: string, tokenId: number, collection: string): Promise<any>;
}

export class DefaultRobotsVerifier implements RobotsVerifier {
  constructor(private db: DatabaseConnection) {}

  async discover(address: string): Promise<{ nfts: any[]; partial: boolean }> {
    // Default discovery reads from cached inventory or returns empty
    const checksum = toChecksumAddress(address);
    const row = this.db.prepare<{ payload: string }>(
      'SELECT payload FROM robot_ownership WHERE wallet=? COLLATE NOCASE'
    ).all(checksum);

    const nfts = row.map(r => {
      try {
        return JSON.parse(r.payload);
      } catch {
        return null;
      }
    }).filter(Boolean);

    return { nfts, partial: false };
  }

  async read(address: string, tokenId: number): Promise<any> {
    const tid = validateRobotTokenId(tokenId);
    const checksum = toChecksumAddress(address);
    const row = this.db.prepare<{ payload: string }>(
      'SELECT payload FROM robot_ownership WHERE wallet=? COLLATE NOCASE AND token_id=?'
    ).get(checksum, tid);

    if (row) {
      try {
        return JSON.parse(row.payload);
      } catch {
        // Fall through
      }
    }

    return {
      tokenId: tid,
      wallet: checksum,
      originalOwner: checksum,
      active: false,
      image: null,
      name: `TinyFrens Robot v1 #${tid}`,
      collection: 'TinyFrens: Robots v1',
      originalAddress: ROBOTS_CONTRACT,
      chainId: ROBOTS_CHAIN_ID,
      companion: null,
      checkedAt: Date.now() / 1000,
      validUntil: Date.now() / 1000 + 86400,
    };
  }

  async ownerOf(address: string, tokenId: number): Promise<boolean> {
    const data = await this.read(address, tokenId);
    return Boolean(data.active);
  }
}

export class DefaultExtraCompanionsVerifier implements ExtraCompanionsVerifier {
  constructor(private db: DatabaseConnection) {}

  async discover(addresses: string[], collection: string): Promise<{ nfts: any[]; partial: boolean }> {
    const meta = EXTRA_COLLECTIONS[collection.toLowerCase()];
    if (!meta) throw new Error('Unsupported companion collection');

    const nfts: any[] = [];
    for (const addr of addresses) {
      const rows = this.db.prepare<{ payload: string }>(
        'SELECT payload FROM extra_companion_ownership WHERE wallet=? COLLATE NOCASE AND collection=? COLLATE NOCASE'
      ).all(addr, collection);

      for (const row of rows) {
        try {
          nfts.push(JSON.parse(row.payload));
        } catch {
          // ignore
        }
      }
    }

    return { nfts, partial: false };
  }

  async read(address: string, tokenId: number, collection: string): Promise<any> {
    const meta = EXTRA_COLLECTIONS[collection.toLowerCase()];
    if (!meta) throw new Error('Unsupported companion collection');

    const [chainId, , name] = meta;
    const checksum = toChecksumAddress(address);
    const row = this.db.prepare<{ payload: string }>(
      'SELECT payload FROM extra_companion_ownership WHERE wallet=? COLLATE NOCASE AND collection=? COLLATE NOCASE AND token=?'
    ).get(checksum, collection, tokenId);

    if (row) {
      try {
        return JSON.parse(row.payload);
      } catch {
        // fall through
      }
    }

    return {
      tokenId,
      wallet: checksum,
      originalOwner: checksum,
      active: false,
      image: null,
      name: `${name} #${tokenId}`,
      collection: name,
      originalAddress: collection,
      chainId,
      companion: null,
      checkedAt: Date.now() / 1000,
      validUntil: Date.now() / 1000 + 86400,
    };
  }
}
