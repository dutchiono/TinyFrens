import crypto from 'node:crypto';
import { DatabaseConnection } from '../db/connection.js';
import {
  CREDITS_PER_FRENS,
  PACKAGES,
  creditsFromWei,
  weiFromFrens,
  EconomyPackage,
  getPackages,
} from './economy-math.js';

export const SESSION_TTL_SECONDS = 900;

export class EconomyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EconomyError';
  }
}

export class NotEnabled extends EconomyError {
  constructor(message: string = 'economy is not enabled on this server') {
    super(message);
    this.name = 'NotEnabled';
  }
}

export class UnknownSession extends EconomyError {
  constructor(message: string = 'deposit session not found') {
    super(message);
    this.name = 'UnknownSession';
  }
}

export class SessionExpired extends EconomyError {
  constructor(message: string = 'deposit session expired') {
    super(message);
    this.name = 'SessionExpired';
  }
}

export class InsufficientCredits extends EconomyError {
  constructor(message: string = 'not enough credits') {
    super(message);
    this.name = 'InsufficientCredits';
  }
}

export class AddressPool {
  private addresses: string[];

  constructor(private db: DatabaseConnection, addresses: string[]) {
    this.addresses = addresses.map(a => a.trim()).filter(Boolean);
  }

  allocate(_petId?: string, _token?: string): string {
    const rows = this.db.prepare<{ address: string }>(
      "SELECT address FROM deposit_sessions WHERE status='open'"
    ).all();
    const busy = new Set(rows.map(r => r.address.toLowerCase()));
    for (const address of this.addresses) {
      if (!busy.has(address.toLowerCase())) {
        return address;
      }
    }
    throw new EconomyError('no deposit address available');
  }
}

export interface DepositSession {
  id: string;
  petId: string;
  address: string;
  token: string | null;
  expectedAmount: string;
  credits: number;
  energyMilli: number;
  purchaseKind: 'energy' | 'legacy_credit';
  status: string;
  chainId: number | null;
  txHash: string | null;
  created: number;
  expiresAt: number;
}

export interface DepositConfirmation {
  status: 'confirmed' | 'duplicate';
  sessionId: string;
  credits: number;
  energyMilli: number;
  account: string | null;
}

export type EnergyPurchaseFulfiller = (purchase: {
  petId: string;
  energyMilli: number;
  chainId: number;
  txHash: string;
  logIndex: number;
  sessionId: string;
  created: number;
}) => string;

export interface CreditLedgerEntry {
  delta: number;
  balance: number;
  reason: string;
  refType: string | null;
  refId: string | null;
  created: number;
}

export interface TreasuryTransferResult {
  status: string;
  credits: number;
  petId: string | null;
}

export class Economy {
  db: DatabaseConnection;
  now: () => number;
  creditsPerFrens: number;

  constructor(
    db: DatabaseConnection,
    now: () => number = () => Date.now() / 1000,
    creditsPerFrens: number = 100,
    private readonly fulfillEnergyPurchase?: EnergyPurchaseFulfiller
  ) {
    this.db = db;
    this.now = now;
    this.creditsPerFrens = Math.max(1, Math.floor(creditsPerFrens));

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS deposit_sessions(
        id TEXT PRIMARY KEY,
        pet_id TEXT NOT NULL,
        address TEXT NOT NULL,
        token TEXT,
        expected_amount TEXT NOT NULL,
        credits INTEGER NOT NULL,
        energy_milli INTEGER NOT NULL DEFAULT 0 CHECK(energy_milli >= 0),
        purchase_kind TEXT NOT NULL DEFAULT 'legacy_credit',
        status TEXT NOT NULL,
        chain_id INTEGER,
        tx_hash TEXT,
        created INTEGER NOT NULL,
        expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS deposit_sessions_pet ON deposit_sessions(pet_id, status);
      CREATE INDEX IF NOT EXISTS deposit_sessions_address ON deposit_sessions(address);
      CREATE TABLE IF NOT EXISTS deposits(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        pet_id TEXT NOT NULL,
        account TEXT,
        chain_id INTEGER NOT NULL,
        tx_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        amount TEXT NOT NULL,
        credits INTEGER NOT NULL,
        energy_milli INTEGER NOT NULL DEFAULT 0 CHECK(energy_milli >= 0),
        purchase_kind TEXT NOT NULL DEFAULT 'legacy_credit',
        created INTEGER NOT NULL,
        UNIQUE(chain_id, tx_hash, log_index));
      CREATE TABLE IF NOT EXISTS credit_accounts(
        pet_id TEXT PRIMARY KEY,
        balance INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS credit_ledger(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pet_id TEXT NOT NULL,
        delta INTEGER NOT NULL,
        balance INTEGER NOT NULL,
        reason TEXT NOT NULL,
        ref_type TEXT,
        ref_id TEXT,
        created INTEGER NOT NULL);
    `);
  }

  // Packages
  packages(): EconomyPackage[] {
    return getPackages(this.creditsPerFrens);
  }

  // Deposit Sessions
  openSession(
    petId: string,
    address: string,
    frens: number,
    options: {
      token?: string | null;
      chainId?: number | null;
      ttl?: number;
      sessionId?: string | null;
      energyMilli?: number;
    } = {}
  ): DepositSession {
    if (typeof frens !== 'number' || frens <= 0) {
      throw new Error('frens must be > 0');
    }
    const ts = Math.floor(this.now());
    const ttl = options.ttl ?? SESSION_TTL_SECONDS;

    this.db.prepare(
      "UPDATE deposit_sessions SET status='expired' WHERE pet_id=? AND status='open'"
    ).run(petId);

    const sessionId = options.sessionId || crypto.randomBytes(16).toString('hex');
    const expectedAmount = String(weiFromFrens(frens));
    const energyMilli = options.energyMilli ?? 0;
    if (!Number.isSafeInteger(energyMilli) || energyMilli < 0) {
      throw new Error('energyMilli must be a non-negative safe integer');
    }
    const purchaseKind = energyMilli > 0 ? 'energy' : 'legacy_credit';
    const credits = purchaseKind === 'energy' ? 0 : frens * this.creditsPerFrens;

    this.db.prepare(
      `INSERT INTO deposit_sessions
       (id,pet_id,address,token,expected_amount,credits,energy_milli,purchase_kind,status,chain_id,tx_hash,created,expires_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      sessionId,
      petId,
      address,
      options.token ?? null,
      expectedAmount,
      credits,
      energyMilli,
      purchaseKind,
      'open',
      options.chainId ?? null,
      null,
      ts,
      ts + ttl
    );

    return this.session(sessionId);
  }

  session(sessionId: string): DepositSession {
    const row = this.db.prepare<{
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
    }>(
      `SELECT id,pet_id,address,token,expected_amount,credits,energy_milli,purchase_kind,status,chain_id,tx_hash,created,expires_at
       FROM deposit_sessions WHERE id=?`
    ).get(sessionId);

    if (!row) {
      throw new UnknownSession('deposit session not found');
    }

    return {
      id: row.id,
      petId: row.pet_id,
      address: row.address,
      token: row.token,
      expectedAmount: row.expected_amount,
      credits: row.credits,
      energyMilli: row.energy_milli,
      purchaseKind: row.purchase_kind,
      status: row.status,
      chainId: row.chain_id,
      txHash: row.tx_hash,
      created: row.created,
      expiresAt: row.expires_at,
    };
  }

  closeSession(sessionId: string, status: string = 'expired'): DepositSession {
    this.db.prepare('UPDATE deposit_sessions SET status=? WHERE id=?').run(status, sessionId);
    return this.session(sessionId);
  }

  expireStale(): number {
    const ts = Math.floor(this.now());
    const res = this.db.prepare(
      "UPDATE deposit_sessions SET status='expired' WHERE status='open' AND expires_at<=?"
    ).run(ts);
    return res.changes;
  }

  openSessionForAddress(address: string, _chainId?: number | null): DepositSession | null {
    const row = this.db.prepare<{
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
    }>(
      `SELECT id,pet_id,address,token,expected_amount,credits,energy_milli,purchase_kind,status,chain_id,tx_hash,created,expires_at
       FROM deposit_sessions WHERE address=? COLLATE NOCASE AND status='open' ORDER BY created DESC LIMIT 1`
    ).get(address);

    if (!row) return null;
    return {
      id: row.id,
      petId: row.pet_id,
      address: row.address,
      token: row.token,
      expectedAmount: row.expected_amount,
      credits: row.credits,
      energyMilli: row.energy_milli,
      purchaseKind: row.purchase_kind,
      status: row.status,
      chainId: row.chain_id,
      txHash: row.tx_hash,
      created: row.created,
      expiresAt: row.expires_at,
    };
  }

  // Deposits
  confirm(
    sessionId: string,
    txHash: string,
    amountWei: bigint | string | number,
    chainId: number,
    logIndex: number = 0,
    address?: string | null
  ): DepositConfirmation {
    const ts = Math.floor(this.now());
    const sess = this.session(sessionId);
    const normalizedChainId = Number(chainId);
    const normalizedTxHash = String(txHash).toLowerCase();
    const normalizedLogIndex = Number(logIndex);
    if (!Number.isSafeInteger(normalizedChainId) || normalizedChainId <= 0) {
      throw new EconomyError('invalid deposit chain');
    }
    if (!Number.isSafeInteger(normalizedLogIndex) || normalizedLogIndex < 0) {
      throw new EconomyError('invalid deposit log index');
    }
    if (!normalizedTxHash.trim()) {
      throw new EconomyError('invalid deposit transaction hash');
    }
    if (sess.chainId !== null && normalizedChainId !== sess.chainId) {
      throw new EconomyError('deposit chain does not match session');
    }

    const existing = this.db.prepare<{ id: number }>(
      'SELECT id FROM deposits WHERE chain_id=? AND tx_hash=? AND log_index=?'
    ).get(normalizedChainId, normalizedTxHash, normalizedLogIndex);
    if (existing) {
      return { status: 'duplicate', sessionId, credits: 0, energyMilli: 0, account: null };
    }

    if (sess.status === 'open' && sess.expiresAt <= ts) {
      this.closeSession(sessionId, 'expired');
      throw new SessionExpired('deposit session expired');
    }
    if (sess.status !== 'open') {
      throw new SessionExpired('deposit session already used');
    }
    if (address !== null && address !== undefined && sess.address.toLowerCase() !== String(address).toLowerCase()) {
      throw new UnknownSession('address does not match session');
    }
    if (BigInt(amountWei) < BigInt(sess.expectedAmount)) {
      throw new EconomyError('deposit amount below expected');
    }

    if (sess.purchaseKind === 'energy' && !this.fulfillEnergyPurchase) {
      throw new EconomyError('Energy purchase fulfillment unavailable');
    }

    try {
      return this.db.transaction(() => {
        this.db.prepare(
          `INSERT INTO deposits(
             session_id,pet_id,account,chain_id,tx_hash,log_index,amount,credits,energy_milli,purchase_kind,created
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`
        ).run(
          sessionId,
          sess.petId,
          null,
          normalizedChainId,
          normalizedTxHash,
          normalizedLogIndex,
          String(amountWei),
          sess.credits,
          sess.energyMilli,
          sess.purchaseKind,
          ts
        );

        this.db.prepare(
          "UPDATE deposit_sessions SET status='confirmed', tx_hash=?, chain_id=? WHERE id=?"
        ).run(normalizedTxHash, normalizedChainId, sessionId);

        let account: string | null = null;
        if (sess.purchaseKind === 'energy') {
          account = this.fulfillEnergyPurchase!({
            petId: sess.petId,
            energyMilli: sess.energyMilli,
            chainId: normalizedChainId,
            txHash: normalizedTxHash,
            logIndex: normalizedLogIndex,
            sessionId,
            created: ts,
          });
          this.db.prepare('UPDATE deposits SET account=? WHERE session_id=?').run(account, sessionId);
        } else {
          this._grant(sess.petId, sess.credits, 'deposit', 'deposit', sessionId);
        }

        return {
          status: 'confirmed' as const,
          sessionId,
          credits: sess.credits,
          energyMilli: sess.energyMilli,
          account,
        };
      })();
    } catch (e: any) {
      if (String(e.message).includes('UNIQUE constraint failed')) {
        return { status: 'duplicate', sessionId, credits: 0, energyMilli: 0, account: null };
      }
      throw e;
    }
  }

  // Treasury Transfers
  treasuryTransfer(chainId: number, txHash: string, logIndex: number): { id: number; status: string } | null {
    const row = this.db.prepare<{ id: number; status: string }>(
      'SELECT id, status FROM treasury_transfers WHERE chain_id=? AND tx_hash=? AND log_index=?'
    ).get(Number(chainId), String(txHash).toLowerCase(), Number(logIndex));
    return row || null;
  }

  creditTransfer(params: {
    txHash: string;
    amountWei: bigint | string | number;
    chainId: number;
    logIndex?: number;
    sender: string;
    petId?: string | null;
    token?: string | null;
    maxCredits?: number | null;
  }): TreasuryTransferResult {
    const { txHash, amountWei, chainId, logIndex = 0, sender, petId = null, token = null, maxCredits = null } = params;
    const ts = Math.floor(this.now());

    if (this.treasuryTransfer(chainId, txHash, logIndex)) {
      return { status: 'duplicate', credits: 0, petId: null };
    }

    const credits = Number(creditsFromWei(amountWei, BigInt(this.creditsPerFrens)));
    let status: string;
    let granted: number;

    if (!petId) {
      status = 'unmatched';
      granted = 0;
    } else if (credits <= 0) {
      status = 'dust';
      granted = 0;
    } else if (maxCredits !== null && maxCredits !== undefined && credits > maxCredits) {
      status = 'over_cap';
      granted = 0;
    } else {
      status = 'credited';
      granted = credits;
    }

    try {
      this.db.prepare(
        `INSERT INTO treasury_transfers(chain_id,tx_hash,log_index,sender,token,amount,pet_id,credits,status,created)
         VALUES(?,?,?,?,?,?,?,?,?,?)`
      ).run(
        Number(chainId),
        String(txHash).toLowerCase(),
        Number(logIndex),
        String(sender).toLowerCase(),
        token ? String(token).toLowerCase() : null,
        String(BigInt(amountWei)),
        petId,
        granted,
        status,
        ts
      );
    } catch (e: any) {
      if (String(e.message).includes('UNIQUE constraint failed')) {
        return { status: 'duplicate', credits: 0, petId: null };
      }
      throw e;
    }

    if (granted > 0 && petId) {
      this._grant(petId, granted, 'treasury', 'tx', String(txHash).toLowerCase());
    }

    return { status, credits: granted, petId };
  }

  // Ledger & Balances
  balance(petId: string): number {
    const row = this.db.prepare<{ balance: number }>(
      'SELECT balance FROM credit_accounts WHERE pet_id=?'
    ).get(petId);
    return row?.balance ?? 0;
  }

  history(petId: string, limit: number = 50): CreditLedgerEntry[] {
    const lim = Math.max(1, Math.min(Number(limit) || 50, 200));
    const rows = this.db.prepare<{
      delta: number;
      balance: number;
      reason: string;
      ref_type: string | null;
      ref_id: string | null;
      created: number;
    }>(
      'SELECT delta,balance,reason,ref_type,ref_id,created FROM credit_ledger WHERE pet_id=? ORDER BY id DESC LIMIT ?'
    ).all(petId, lim);

    return rows.map(r => ({
      delta: r.delta,
      balance: r.balance,
      reason: r.reason,
      refType: r.ref_type,
      refId: r.ref_id,
      created: r.created,
    }));
  }

  grant(
    petId: string,
    credits: number,
    reason: string = 'grant',
    refType: string | null = null,
    refId: string | null = null
  ): number {
    if (
      typeof credits !== 'number' ||
      typeof (credits as any) === 'boolean' ||
      !Number.isInteger(credits) ||
      credits <= 0
    ) {
      throw new Error('credits must be > 0');
    }
    return this._grant(petId, credits, reason, refType, refId);
  }

  spend(
    petId: string,
    credits: number,
    reason: string = 'spend',
    refType: string | null = null,
    refId: string | null = null
  ): number {
    if (
      typeof credits !== 'number' ||
      typeof (credits as any) === 'boolean' ||
      !Number.isInteger(credits) ||
      credits <= 0
    ) {
      throw new Error('credits must be > 0');
    }
    return this._grant(petId, -credits, reason, refType, refId);
  }

  _grant(
    petId: string,
    delta: number,
    reason: string,
    refType: string | null = null,
    refId: string | null = null
  ): number {
    const ts = Math.floor(this.now());
    if (delta < 0) {
      const spendAmount = -delta;
      return this.db.transaction(() => {
        const update = this.db.prepare(
          'UPDATE credit_accounts SET balance=balance-?, updated_at=? WHERE pet_id=? AND balance>=?'
        ).run(spendAmount, ts, petId, spendAmount);
        if (update.changes === 0) {
          throw new InsufficientCredits('not enough credits');
        }
        const row = this.db.prepare<{ balance: number }>(
          'SELECT balance FROM credit_accounts WHERE pet_id=?'
        ).get(petId);
        const balance = row?.balance ?? 0;
        this.db.prepare(
          'INSERT INTO credit_ledger(pet_id,delta,balance,reason,ref_type,ref_id,created) VALUES(?,?,?,?,?,?,?)'
        ).run(petId, delta, balance, reason, refType ?? null, refId ?? null, ts);
        return balance;
      })();
    } else {
      return this.db.transaction(() => {
        this.db.prepare(
          `INSERT INTO credit_accounts(pet_id,balance,updated_at) VALUES(?,?,?)
           ON CONFLICT(pet_id) DO UPDATE SET balance=credit_accounts.balance+excluded.balance, updated_at=excluded.updated_at`
        ).run(petId, delta, ts);
        const row = this.db.prepare<{ balance: number }>(
          'SELECT balance FROM credit_accounts WHERE pet_id=?'
        ).get(petId);
        const balance = row?.balance ?? 0;
        this.db.prepare(
          'INSERT INTO credit_ledger(pet_id,delta,balance,reason,ref_type,ref_id,created) VALUES(?,?,?,?,?,?,?)'
        ).run(petId, delta, balance, reason, refType ?? null, refId ?? null, ts);
        return balance;
      })();
    }
  }
}
