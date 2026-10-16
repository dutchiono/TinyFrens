import { DatabaseConnection } from '../connection.js';

export interface DepositSessionRow {
  id: string;
  pet_id: string;
  address: string;
  token: string | null;
  expected_amount: string;
  credits: number;
  energy_milli: number;
  purchase_kind: 'energy' | 'legacy_credit';
  status: string;
  chain_id: number | null;
  tx_hash: string | null;
  created: number;
  expires_at: number;
}

export interface DepositRow {
  id: number;
  session_id: string;
  pet_id: string;
  account: string | null;
  chain_id: number;
  tx_hash: string;
  log_index: number;
  amount: string;
  credits: number;
  energy_milli: number;
  purchase_kind: 'energy' | 'legacy_credit';
  created: number;
}

export interface CreditLedgerRow {
  id: number;
  pet_id: string;
  delta: number;
  balance: number;
  reason: string;
  ref_type: string | null;
  ref_id: string | null;
  created: number;
}

export interface TreasuryTransferRow {
  id: number;
  chain_id: number;
  tx_hash: string;
  log_index: number;
  sender: string;
  token: string | null;
  amount: string;
  pet_id: string | null;
  credits: number;
  status: string;
  created: number;
}

export interface FrenNftRow {
  id: number;
  pet_id: string;
  token_id: number;
  name: string;
  traits: string;
  created: number;
  locked_frens: string;
}

export interface FrensBurnLogRow {
  id: number;
  pet_id: string;
  token_id: number;
  action: string;
  amount_burned: string;
  amount_treasury: string;
  created: number;
}

export class EconomyRepository {
  constructor(private db: DatabaseConnection) {}

  // Deposit Sessions
  createDepositSession(session: DepositSessionRow): void {
    this.db.prepare(
      `INSERT INTO deposit_sessions(
        id, pet_id, address, token, expected_amount, credits, energy_milli, purchase_kind, status, chain_id, tx_hash, created, expires_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      session.id,
      session.pet_id,
      session.address,
      session.token,
      session.expected_amount,
      session.credits,
      session.energy_milli,
      session.purchase_kind,
      session.status,
      session.chain_id,
      session.tx_hash,
      session.created,
      session.expires_at
    );
  }

  getDepositSession(id: string): DepositSessionRow | undefined {
    return this.db.prepare<DepositSessionRow>(
      `SELECT id, pet_id, address, token, expected_amount, credits, energy_milli, purchase_kind, status, chain_id, tx_hash, created, expires_at
       FROM deposit_sessions WHERE id=?`
    ).get(id);
  }

  getOpenSessionByAddress(address: string): DepositSessionRow | undefined {
    return this.db.prepare<DepositSessionRow>(
      `SELECT id, pet_id, address, token, expected_amount, credits, energy_milli, purchase_kind, status, chain_id, tx_hash, created, expires_at
       FROM deposit_sessions WHERE address=? COLLATE NOCASE AND status='open'`
    ).get(address);
  }

  listOpenSessionAddresses(): string[] {
    const rows = this.db.prepare<{ address: string }>(
      "SELECT address FROM deposit_sessions WHERE status='open'"
    ).all();
    return rows.map(r => r.address);
  }

  updateDepositSessionStatus(id: string, status: string, txHash: string | null = null): boolean {
    let result;
    if (txHash) {
      result = this.db.prepare('UPDATE deposit_sessions SET status=?, tx_hash=? WHERE id=?').run(
        status,
        txHash,
        id
      );
    } else {
      result = this.db.prepare('UPDATE deposit_sessions SET status=? WHERE id=?').run(status, id);
    }
    return result.changes > 0;
  }

  // Deposits
  recordDeposit(deposit: Omit<DepositRow, 'id'>): number {
    const result = this.db.prepare(
      `INSERT INTO deposits(
        session_id, pet_id, account, chain_id, tx_hash, log_index, amount, credits, energy_milli, purchase_kind, created
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      deposit.session_id,
      deposit.pet_id,
      deposit.account,
      deposit.chain_id,
      deposit.tx_hash,
      deposit.log_index,
      deposit.amount,
      deposit.credits,
      deposit.energy_milli,
      deposit.purchase_kind,
      deposit.created
    );
    return Number(result.lastInsertRowid);
  }

  isDepositRecorded(chainId: number, txHash: string, logIndex: number): boolean {
    const row = this.db.prepare<{ id: number }>(
      'SELECT id FROM deposits WHERE chain_id=? AND tx_hash=? AND log_index=?'
    ).get(chainId, txHash, logIndex);
    return !!row;
  }

  // Credit Accounts & Ledger (Transactional)
  getCreditBalance(petId: string): number {
    const row = this.db.prepare<{ balance: number }>(
      'SELECT balance FROM credit_accounts WHERE pet_id=?'
    ).get(petId);
    return row?.balance ?? 0;
  }

  adjustCredits(
    petId: string,
    delta: number,
    reason: string,
    refType: string | null,
    refId: string | null,
    nowSeconds: number
  ): number {
    return this.db.transaction(() => {
      const current = this.getCreditBalance(petId);
      const nextBalance = current + delta;
      if (nextBalance < 0) {
        throw new Error('Insufficient credits');
      }

      this.db.prepare(
        `INSERT INTO credit_accounts(pet_id, balance, updated_at) VALUES(?, ?, ?)
         ON CONFLICT(pet_id) DO UPDATE SET balance=?, updated_at=?`
      ).run(petId, nextBalance, nowSeconds, nextBalance, nowSeconds);

      this.db.prepare(
        `INSERT INTO credit_ledger(pet_id, delta, balance, reason, ref_type, ref_id, created)
         VALUES(?, ?, ?, ?, ?, ?, ?)`
      ).run(petId, delta, nextBalance, reason, refType, refId, nowSeconds);

      return nextBalance;
    })();
  }

  getCreditLedger(petId: string, limit: number = 50): CreditLedgerRow[] {
    return this.db.prepare<CreditLedgerRow>(
      `SELECT id, pet_id, delta, balance, reason, ref_type, ref_id, created
       FROM credit_ledger WHERE pet_id=? ORDER BY id DESC LIMIT ?`
    ).all(petId, limit);
  }

  // Treasury Transfers
  recordTreasuryTransfer(transfer: Omit<TreasuryTransferRow, 'id'>): number {
    const result = this.db.prepare(
      `INSERT INTO treasury_transfers(
        chain_id, tx_hash, log_index, sender, token, amount, pet_id, credits, status, created
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      transfer.chain_id,
      transfer.tx_hash,
      transfer.log_index,
      transfer.sender,
      transfer.token,
      transfer.amount,
      transfer.pet_id,
      transfer.credits,
      transfer.status,
      transfer.created
    );
    return Number(result.lastInsertRowid);
  }

  isTreasuryTransferRecorded(chainId: number, txHash: string, logIndex: number): boolean {
    const row = this.db.prepare<{ id: number }>(
      'SELECT id FROM treasury_transfers WHERE chain_id=? AND tx_hash=? AND log_index=?'
    ).get(chainId, txHash, logIndex);
    return !!row;
  }

  // FREN NFTs & Burn Log
  recordNft(
    petId: string,
    tokenId: number,
    name: string,
    traitsJson: string,
    lockedFrens: string,
    created: number
  ): number {
    const result = this.db.prepare(
      `INSERT INTO fren_nfts(pet_id, token_id, name, traits, created, locked_frens)
       VALUES(?, ?, ?, ?, ?, ?)`
    ).run(petId, tokenId, name, traitsJson, created, lockedFrens);
    return Number(result.lastInsertRowid);
  }

  getNftsByPet(petId: string): FrenNftRow[] {
    return this.db.prepare<FrenNftRow>(
      'SELECT id, pet_id, token_id, name, traits, created, locked_frens FROM fren_nfts WHERE pet_id=?'
    ).all(petId);
  }

  recordBurn(
    petId: string,
    tokenId: number,
    action: string,
    amountBurned: string,
    amountTreasury: string,
    created: number
  ): number {
    const result = this.db.prepare(
      `INSERT INTO frens_burn_log(pet_id, token_id, action, amount_burned, amount_treasury, created)
       VALUES(?, ?, ?, ?, ?, ?)`
    ).run(petId, tokenId, action, amountBurned, amountTreasury, created);
    return Number(result.lastInsertRowid);
  }
}
