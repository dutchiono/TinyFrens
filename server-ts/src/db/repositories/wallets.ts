import { DatabaseConnection } from '../connection.js';

export interface PetWalletRow {
  pet_id: string;
  provider: string | null;
  wallet_id: string | null;
  evm_address: string | null;
  sol_address: string | null;
  api_key: string | null;
  nft: string | null;
  created: number;
}

export interface WalletLinkRow {
  pet_id: string;
  address: string;
  created: number;
}

export interface WalletLinkChallengeRow {
  pet_id: string;
  address: string;
  message: string;
  expires: number;
}

export interface WalletSocialProfileRow {
  address: string;
  x_handle: string;
  source: string;
  updated: number;
}

export class WalletRepository {
  constructor(private db: DatabaseConnection) {}

  // Managed Pet Wallets
  getPetWallet(petId: string): PetWalletRow | undefined {
    return this.db.prepare<PetWalletRow>(
      'SELECT pet_id, provider, wallet_id, evm_address, sol_address, api_key, nft, created FROM pet_wallets WHERE pet_id=?'
    ).get(petId);
  }

  upsertPetWallet(wallet: PetWalletRow): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO pet_wallets(pet_id, provider, wallet_id, evm_address, sol_address, api_key, nft, created) VALUES(?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      wallet.pet_id,
      wallet.provider,
      wallet.wallet_id,
      wallet.evm_address,
      wallet.sol_address,
      wallet.api_key,
      wallet.nft,
      wallet.created
    );
  }

  // Linked External Wallets
  getLinkedWallets(petId: string): string[] {
    const rows = this.db.prepare<{ address: string }>(
      'SELECT address FROM wallet_links WHERE pet_id=? ORDER BY created, address'
    ).all(petId);
    return rows.map(r => r.address);
  }

  getDevicesForWallet(address: string): string[] {
    const rows = this.db.prepare<{ pet_id: string }>(
      'SELECT pet_id FROM wallet_links WHERE address=? COLLATE NOCASE'
    ).all(address);
    return rows.map(r => r.pet_id);
  }

  linkWallet(petId: string, address: string, created: number): void {
    this.db.prepare(
      'INSERT OR IGNORE INTO wallet_links(pet_id, address, created) VALUES(?, ?, ?)'
    ).run(petId, address, created);
  }

  unlinkWallet(petId: string, address: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM wallet_links WHERE pet_id=? AND address=? COLLATE NOCASE'
    ).run(petId, address);
    return result.changes > 0;
  }

  unlinkAllWallets(petId: string): number {
    const result = this.db.prepare('DELETE FROM wallet_links WHERE pet_id=?').run(petId);
    return result.changes;
  }

  // Wallet Link Challenges
  getChallenge(petId: string): WalletLinkChallengeRow | undefined {
    return this.db.prepare<WalletLinkChallengeRow>(
      'SELECT pet_id, address, message, expires FROM wallet_link_challenges WHERE pet_id=?'
    ).get(petId);
  }

  setChallenge(petId: string, address: string, message: string, expires: number): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO wallet_link_challenges(pet_id, address, message, expires) VALUES(?, ?, ?, ?)'
    ).run(petId, address, message, expires);
  }

  deleteChallenge(petId: string): void {
    this.db.prepare('DELETE FROM wallet_link_challenges WHERE pet_id=?').run(petId);
  }

  deleteExpiredChallenges(nowSeconds: number): void {
    this.db.prepare('DELETE FROM wallet_link_challenges WHERE expires<=?').run(nowSeconds);
  }

  // Social Profiles associated with wallets
  getSocialProfile(address: string): WalletSocialProfileRow | undefined {
    return this.db.prepare<WalletSocialProfileRow>(
      'SELECT address, x_handle, source, updated FROM wallet_social_profiles WHERE address=? COLLATE NOCASE'
    ).get(address);
  }

  upsertSocialProfile(address: string, xHandle: string, source: string, updated: number): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO wallet_social_profiles(address, x_handle, source, updated) VALUES(?, ?, ?, ?)'
    ).run(address, xHandle, source, updated);
  }
}
