import { DatabaseConnection } from '../db/connection.js';
import { toChecksumAddress } from '../crypto/signatures.js';
import { validateRobotTokenId } from './robot-care-rules.js';
import { robotCompanion, ROBOTS_CONTRACT, ROBOTS_CHAIN_ID } from '../media/robot-companion-art.js';

export const TTL = 86400;

export interface RobotsVerifier {
  discover(address: string): Promise<{ nfts: any[]; partial: boolean }>;
  read(address: string, tokenId: number): Promise<any>;
  ownerOf(address: string, tokenId: number): Promise<boolean>;
}

export type RpcFunction = (method: string, params: any[]) => Promise<any>;

export class Robots implements RobotsVerifier {
  public rpc: RpcFunction;
  public owner_batch: (ids: number[]) => Promise<Record<string, string>>;

  constructor(
    private db: DatabaseConnection,
    private rpcUrl: string = 'https://base-rpc.publicnode.com',
    private now: () => number = () => Date.now() / 1000
  ) {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS robot_ownership(wallet TEXT, token_id INTEGER, checked REAL, payload TEXT, PRIMARY KEY(wallet,token_id));' +
      'CREATE TABLE IF NOT EXISTS robot_discovery(wallet TEXT PRIMARY KEY, block INTEGER, ids TEXT);' +
      'CREATE TABLE IF NOT EXISTS robot_owner_inventory(id INTEGER PRIMARY KEY, checked REAL, owners TEXT);'
    );

    this.rpc = this._defaultRpc.bind(this);
    this.owner_batch = this._defaultOwnerBatch.bind(this);
  }

  private async _defaultRpc(method: string, params: any[]): Promise<any> {
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'TinyFrens/1.0',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      throw new Error(`Base RPC HTTP error: ${response.status}`);
    }

    const data: any = await response.json();
    if (data.error) {
      const err = data.error;
      // ERC721A burned/unminted ID
      if (err.code === 3 && (err.data === '0xdf2d9b42' || err.data === '0xa14c4b50')) {
        return null;
      }
      throw new Error(`Base RPC: ${err.message || 'request failed'}`);
    }

    if (!('result' in data)) {
      throw new Error('Invalid Base RPC response');
    }

    return data.result;
  }

  async call(selector: string, argument: number | bigint | string, block: string = 'latest'): Promise<any> {
    let hexArg: string;
    if (typeof argument === 'number' || typeof argument === 'bigint') {
      hexArg = argument.toString(16).padStart(64, '0');
    } else if (typeof argument === 'string' && argument.startsWith('0x')) {
      hexArg = argument.slice(2).toLowerCase().padStart(64, '0');
    } else {
      hexArg = String(argument).padStart(64, '0');
    }

    return await this.rpc('eth_call', [
      {
        to: ROBOTS_CONTRACT,
        data: selector + hexArg,
      },
      block,
    ]);
  }

  async read(wallet: string, tid: number | string): Promise<any> {
    const tokenId = validateRobotTokenId(tid);
    const checksumWallet = toChecksumAddress(wallet);
    const currentTime = this.now();

    const row = this.db.prepare<{ checked: number; payload: string }>(
      'SELECT checked, payload FROM robot_ownership WHERE wallet=? AND token_id=?'
    ).get(checksumWallet, tokenId);

    if (row && row.checked <= currentTime && currentTime < row.checked + TTL) {
      try {
        return JSON.parse(row.payload);
      } catch {
        // Fall through on JSON parse error
      }
    }

    const chainId = await this.rpc('eth_chainId', []);
    if (chainId !== '0x2105') {
      throw new Error('Robots v1 RPC must be Base mainnet');
    }

    const block = await this.rpc('eth_blockNumber', []);
    const ownerRaw = await this.call('0x6352211e', tokenId, block);

    if (ownerRaw !== null && !/^0x0{24}[0-9a-fA-F]{40}$/.test(ownerRaw)) {
      throw new Error('Invalid robot ownership response');
    }

    const owner = ownerRaw
      ? toChecksumAddress('0x' + ownerRaw.slice(-40))
      : null;

    const active = owner?.toLowerCase() === checksumWallet.toLowerCase();
    let metadata: any = {};
    let rig: any = null;

    if (active) {
      const encoded = await this.call('0xc87b56dd', tokenId, block);
      if (typeof encoded !== 'string' || !encoded.startsWith('0x')) {
        throw new Error('Invalid robot metadata response');
      }
      const rawHex = encoded.slice(2);
      if (rawHex.length < 128) {
        throw new Error('Invalid robot metadata response');
      }
      const offset = Number(BigInt('0x' + rawHex.slice(0, 64)));
      const length = Number(BigInt('0x' + rawHex.slice(64, 128)));
      if (offset !== 32 || length <= 0 || length > 100_000 || 128 + length * 2 > rawHex.length) {
        throw new Error('Invalid robot metadata response');
      }
      const uri = Buffer.from(rawHex.slice(128, 128 + length * 2), 'hex').toString('utf-8');
      if (!uri.startsWith('data:application/json;base64,')) {
        throw new Error('Robot metadata is not embedded');
      }
      const jsonBase64 = uri.slice('data:application/json;base64,'.length);
      metadata = JSON.parse(Buffer.from(jsonBase64, 'base64').toString('utf-8'));
      if (metadata.image) {
        rig = robotCompanion(metadata.image);
      }
    }

    const checked = currentTime;
    const result = {
      tokenId,
      wallet: checksumWallet,
      originalOwner: owner,
      active,
      image: metadata.image ?? null,
      name: String(metadata.name ?? `TinyFrens Robot v1 #${tokenId}`).slice(0, 80),
      collection: 'TinyFrens: Robots v1',
      originalAddress: ROBOTS_CONTRACT,
      chainId: ROBOTS_CHAIN_ID,
      companion: rig,
      checkedAt: checked,
      validUntil: checked + TTL,
    };

    this.db.prepare('DELETE FROM robot_ownership WHERE wallet=? AND token_id=?').run(checksumWallet, tokenId);
    if (active) {
      this.db.prepare('INSERT INTO robot_ownership VALUES(?, ?, ?, ?)').run(
        checksumWallet,
        tokenId,
        checked,
        JSON.stringify(result)
      );
    }

    return result;
  }

  async ownerOf(wallet: string, tid: number | string): Promise<boolean> {
    const tokenId = validateRobotTokenId(tid);
    const checksumWallet = toChecksumAddress(wallet);

    const chainId = await this.rpc('eth_chainId', []);
    if (chainId !== '0x2105') {
      throw new Error('Robots v1 RPC must be Base mainnet');
    }

    const ownerRaw = await this.call('0x6352211e', tokenId);
    if (ownerRaw !== null && !/^0x0{24}[0-9a-fA-F]{40}$/.test(ownerRaw)) {
      throw new Error('Invalid robot ownership response');
    }

    const owner = ownerRaw
      ? toChecksumAddress('0x' + ownerRaw.slice(-40))
      : null;

    return owner?.toLowerCase() === checksumWallet.toLowerCase();
  }

  private async _defaultOwnerBatch(ids: number[]): Promise<Record<string, string>> {
    const requests = ids.map(tid => ({
      jsonrpc: '2.0',
      id: tid,
      method: 'eth_call',
      params: [
        {
          to: ROBOTS_CONTRACT,
          data: '0x6352211e' + tid.toString(16).padStart(64, '0'),
        },
        'latest',
      ],
    }));

    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'TinyFrens/1.0',
      },
      body: JSON.stringify(requests),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      throw new Error('Invalid robot inventory batch');
    }

    const data: any = await response.json();
    if (!Array.isArray(data) || data.length !== requests.length) {
      throw new Error('Invalid robot inventory batch');
    }

    const requestedIds = new Set(requests.map(r => r.id));
    const responseIds = new Set(data.map(d => d.id));
    if (requestedIds.size !== responseIds.size || ![...requestedIds].every(id => responseIds.has(id))) {
      throw new Error('Invalid robot inventory IDs');
    }

    const owners: Record<string, string> = {};
    for (const item of data) {
      const err = item.error;
      if (err && err.code === 3 && (err.data === '0xdf2d9b42' || err.data === '0xa14c4b50')) {
        continue;
      }
      const raw = item.result ?? '';
      if (err || !/^0x0{24}[0-9a-fA-F]{40}$/.test(raw)) {
        throw new Error('Robot inventory ownership unavailable');
      }
      if (BigInt(raw) !== 0n) {
        owners[String(item.id)] = '0x' + raw.slice(-40);
      }
    }

    return owners;
  }

  async discover(wallet: string): Promise<{ nfts: any[]; partial: boolean }> {
    const checksumWallet = toChecksumAddress(wallet);
    const chainId = await this.rpc('eth_chainId', []);
    if (chainId !== '0x2105') {
      throw new Error('Robots v1 RPC must be Base mainnet');
    }

    const balanceRaw = await this.call('0x70a08231', checksumWallet);
    if (typeof balanceRaw !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(balanceRaw)) {
      throw new Error('Invalid robot balance');
    }

    const balance = Number(BigInt(balanceRaw));
    if (balance === 0) {
      return { nfts: [], partial: false };
    }

    const row = this.db.prepare<{ checked: number; owners: string }>(
      'SELECT checked, owners FROM robot_owner_inventory WHERE id=1'
    ).get();

    let owners: Record<string, string> = {};
    if (row) {
      try {
        owners = JSON.parse(row.owners);
      } catch {
        owners = {};
      }
    }

    const owned = Object.entries(owners)
      .filter(([_, o]) => o.toLowerCase() === checksumWallet.toLowerCase())
      .map(([tid]) => tid);

    const currentTime = this.now();
    if (!row || !(currentTime - row.checked >= 0 && currentTime - row.checked < 600) || owned.length !== balance) {
      const supplyRaw = await this.rpc('eth_call', [
        { to: ROBOTS_CONTRACT, data: '0x18160ddd' },
        'latest',
      ]);
      if (typeof supplyRaw !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(supplyRaw)) {
        throw new Error('Invalid robot supply');
      }
      const supply = Number(BigInt(supplyRaw));
      if (supply > 2664) {
        throw new Error('Robot supply exceeds collection limit');
      }

      owners = {};
      for (let start = 1; start <= 2664; start += 20) {
        if (Object.keys(owners).length >= supply) break;
        const batchIds: number[] = [];
        for (let i = start; i < Math.min(start + 20, 2665); i++) {
          batchIds.push(i);
        }
        const batchRes = await this.owner_batch(batchIds);
        Object.assign(owners, batchRes);
      }

      if (Object.keys(owners).length !== supply) {
        throw new Error('Robot inventory does not match current supply');
      }

      this.db.prepare('INSERT OR REPLACE INTO robot_owner_inventory VALUES(1, ?, ?)').run(
        currentTime,
        JSON.stringify(owners)
      );
    }

    const ids = Object.entries(owners)
      .filter(([_, o]) => o.toLowerCase() === checksumWallet.toLowerCase())
      .map(([tid]) => Number(tid))
      .sort((a, b) => a - b);

    const nfts: any[] = [];
    for (const tid of ids) {
      const data = await this.read(checksumWallet, tid);
      if (data.active) {
        nfts.push({
          tokenId: data.tokenId,
          wallet: data.wallet,
          name: data.name,
          collection: data.collection,
          originalAddress: data.originalAddress,
          chainId: data.chainId,
          image: data.image,
        });
      }
    }

    if (nfts.length === 0) {
      throw new Error('Robot balance exists but owned NFTs could not be resolved');
    }

    return { nfts, partial: false };
  }
}
