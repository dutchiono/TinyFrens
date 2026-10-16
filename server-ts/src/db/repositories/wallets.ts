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

export interface AccountWalletRow {
  account: string;
  chain_id: number;
  address: string;
  provider: string;
  role: string;
  verification_method: string;
  verified_at: number;
  created_at: number;
  revoked_at: number | null;
}

export interface WalletSocialProfileRow {
  address: string;
  x_handle: string;
  source: string;
  updated: number;
}

import type { MagicLinkRow } from './pets.js';
import type { FrenNftRow, FrensBurnLogRow } from './economy.js';

export function migrateWalletLinks(db: DatabaseConnection): void {
  const columns = db.prepare<{ name: string; pk: number }>('PRAGMA table_info(wallet_links)').all();
  if (columns.some(col => col.name === 'address' && col.pk > 0)) {
    db.exec('DROP TABLE IF EXISTS wallet_links_next;');
    return;
  }
  db.transaction(() => {
    db.prepare('DROP TABLE IF EXISTS wallet_links_next').run();
    db.prepare(
      'CREATE TABLE wallet_links_next(pet_id TEXT, address TEXT COLLATE NOCASE NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(pet_id, address))'
    ).run();
    db.prepare('INSERT INTO wallet_links_next SELECT pet_id, address, created FROM wallet_links').run();
    db.prepare('DROP TABLE wallet_links').run();
    db.prepare('ALTER TABLE wallet_links_next RENAME TO wallet_links').run();
  })();
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
  getAccountWallets(account: string, chainId = 8453): string[] {
    const rows = this.db.prepare<{ address: string }>(
      `SELECT address FROM account_wallets
       WHERE account=? AND chain_id=? AND revoked_at IS NULL
       ORDER BY created_at, address`
    ).all(account, chainId);
    return rows.map(row => row.address);
  }

  getActiveAccountWallet(address: string, chainId = 8453): AccountWalletRow | undefined {
    return this.db.prepare<AccountWalletRow>(
      `SELECT account, chain_id, address, provider, role, verification_method,
              verified_at, created_at, revoked_at
       FROM account_wallets
       WHERE chain_id=? AND address=? COLLATE NOCASE AND revoked_at IS NULL`
    ).get(chainId, address);
  }

  linkAccountWallet(
    account: string,
    address: string,
    verificationMethod: string,
    verifiedAt: number,
    provider = 'external',
    role = 'owner',
    chainId = 8453
  ): void {
    const active = this.getActiveAccountWallet(address, chainId);
    if (active && active.account !== account) {
      throw new Error('This wallet is already linked to another TinyFrens account');
    }
    this.db.prepare(
      `INSERT INTO account_wallets(
         account, chain_id, address, provider, role, verification_method,
         verified_at, created_at, revoked_at
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(account, chain_id, address) DO UPDATE SET
         provider=excluded.provider, role=excluded.role,
         verification_method=excluded.verification_method,
         verified_at=excluded.verified_at, revoked_at=NULL`
    ).run(account, chainId, address, provider, role, verificationMethod, verifiedAt, verifiedAt);
  }

  unlinkAccountWallet(account: string, address: string, revokedAt: number, chainId = 8453): boolean {
    const result = this.db.prepare(
      `UPDATE account_wallets SET revoked_at=?
       WHERE account=? AND chain_id=? AND address=? COLLATE NOCASE AND revoked_at IS NULL`
    ).run(revokedAt, account, chainId, address);
    return result.changes > 0;
  }

  unlinkAllAccountWallets(account: string, revokedAt: number, chainId = 8453): number {
    const result = this.db.prepare(
      'UPDATE account_wallets SET revoked_at=? WHERE account=? AND chain_id=? AND revoked_at IS NULL'
    ).run(revokedAt, account, chainId);
    return result.changes;
  }

  resolveAccountWalletConflict(
    address: string,
    conflictingAccount: string,
    resolvedAt: number,
    chainId = 8453
  ): void {
    this.db.prepare(
      `UPDATE account_wallet_conflicts SET resolved_at=?
       WHERE chain_id=? AND address=? COLLATE NOCASE
         AND conflicting_account=? AND resolved_at IS NULL`
    ).run(resolvedAt, chainId, address, conflictingAccount);
  }

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

  getAccountChallenge(account: string): WalletLinkChallengeRow | undefined {
    return this.db.prepare<WalletLinkChallengeRow>(
      `SELECT account AS pet_id, address, message, expires
       FROM account_wallet_challenges WHERE account=?`
    ).get(account);
  }

  setAccountChallenge(
    account: string,
    address: string,
    message: string,
    expires: number,
    chainId = 8453
  ): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO account_wallet_challenges(account, chain_id, address, message, expires)
       VALUES(?, ?, ?, ?, ?)`
    ).run(account, chainId, address, message, expires);
  }

  deleteAccountChallenge(account: string): void {
    this.db.prepare('DELETE FROM account_wallet_challenges WHERE account=?').run(account);
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

  // Magic links
  createMagicLink(code: string, petId: string, created: number, expires: number): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM magic_links WHERE pet_id=?').run(petId);
      this.db.prepare(
        'INSERT INTO magic_links(code, pet_id, created, expires) VALUES(?, ?, ?, ?)'
      ).run(code, petId, created, expires);
    })();
  }

  getMagicLink(code: string): MagicLinkRow | undefined {
    return this.db.prepare<MagicLinkRow>(
      'SELECT code, pet_id, created, expires FROM magic_links WHERE code=?'
    ).get(code);
  }

  deleteMagicLink(code: string): void {
    this.db.prepare('DELETE FROM magic_links WHERE code=?').run(code);
  }

  deleteExpiredMagicLinks(nowSeconds: number): void {
    this.db.prepare('DELETE FROM magic_links WHERE expires<=?').run(nowSeconds);
  }

  // Fren NFTs
  listFrenNfts(petId: string): FrenNftRow[] {
    return this.db.prepare<FrenNftRow>(
      'SELECT id, pet_id, token_id, name, traits, created, locked_frens FROM fren_nfts WHERE pet_id=? ORDER BY id DESC'
    ).all(petId);
  }

  getFrenNft(petId: string, tokenId: number): FrenNftRow | undefined {
    return this.db.prepare<FrenNftRow>(
      'SELECT id, pet_id, token_id, name, traits, created, locked_frens FROM fren_nfts WHERE pet_id=? AND token_id=?'
    ).get(petId, tokenId);
  }

  getAllMintedTokenIds(): Set<number> {
    const rows = this.db.prepare<{ token_id: number }>('SELECT token_id FROM fren_nfts').all();
    return new Set(rows.map(r => r.token_id));
  }

  insertFrenNft(
    petId: string,
    tokenId: number,
    name: string,
    traitsJson: string,
    created: number,
    lockedFrens: string = '0'
  ): void {
    this.db.prepare(
      'INSERT INTO fren_nfts(pet_id, token_id, name, traits, created, locked_frens) VALUES(?, ?, ?, ?, ?, ?)'
    ).run(petId, tokenId, name, traitsJson, created, lockedFrens);
  }

  updateFrenNft(petId: string, tokenId: number, name: string, traitsJson: string): boolean {
    const res = this.db.prepare(
      'UPDATE fren_nfts SET name=?, traits=? WHERE pet_id=? AND token_id=?'
    ).run(name, traitsJson, petId, tokenId);
    return res.changes > 0;
  }

  deleteFrenNft(petId: string, tokenId: number): boolean {
    const res = this.db.prepare('DELETE FROM fren_nfts WHERE pet_id=? AND token_id=?').run(petId, tokenId);
    return res.changes > 0;
  }

  // Burn log
  recordBurnLog(
    petId: string,
    tokenId: number,
    action: string,
    amountBurned: string,
    amountTreasury: string,
    created: number
  ): void {
    this.db.prepare(
      'INSERT INTO frens_burn_log(pet_id, token_id, action, amount_burned, amount_treasury, created) VALUES(?, ?, ?, ?, ?, ?)'
    ).run(petId, tokenId, action, amountBurned, amountTreasury, created);
  }

  // Pet wallet NFT override
  updatePetWalletNft(petId: string, nftJson: string | null): void {
    this.db.prepare('UPDATE pet_wallets SET nft=? WHERE pet_id=?').run(nftJson, petId);
  }
}
