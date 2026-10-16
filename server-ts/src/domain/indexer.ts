import { getAddress, keccak256, stringToBytes } from 'viem';
import { DatabaseConnection } from '../db/connection.js';
import { Economy, DepositSession } from './economy.js';

export function resolveWalletPet(db: DatabaseConnection, sender: string): string | null {
  const rows = db.prepare<{ pet_id: string }>(
    'SELECT pet_id FROM wallet_links WHERE address = ? COLLATE NOCASE'
  ).all(sender);
  const pets = Array.from(new Set(rows.map(r => r.pet_id)));
  return pets.length === 1 ? pets[0] : null;
}

export const DEPOSIT_TOPIC = keccak256(stringToBytes('Deposit(bytes32,address,address,uint256)'));
export const TRANSFER_TOPIC = keccak256(stringToBytes('Transfer(address,address,uint256)'));
export const OPEN_STATUSES = ['open', 'confirmed'] as const;

export const INDEXER_SCHEMA = 'CREATE TABLE IF NOT EXISTS indexer_state(key TEXT PRIMARY KEY, value TEXT);';

export class IndexerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndexerError';
  }
}

export interface RpcLog {
  address: string;
  topics: string[];
  data?: string;
  transactionHash: string;
  logIndex: string | number;
  blockNumber?: string | number;
}

export function decodeDepositLog(log: RpcLog): {
  sessionId: string;
  sender: string;
  token: string;
  amount: bigint;
} {
  const topics = log.topics || [];
  if (topics.length !== 4) {
    throw new IndexerError('not a Deposit log');
  }
  if (topics[0].toLowerCase() !== DEPOSIT_TOPIC.toLowerCase()) {
    throw new IndexerError('not our Deposit topic');
  }
  const sessionId = topics[1];
  const sender = getAddress('0x' + topics[2].slice(-40));
  const token = getAddress('0x' + topics[3].slice(-40));
  const dataHex = String(log.data || '').replace(/^0x/, '');
  const amount = dataHex.length > 0 ? BigInt('0x' + dataHex.slice(-64)) : 0n;
  return { sessionId, sender, token, amount };
}

export function decodeTransferLog(log: RpcLog): {
  sender: string;
  recipient: string;
  amount: bigint;
} {
  const topics = log.topics || [];
  if (topics.length !== 3 || topics[0].toLowerCase() !== TRANSFER_TOPIC.toLowerCase()) {
    throw new IndexerError('not a Transfer log');
  }
  const sender = getAddress('0x' + topics[1].slice(-40));
  const recipient = getAddress('0x' + topics[2].slice(-40));
  const dataHex = String(log.data || '').replace(/^0x/, '');
  const amount = dataHex.length > 0 && dataHex !== '0x' ? BigInt('0x' + dataHex.slice(-64)) : 0n;
  return { sender, recipient, amount };
}

export type FetchFunction = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface DepositIndexerOptions {
  economy: Economy;
  rpcUrl: string;
  chainId: number;
  pollSeconds?: number;
  lookback?: number;
  startBlock?: string | number;
  maxBlockSpan?: number;
  fetcher?: FetchFunction;
  onError?: (error: unknown) => void;
}

export class DepositIndexer {
  economy: Economy;
  rpcUrl: string;
  chainId: number;
  poll: number;
  lookback: number;
  startBlock: string | number;
  maxSpan: number;
  private fetcher: FetchFunction;
  private onError?: (error: unknown) => void;
  private stopFlag = false;
  private runningPromise: Promise<void> | null = null;

  constructor(options: DepositIndexerOptions) {
    this.economy = options.economy;
    this.rpcUrl = options.rpcUrl.replace(/\/+$/, '');
    this.chainId = Number(options.chainId);
    this.poll = Number(options.pollSeconds ?? 6);
    this.lookback = Number(options.lookback ?? 300);
    this.startBlock = options.startBlock ?? 'latest';
    this.maxSpan = Number(options.maxBlockSpan ?? 2000);
    this.fetcher = options.fetcher || globalThis.fetch;
    this.onError = options.onError;

    this.economy.db.exec(INDEXER_SCHEMA);
  }

  async rpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
    const res = await this.fetcher(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(30000),
    });
    const data = (await res.json()) as any;
    if (data?.error) {
      const errMsg = typeof data.error === 'object' ? data.error.message || JSON.stringify(data.error) : data.error;
      throw new IndexerError(`rpc ${method}: ${errMsg}`);
    }
    return data.result as T;
  }

  async blockNumber(): Promise<number> {
    const hex = await this.rpc<string>('eth_blockNumber', []);
    return parseInt(hex, 16);
  }

  sessionAddresses(): string[] {
    const rows = this.economy.db
      .prepare<{ address: string }>(
        'SELECT address FROM deposit_sessions WHERE status IN (?, ?)'
      )
      .all(OPEN_STATUSES[0], OPEN_STATUSES[1]);
    const addrs = Array.from(new Set(rows.map(r => r.address.toLowerCase())));
    addrs.sort();
    return addrs;
  }

  sessionForLog(
    _log: RpcLog,
    sessionId: string,
    address: string
  ): DepositSession | null {
    try {
      const cand = this.economy.session(sessionId);
      if (cand.address.toLowerCase() === address.toLowerCase()) {
        return cand;
      }
      return null;
    } catch {
      // Historical address-pool sessions did not have an on-chain session id.
    }
    const legacy = this.economy.openSessionForAddress(address);
    return legacy?.purchaseKind === 'legacy_credit' ? legacy : null;
  }

  async scan(fromBlock: number, toBlock: number): Promise<number> {
    const addresses = this.sessionAddresses();
    if (addresses.length === 0) {
      return 0;
    }

    const params = {
      fromBlock: '0x' + fromBlock.toString(16),
      toBlock: '0x' + toBlock.toString(16),
      address: addresses,
      topics: [DEPOSIT_TOPIC],
    };

    const logs = await this.rpc<RpcLog[]>('eth_getLogs', [params]);
    let confirmed = 0;

    for (const raw of logs || []) {
      let decoded: ReturnType<typeof decodeDepositLog>;
      try {
        decoded = decodeDepositLog(raw);
      } catch {
        continue;
      }

      const session = this.sessionForLog(raw, decoded.sessionId, raw.address);
      if (!session || session.status !== 'open') {
        continue;
      }
      if (session.token && decoded.token.toLowerCase() !== session.token.toLowerCase()) {
        continue;
      }

      try {
        const logIndex =
          typeof raw.logIndex === 'string' ? parseInt(raw.logIndex, 16) : Number(raw.logIndex || 0);
        const result = this.economy.confirm(
          session.id,
          raw.transactionHash,
          decoded.amount,
          this.chainId,
          logIndex,
          getAddress(raw.address)
        );
        if (result.status === 'confirmed') {
          confirmed++;
        }
      } catch {
        continue;
      }
    }

    return confirmed;
  }

  stateLast(): number | null {
    const row = this.economy.db
      .prepare<{ value: string }>('SELECT value FROM indexer_state WHERE key=?')
      .get('last_block');
    return row ? parseInt(row.value, 10) : null;
  }

  stateSave(block: number): void {
    this.economy.db
      .prepare(
        'INSERT INTO indexer_state(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
      )
      .run('last_block', String(block));
  }

  private async blockNumberOrInject(head: number): Promise<number> {
    if (this.startBlock === 'latest') {
      return Math.max(0, head - this.lookback);
    }
    if (this.startBlock === 'earliest') {
      return 0;
    }
    return Math.max(0, parseInt(String(this.startBlock), 10));
  }

  async runOnce(): Promise<{ confirmed: number; blocks: number }> {
    const head = await this.blockNumber();
    let last = this.stateLast();
    if (last === null) {
      last = await this.blockNumberOrInject(head);
      if (last > head) {
        last = head;
      }
      this.stateSave(last);
    }

    const frm = last + 1;
    if (frm > head) {
      return { confirmed: 0, blocks: 0 };
    }

    let confirmed = 0;
    let lo = frm;
    while (lo <= head) {
      const hi = Math.min(lo + this.maxSpan - 1, head);
      confirmed += await this.scan(lo, hi);
      lo = hi + 1;
    }

    this.stateSave(head);
    return { confirmed, blocks: head - frm + 1 };
  }

  async runForever(stopSignal?: AbortSignal): Promise<void> {
    this.stopFlag = false;
    while (!this.stopFlag && !stopSignal?.aborted) {
      try {
        await this.runOnce();
      } catch (error) {
        this.onError?.(error);
      }
      if (this.stopFlag || stopSignal?.aborted) break;
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, this.poll * 1000);
        stopSignal?.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  start(stopSignal?: AbortSignal): Promise<void> {
    this.runningPromise = this.runForever(stopSignal);
    return this.runningPromise;
  }

  stop(): void {
    this.stopFlag = true;
  }

  async aclose(): Promise<void> {
    this.stop();
    if (this.runningPromise) {
      await Promise.race([
        this.runningPromise,
        new Promise(resolve => setTimeout(resolve, 10000)),
      ]);
    }
  }
}

export interface TreasuryTransferIndexerOptions {
  economy: Economy;
  rpcUrl: string;
  chainId: number;
  treasury: string;
  token?: string | null;
  pollSeconds?: number;
  lookback?: number;
  startBlock?: string | number;
  maxBlockSpan?: number;
  resolve?: (sender: string) => string | null;
  maxCredits?: number | null;
  fetcher?: FetchFunction;
  onError?: (error: unknown) => void;
}

export class TreasuryTransferIndexer {
  economy: Economy;
  rpcUrl: string;
  chainId: number;
  treasury: string;
  token: string | null;
  poll: number;
  lookback: number;
  startBlock: string | number;
  maxSpan: number;
  resolve: ((sender: string) => string | null) | null;
  maxCredits: number | null;
  private fetcher: FetchFunction;
  private onError?: (error: unknown) => void;
  private stopFlag = false;
  private runningPromise: Promise<void> | null = null;

  constructor(options: TreasuryTransferIndexerOptions) {
    this.economy = options.economy;
    this.rpcUrl = options.rpcUrl.replace(/\/+$/, '');
    this.chainId = Number(options.chainId);
    this.treasury = getAddress(options.treasury);
    this.token = options.token ? getAddress(options.token) : null;
    this.poll = Number(options.pollSeconds ?? 6);
    this.lookback = Number(options.lookback ?? 300);
    this.startBlock = options.startBlock ?? 'latest';
    this.maxSpan = Number(options.maxBlockSpan ?? 2000);
    this.resolve = options.resolve || null;
    this.maxCredits = options.maxCredits !== undefined ? options.maxCredits : null;
    this.fetcher = options.fetcher || globalThis.fetch;
    this.onError = options.onError;

    this.economy.db.exec(INDEXER_SCHEMA);
  }

  async rpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
    const res = await this.fetcher(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(30000),
    });
    const data = (await res.json()) as any;
    if (data?.error) {
      const errMsg = typeof data.error === 'object' ? data.error.message || JSON.stringify(data.error) : data.error;
      throw new IndexerError(`rpc ${method}: ${errMsg}`);
    }
    return data.result as T;
  }

  async blockNumber(): Promise<number> {
    const hex = await this.rpc<string>('eth_blockNumber', []);
    return parseInt(hex, 16);
  }

  recipientTopic(): string {
    return '0x' + this.treasury.slice(2).toLowerCase().padStart(64, '0');
  }

  resolveSender(sender: string): string | null {
    if (!this.resolve) return null;
    return this.resolve(sender);
  }

  async scan(fromBlock: number, toBlock: number): Promise<number> {
    const params: Record<string, unknown> = {
      fromBlock: '0x' + fromBlock.toString(16),
      toBlock: '0x' + toBlock.toString(16),
      topics: [TRANSFER_TOPIC, null, this.recipientTopic()],
    };
    if (this.token) {
      params.address = this.token;
    }

    const logs = await this.rpc<RpcLog[]>('eth_getLogs', [params]);
    let credited = 0;

    for (const raw of logs || []) {
      let decoded: ReturnType<typeof decodeTransferLog>;
      try {
        decoded = decodeTransferLog(raw);
      } catch {
        continue;
      }

      if (decoded.recipient.toLowerCase() !== this.treasury.toLowerCase()) {
        continue;
      }

      const petId = this.resolveSender(decoded.sender);
      try {
        const logIndex =
          typeof raw.logIndex === 'string' ? parseInt(raw.logIndex, 16) : Number(raw.logIndex || 0);
        const result = this.economy.creditTransfer({
          txHash: raw.transactionHash,
          amountWei: decoded.amount,
          chainId: this.chainId,
          logIndex,
          sender: decoded.sender,
          petId,
          token: raw.address,
          maxCredits: this.maxCredits,
        });

        if (result.status === 'credited') {
          credited++;
        }
      } catch {
        continue;
      }
    }

    return credited;
  }

  stateLast(): number | null {
    const row = this.economy.db
      .prepare<{ value: string }>('SELECT value FROM indexer_state WHERE key=?')
      .get('treasury_last_block');
    return row ? parseInt(row.value, 10) : null;
  }

  stateSave(block: number): void {
    this.economy.db
      .prepare(
        'INSERT INTO indexer_state(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
      )
      .run('treasury_last_block', String(block));
  }

  async runOnce(): Promise<{ credited: number; blocks: number }> {
    const head = await this.blockNumber();
    let last = this.stateLast();
    if (last === null) {
      if (this.startBlock === 'latest') {
        last = Math.max(0, head - this.lookback);
      } else if (this.startBlock === 'earliest') {
        last = 0;
      } else {
        last = Math.max(0, parseInt(String(this.startBlock), 10));
      }
      if (last > head) {
        last = head;
      }
      this.stateSave(last);
    }

    const frm = last + 1;
    if (frm > head) {
      return { credited: 0, blocks: 0 };
    }

    let credited = 0;
    let lo = frm;
    while (lo <= head) {
      const hi = Math.min(lo + this.maxSpan - 1, head);
      credited += await this.scan(lo, hi);
      lo = hi + 1;
    }

    this.stateSave(head);
    return { credited, blocks: head - frm + 1 };
  }

  async runForever(stopSignal?: AbortSignal): Promise<void> {
    this.stopFlag = false;
    while (!this.stopFlag && !stopSignal?.aborted) {
      try {
        await this.runOnce();
      } catch (error) {
        this.onError?.(error);
      }
      if (this.stopFlag || stopSignal?.aborted) break;
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, this.poll * 1000);
        stopSignal?.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  start(stopSignal?: AbortSignal): Promise<void> {
    this.runningPromise = this.runForever(stopSignal);
    return this.runningPromise;
  }

  stop(): void {
    this.stopFlag = true;
  }

  async aclose(): Promise<void> {
    this.stop();
    if (this.runningPromise) {
      await Promise.race([
        this.runningPromise,
        new Promise(resolve => setTimeout(resolve, 10000)),
      ]);
    }
  }
}
