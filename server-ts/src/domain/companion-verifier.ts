import { DatabaseConnection } from '../db/connection.js';
import { toChecksumAddress } from '../crypto/signatures.js';
import { validateRobotTokenId } from './robot-care-rules.js';
export { Robots, type RobotsVerifier } from './robots-verifier.js';
import type { RobotsVerifier } from './robots-verifier.js';
import { botsComputerCompanion } from '../media/bots-computer-art.js';
import { nubCompanion } from '../media/nub-art.js';

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
  public rpc: (collection: string, requests: RpcRequest[]) => Promise<Map<number, RpcResponse>>;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private db: DatabaseConnection,
    private robinhoodRpcUrl = 'https://rpc.mainnet.chain.robinhood.com',
    private robotsRpcUrl = 'https://base-rpc.publicnode.com',
    private now: () => number = () => Date.now() / 1000,
    private fetcher: typeof fetch = fetch
  ) {
    this.rpc = this.defaultRpc.bind(this);
  }

  async discover(addresses: string[], collection: string): Promise<{ nfts: any[]; partial: boolean }> {
    collection = collection.toLowerCase();
    const meta = EXTRA_COLLECTIONS[collection];
    if (!meta) throw new Error('Unsupported companion collection');
    const [chainId, maximum, name] = meta;
    const owners = await this.withLock(collection, async () => {
      const cached = this.db.prepare<{ checked: number; owners: string }>(
        'SELECT checked, owners FROM extra_companion_inventory WHERE collection=?'
      ).get(collection);
      if (cached && cached.checked <= this.now() && this.now() - cached.checked < 600) {
        return JSON.parse(cached.owners) as Record<string, string>;
      }
      const chain = await this.rpc(collection, [{ jsonrpc: '2.0', id: 0, method: 'eth_chainId', params: [] }]);
      if (chain.get(0)?.result !== `0x${chainId.toString(16)}`) throw new Error('Wrong collection RPC chain');
      const discovered = chainId === 4663
        ? await this.discoverFromLogs(collection, maximum)
        : await this.discoverSequential(collection, maximum);
      this.db.prepare('INSERT OR REPLACE INTO extra_companion_inventory VALUES(?, ?, ?)').run(
        collection,
        this.now(),
        JSON.stringify(discovered)
      );
      return discovered;
    });
    const linked = new Map(addresses.map(address => [address.toLowerCase(), address]));
    const nfts = Object.entries(owners).flatMap(([tokenId, owner]) => {
      const wallet = linked.get(owner);
      return wallet ? [{
        tokenId: Number(tokenId),
        wallet,
        collection: name,
        name: `${name} #${tokenId}`,
        chainId,
        originalAddress: collection,
      }] : [];
    });
    return { nfts, partial: false };
  }

  async read(address: string, tokenId: number, collection: string): Promise<any> {
    collection = collection.toLowerCase();
    const meta = EXTRA_COLLECTIONS[collection];
    if (!meta) throw new Error('Unsupported companion collection');
    const [chainId, maximum, name] = meta;
    if (typeof tokenId === 'boolean' || !/^\d+$/.test(String(tokenId)) || tokenId < 1 || tokenId > maximum) {
      throw new Error('Invalid companion token');
    }
    const checksum = toChecksumAddress(address);
    const row = this.db.prepare<{ checked: number; payload: string }>(
      'SELECT checked, payload FROM extra_companion_ownership WHERE wallet=? AND collection=? AND token=?'
    ).get(checksum, collection, tokenId);
    if (row && row.checked <= this.now() && this.now() - row.checked < 86400) {
      try {
        return this.withCompanion(collection, JSON.parse(row.payload));
      } catch {
        // fall through
      }
    }
    const ownerCall = `0x6352211e${tokenId.toString(16).padStart(64, '0')}`;
    const ownership = await this.rpc(collection, [
      { jsonrpc: '2.0', id: 0, method: 'eth_chainId', params: [] },
      { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: collection, data: ownerCall }, 'latest'] },
    ]);
    if (ownership.get(0)?.result !== `0x${chainId.toString(16)}`) throw new Error('Wrong companion chain');
    const rawOwner = ownership.get(1)?.result;
    if (typeof rawOwner !== 'string' || !/^0x0{24}[0-9a-fA-F]{40}$/.test(rawOwner)) {
      throw new Error('Ownership verification unavailable');
    }
    const owner = toChecksumAddress(`0x${rawOwner.slice(-40)}`);
    const active = owner === checksum;
    let metadata: Record<string, unknown> = {};
    if (active) metadata = await this.metadata(collection, tokenId);
    const checked = this.now();
    const data = {
      tokenId,
      wallet: checksum,
      originalOwner: owner,
      active,
      image: metadata.image ?? null,
      name: metadata.name ?? `${name} #${tokenId}`,
      collection: name,
      originalAddress: collection,
      chainId,
      checkedAt: checked,
      validUntil: checked + 86400,
    };
    this.db.prepare('DELETE FROM extra_companion_ownership WHERE wallet=? AND collection=? AND token=?').run(
      checksum,
      collection,
      tokenId
    );
    if (active) {
      this.db.prepare('INSERT INTO extra_companion_ownership VALUES(?, ?, ?, ?, ?)').run(
        checksum,
        collection,
        tokenId,
        checked,
        JSON.stringify(data)
      );
    }
    return this.withCompanion(collection, data);
  }

  private async defaultRpc(collection: string, requests: RpcRequest[]): Promise<Map<number, RpcResponse>> {
    const [chainId] = EXTRA_COLLECTIONS[collection];
    const response = await this.fetcher(chainId === 4663 ? this.robinhoodRpcUrl : this.robotsRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'TinyFrens/1.0' },
      body: JSON.stringify(requests),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Collection RPC HTTP error: ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data) || data.length !== requests.length) throw new Error('Invalid collection RPC batch');
    return new Map(data.map(item => [Number(item.id), item as RpcResponse]));
  }

  private async discoverFromLogs(collection: string, maximum: number): Promise<Record<string, string>> {
    const headResponse = await this.rpc(collection, [{ jsonrpc: '2.0', id: 0, method: 'eth_blockNumber', params: [] }]);
    const head = parseQuantity(headResponse.get(0)?.result);
    if (head > 200_000_000) throw new Error('Collection discovery range exceeds budget');
    const owners: Record<string, string> = {};
    for (let start = 0; start <= head; start += 10_000_000) {
      const response = await this.rpc(collection, [{
        jsonrpc: '2.0',
        id: 0,
        method: 'eth_getLogs',
        params: [{
          address: collection,
          fromBlock: `0x${start.toString(16)}`,
          toBlock: `0x${Math.min(head, start + 9_999_999).toString(16)}`,
          topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],
        }],
      }]);
      const logs = response.get(0)?.result;
      if (!Array.isArray(logs)) throw new Error('Collection transfer history unavailable');
      logs.sort((left, right) => parseQuantity(left.blockNumber) - parseQuantity(right.blockNumber) ||
        parseQuantity(left.logIndex) - parseQuantity(right.logIndex));
      for (const log of logs) {
        const topics = Array.isArray(log.topics) ? log.topics : [];
        if (log.removed || topics.length !== 4 || String(log.address || '').toLowerCase() !== collection) continue;
        const tokenId = parseQuantity(topics[3]);
        if (tokenId < 1 || tokenId > maximum) continue;
        const owner = `0x${String(topics[2]).slice(-40).toLowerCase()}`;
        if (BigInt(owner) !== 0n) owners[String(tokenId)] = owner;
        else delete owners[String(tokenId)];
      }
    }
    return owners;
  }

  private async discoverSequential(collection: string, maximum: number): Promise<Record<string, string>> {
    const supplyResponse = await this.rpc(collection, [{
      jsonrpc: '2.0', id: 0, method: 'eth_call', params: [{ to: collection, data: '0x18160ddd' }, 'latest'],
    }]);
    const supply = parseQuantity(supplyResponse.get(0)?.result);
    if (supply > maximum) throw new Error('Collection exceeds discovery budget');
    const owners: Record<string, string> = {};
    for (let start = 1; start <= maximum && Object.keys(owners).length < supply; start += 20) {
      const requests: RpcRequest[] = Array.from(
        { length: Math.min(20, maximum - start + 1) },
        (_, index) => start + index
      ).map(id => ({
        jsonrpc: '2.0' as const,
        id,
        method: 'eth_call',
        params: [{ to: collection, data: `0x6352211e${id.toString(16).padStart(64, '0')}` }, 'latest'],
      }));
      const results = await this.rpc(collection, requests);
      for (const request of requests) {
        const result = results.get(request.id);
        const raw = result?.result;
        if (typeof raw === 'string' && /^0x0{24}[0-9a-fA-F]{40}$/.test(raw)) {
          owners[String(request.id)] = `0x${raw.slice(-40).toLowerCase()}`;
        } else if (result?.error?.code !== 3) throw new Error('Collection ownership scan unavailable');
      }
    }
    if (Object.keys(owners).length !== supply) throw new Error('Collection inventory and supply disagree');
    return owners;
  }

  private async metadata(collection: string, tokenId: number): Promise<Record<string, unknown>> {
    const response = await this.rpc(collection, [{
      jsonrpc: '2.0',
      id: 0,
      method: 'eth_call',
      params: [{ to: collection, data: `0xc87b56dd${tokenId.toString(16).padStart(64, '0')}` }, 'latest'],
    }]);
    const encoded = response.get(0)?.result;
    if (typeof encoded !== 'string' || !encoded.startsWith('0x')) throw new Error('Invalid companion metadata');
    const raw = Buffer.from(encoded.slice(2), 'hex');
    if (raw.length < 64 || Number(raw.readBigUInt64BE(24)) !== 32) throw new Error('Invalid companion metadata');
    const length = Number(raw.readBigUInt64BE(56));
    if (length <= 0 || length > 100_000 || 64 + length > raw.length) throw new Error('Invalid companion metadata');
    const uri = raw.subarray(64, 64 + length).toString();
    if (uri.startsWith('data:application/json;base64,')) {
      return JSON.parse(Buffer.from(uri.slice('data:application/json;base64,'.length), 'base64').toString());
    }
    if (collection !== '0x34d9e560ee16662d19e44315a822bd51eea0133c' || uri !== `https://thenubs.xyz/meta/${tokenId}`) {
      throw new Error('Unsupported companion metadata location');
    }
    const metadataResponse = await this.fetcher(uri, { signal: AbortSignal.timeout(20_000) });
    if (!metadataResponse.ok) throw new Error(`Nub metadata HTTP error: ${metadataResponse.status}`);
    const metadata = await metadataResponse.json() as Record<string, unknown>;
    const image = metadata.image;
    const expectedImage = `https://thenubs.xyz/art/${tokenId}.png`;
    if (image !== expectedImage) throw new Error('Unexpected Nub artwork location');
    const imageResponse = await this.fetcher(expectedImage, { signal: AbortSignal.timeout(20_000) });
    if (!imageResponse.ok) throw new Error(`Nub artwork HTTP error: ${imageResponse.status}`);
    const art = Buffer.from(await imageResponse.arrayBuffer());
    if (art.length > 5_000_000) throw new Error('Nub artwork too large');
    metadata.image = `data:image/png;base64,${art.toString('base64')}`;
    return metadata;
  }

  private withCompanion(collection: string, data: Record<string, any>): Record<string, any> {
    return {
      ...data,
      companion: data.active
        ? (collection === '0x34d9e560ee16662d19e44315a822bd51eea0133c'
          ? nubCompanion(data.image)
          : botsComputerCompanion(data.image))
        : null,
    };
  }

  private async withLock<T>(collection: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(collection) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.locks.set(collection, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(collection) === current) this.locks.delete(collection);
    }
  }
}

interface RpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: unknown[];
}

interface RpcResponse {
  id?: number;
  result?: any;
  error?: { code?: number; message?: string };
}

function parseQuantity(value: unknown): number {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new Error('Invalid collection RPC quantity');
  const result = Number(BigInt(value));
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Invalid collection RPC quantity');
  return result;
}
