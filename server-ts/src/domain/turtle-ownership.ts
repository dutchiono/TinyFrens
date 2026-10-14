import { DatabaseConnection } from '../db/connection.js';
import { toChecksumAddress } from '../crypto/signatures.js';
import { CompanionRig, withCompanion } from '../media/hood-turtle-art.js';

export const HOOD_TURTLE_COLLECTION = '0xca28587b61eac19a87dfcfd9420870867a916675';
export const HOOD_TURTLE_CHAIN_ID = 4663;
export const HOOD_TURTLE_OWNERSHIP_TTL = 86400; // 24 hours
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const PAIRING_TTL = 600; // 10 minutes

export function turtleId(value: unknown): number {
  if (typeof value === 'boolean') {
    throw new Error('Enter a Hood Turtle token number from 1 to 2222');
  }
  const str = String(value);
  if (!/^[0-9]{1,4}$/.test(str)) {
    throw new Error('Enter a Hood Turtle token number from 1 to 2222');
  }
  const num = parseInt(str, 10);
  if (num < 1 || num > 2222) {
    throw new Error('Enter a Hood Turtle token number from 1 to 2222');
  }
  return num;
}

export interface TurtleOwnershipResult {
  tokenId: number;
  wallet: string | null;
  originalOwner: string;
  active: boolean;
  image: string | null;
  name: string;
  originalAddress: string;
  chainId: number;
  checkedAt: number;
  validUntil: number;
  companion: CompanionRig | null;
}

export class TurtleOwnership {
  private rpcUrl: string;
  private now: () => number;

  constructor(
    private db: DatabaseConnection,
    rpcUrl?: string,
    now?: () => number
  ) {
    this.rpcUrl = rpcUrl ?? process.env.ROBINHOOD_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com';
    this.now = now ?? (() => Date.now() / 1000);
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS turtle_ownership(
        wallet TEXT,
        token_id INTEGER,
        checked REAL,
        payload TEXT,
        PRIMARY KEY(wallet, token_id)
      )
    `).run();
  }

  setRpcUrl(url: string): void {
    this.rpcUrl = url;
  }

  getCached(
    wallet: string,
    tokenId: number
  ): { active: boolean; name: string; checked: number } | null {
    const row = this.db.prepare<{ checked: number; payload: string }>(
      'SELECT checked, payload FROM turtle_ownership WHERE wallet=? AND token_id=?'
    ).get(wallet, tokenId);

    if (!row) return null;
    try {
      const data = JSON.parse(row.payload);
      return {
        active: Boolean(data.active),
        name: data.name ?? `Hood Turtle #${tokenId}`,
        checked: row.checked,
      };
    } catch {
      return null;
    }
  }

  async read(
    wallet: string | null,
    tokenId: unknown,
    force = false,
    nowSeconds?: number
  ): Promise<TurtleOwnershipResult> {
    const tid = turtleId(tokenId);
    const now = nowSeconds ?? this.now();
    const checksumWallet = wallet ? toChecksumAddress(wallet) : null;

    if (!force) {
      const row = this.db.prepare<{ checked: number; payload: string }>(
        'SELECT checked, payload FROM turtle_ownership WHERE wallet IS ? AND token_id=?'
      ).get(checksumWallet, tid);

      if (row && row.checked <= now && now < row.checked + HOOD_TURTLE_OWNERSHIP_TTL) {
        try {
          const parsed = JSON.parse(row.payload);
          return withCompanion(parsed);
        } catch {
          // If corrupted, re-read from RPC
        }
      }
    }

    const rpc = this.rpcUrl;
    async function call(selector: string): Promise<Buffer> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_call',
            params: [
              {
                to: HOOD_TURTLE_COLLECTION,
                data: selector + tid.toString(16).padStart(64, '0'),
              },
              'latest',
            ],
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('Robinhood Chain could not verify the turtle');
        }

        const result = (await response.json()) as any;
        const raw = result.result;
        if (result.error || typeof raw !== 'string' || !/^0x[0-9a-fA-F]+$/.test(raw)) {
          throw new Error('Robinhood Chain could not verify the turtle');
        }
        return Buffer.from(raw.slice(2), 'hex');
      } finally {
        clearTimeout(timer);
      }
    }

    const ownerRaw = await call('0x6352211e');
    if (ownerRaw.length !== 32 || ownerRaw.subarray(0, 12).some(b => b !== 0) || !ownerRaw.some(b => b !== 0)) {
      throw new Error('Invalid ownership response');
    }

    const owner = toChecksumAddress('0x' + ownerRaw.subarray(12).toString('hex'));
    const active = checksumWallet === null || owner.toLowerCase() === checksumWallet.toLowerCase();

    let metadata: Record<string, unknown> = {};
    if (active) {
      const raw = await call('0xc87b56dd');
      if (raw.length < 64) {
        throw new Error('Invalid turtle metadata response');
      }
      const offset = Number(raw.readBigUInt64BE(24));
      if (offset !== 32 || raw.length < offset + 32) {
        throw new Error('Invalid turtle metadata response');
      }
      const length = Number(raw.readBigUInt64BE(offset + 24));
      if (!length || offset + 32 + length > raw.length) {
        throw new Error('Invalid turtle metadata response');
      }
      const uri = raw.subarray(offset + 32, offset + 32 + length).toString('utf-8');
      if (uri.startsWith('data:application/json;base64,')) {
        const b64 = uri.slice('data:application/json;base64,'.length);
        metadata = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
      }
      if (typeof metadata !== 'object' || metadata === null) {
        throw new Error('Invalid turtle metadata');
      }
    }

    const checked = now;
    const result: TurtleOwnershipResult = {
      tokenId: tid,
      wallet: checksumWallet,
      originalOwner: owner,
      active,
      image: (active && typeof metadata.image === 'string') ? metadata.image : null,
      name: String(metadata.name ?? `Hood Turtle #${tid}`).slice(0, 80),
      originalAddress: HOOD_TURTLE_COLLECTION,
      chainId: HOOD_TURTLE_CHAIN_ID,
      checkedAt: checked,
      validUntil: checked + HOOD_TURTLE_OWNERSHIP_TTL,
      companion: null,
    };

    // Do not cache absence: a newly purchased turtle should work immediately.
    this.db.prepare('DELETE FROM turtle_ownership WHERE wallet IS ? AND token_id=?').run(checksumWallet, tid);
    if (active && checksumWallet !== null) {
      this.db.prepare('INSERT INTO turtle_ownership(wallet, token_id, checked, payload) VALUES(?, ?, ?, ?)').run(
        checksumWallet,
        tid,
        checked,
        JSON.stringify(result)
      );
    }

    return withCompanion(result);
  }
}

export async function rpcCandidates(
  address: string,
  rpcUrl = process.env.ROBINHOOD_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
): Promise<{ candidates: Set<number>; partial: boolean }> {
  async function call(method: string, params: unknown[]): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error('On-chain NFT discovery unavailable');
      }
      const body = (await response.json()) as any;
      if (body.error || !('result' in body)) {
        throw new Error('On-chain NFT discovery unavailable');
      }
      return body.result;
    } finally {
      clearTimeout(timer);
    }
  }

  const cleanAddr = address.toLowerCase().replace('0x', '').padStart(64, '0');
  const raw = await call('eth_call', [
    { to: HOOD_TURTLE_COLLECTION, data: '0x70a08231' + cleanAddr },
    'latest',
  ]);
  if (typeof raw !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('Invalid collection balance');
  }
  const balance = BigInt(raw);
  if (balance === 0n) {
    return { candidates: new Set(), partial: false };
  }
  const headHex = await call('eth_blockNumber', []);
  const head = parseInt(headHex, 16);
  if (head > 200_000_000) {
    throw new Error('NFT discovery range exceeds configured budget');
  }

  const candidates = new Set<number>();
  for (let start = 0; start <= head; start += 10_000_000) {
    const toBlock = Math.min(head, start + 9_999_999);
    const logs = await call('eth_getLogs', [
      {
        address: HOOD_TURTLE_COLLECTION,
        fromBlock: '0x' + start.toString(16),
        toBlock: '0x' + toBlock.toString(16),
        topics: [TRANSFER_TOPIC, null, '0x' + cleanAddr],
      },
    ]);
    if (!Array.isArray(logs)) {
      throw new Error('Invalid collection transfer logs');
    }
    for (const log of logs) {
      const topics: string[] = log.topics || [];
      if (
        log.removed ||
        topics.length !== 4 ||
        topics[0].toLowerCase() !== TRANSFER_TOPIC.toLowerCase() ||
        String(log.address || '').toLowerCase() !== HOOD_TURTLE_COLLECTION.toLowerCase() ||
        topics[2].toLowerCase() !== '0x' + cleanAddr
      ) {
        continue;
      }
      candidates.add(turtleId(parseInt(topics[3], 16)));
    }
  }

  if (candidates.size === 0) {
    throw new Error('Collection balance exists but transfer history is missing');
  }

  return { candidates, partial: candidates.size > 50 };
}

export async function discoverWallets(
  addresses: string[],
  ownership: TurtleOwnership,
  rpcUrl = process.env.ROBINHOOD_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com',
  blockscoutUrl = process.env.ROBINHOOD_BLOCKSCOUT_API_URL ?? 'https://robinhoodchain.blockscout.com/api/v2'
): Promise<{ nfts: any[]; partial: boolean }> {
  const root = blockscoutUrl.replace(/\/+$/, '');

  async function discover(address: string): Promise<{ nfts: any[]; partial: boolean }> {
    let candidates = new Set<number>();
    let partial = false;
    let params: Record<string, string> = { type: 'ERC-721' };

    async function indexerCandidates(): Promise<void> {
      for (let page = 0; page < 5; page++) {
        const query = new URLSearchParams(params).toString();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);
        try {
          const res = await fetch(`${root}/addresses/${address}/nft?${query}`, {
            signal: controller.signal,
          });
          if (!res.ok) throw new Error('NFT indexer returned error');
          const data = (await res.json()) as any;
          if (!Array.isArray(data.items)) {
            throw new Error('NFT indexer returned invalid data');
          }
          for (const item of data.items) {
            if (String(item.token?.address_hash ?? '').toLowerCase() === HOOD_TURTLE_COLLECTION.toLowerCase()) {
              try {
                candidates.add(turtleId(item.id));
              } catch {
                // Ignore invalid
              }
            }
          }
          const nextPage = data.next_page_params;
          if (!nextPage) break;
          if (page === 4) partial = true;
          params = { type: 'ERC-721', ...nextPage };
        } finally {
          clearTimeout(timer);
        }
      }
    }

    try {
      await indexerCandidates();
      if (candidates.size === 0) {
        const rpcRes = await rpcCandidates(address, rpcUrl);
        candidates = rpcRes.candidates;
        partial = rpcRes.partial;
      }
    } catch {
      const rpcRes = await rpcCandidates(address, rpcUrl);
      candidates = rpcRes.candidates;
      partial = rpcRes.partial;
    }

    const sortedTids = Array.from(candidates).sort((a, b) => a - b).slice(0, 50);

    const verifiedNfts = await Promise.all(
      sortedTids.map(async tid => {
        const cached = ownership.getCached(address, tid);
        let active = false;
        let name = `Hood Turtle #${tid}`;

        const now = Date.now() / 1000;
        if (cached && cached.checked <= now && now < cached.checked + HOOD_TURTLE_OWNERSHIP_TTL) {
          active = cached.active;
          name = cached.name;
        } else {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 12_000);
          try {
            const res = await fetch(rpcUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'eth_call',
                params: [
                  { to: HOOD_TURTLE_COLLECTION, data: '0x6352211e' + tid.toString(16).padStart(64, '0') },
                  'latest',
                ],
              }),
              signal: controller.signal,
            });
            if (!res.ok) throw new Error('On-chain ownership check unavailable');
            const result = (await res.json()) as any;
            if (result.error?.code === 3) {
              return null; // burned
            }
            const raw = result.result ?? '';
            if (result.error || !/^0x0{24}[0-9a-fA-F]{40}$/.test(raw)) {
              throw new Error('On-chain ownership check unavailable');
            }
            active = raw.slice(-40).toLowerCase() === address.slice(2).toLowerCase();
          } finally {
            clearTimeout(timer);
          }
        }

        if (!active) return null;
        return {
          tokenId: tid,
          name,
          wallet: address,
          collection: 'Hood Turtles',
          originalAddress: HOOD_TURTLE_COLLECTION,
          chainId: HOOD_TURTLE_CHAIN_ID,
        };
      })
    );

    return {
      nfts: verifiedNfts.filter((n): n is NonNullable<typeof n> => n !== null),
      partial: partial || candidates.size > 50,
    };
  }

  const results = await Promise.allSettled(addresses.map(addr => discover(addr)));
  const successes = results
    .filter((r): r is PromiseFulfilledResult<{ nfts: any[]; partial: boolean }> => r.status === 'fulfilled')
    .map(r => r.value);

  if (successes.length === 0) {
    throw new Error('NFT discovery is temporarily unavailable');
  }

  const nftsMap = new Map<string, any>();
  for (const success of successes) {
    for (const nft of success.nfts) {
      const key = `${nft.chainId}:${nft.originalAddress}:${nft.tokenId}`;
      if (!nftsMap.has(key)) {
        nftsMap.set(key, nft);
      }
    }
  }

  return {
    nfts: Array.from(nftsMap.values()),
    partial: successes.length !== results.length || successes.some(s => s.partial),
  };
}
