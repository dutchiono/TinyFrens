import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import {
  DefaultExtraCompanionsVerifier,
  EXTRA_COLLECTIONS,
} from '../../src/domain/companion-verifier.js';
import { nubCompanion } from '../../src/media/nub-art.js';

const BOT = '0x8d446c126d4873bfa3eb195b7f0094acc1187a75';
const NUB = '0x34d9e560ee16662d19e44315a822bd51eea0133c';
const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';

function encodedMetadata(metadata: Record<string, unknown>): string {
  const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString('base64')}`;
  return `0x${(32).toString(16).padStart(64, '0')}${uri.length.toString(16).padStart(64, '0')}${Buffer.from(uri).toString('hex')}`;
}

function ownerResult(address: string): string {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;
}

function createVerifier() {
  const db = createDbConnection(':memory:');
  runMigrations(db);
  let now = 1_700_000_000;
  const verifier = new DefaultExtraCompanionsVerifier(db, 'http://robinhood.test', 'http://base.test', () => now);
  return { db, verifier, setNow: (value: number) => { now = value; } };
}

describe('Extra companion production verifier', () => {
  test('discovers sequential Base ownership, caches inventory, and verifies metadata', async () => {
    const { db, verifier, setNow } = createVerifier();
    const svg = readFileSync(path.join(process.cwd(), '..', 'server', 'fixtures', 'bots-computer-1.svg'));
    const metadata = encodedMetadata({
      name: 'Bots Computer #1',
      image: `data:image/svg+xml;base64,${svg.toString('base64')}`,
    });
    let calls = 0;
    let currentOwner = OWNER;
    verifier.rpc = async (_collection, requests) => {
      calls += 1;
      return new Map(requests.map(request => {
        let result: unknown;
        if (request.method === 'eth_chainId') result = '0x2105';
        else if (String((request.params[0] as any)?.data).startsWith('0x18160ddd')) result = '0x1';
        else if (String((request.params[0] as any)?.data).startsWith('0xc87b56dd')) result = metadata;
        else if (request.id === 1) result = ownerResult(currentOwner);
        else return [request.id, { id: request.id, error: { code: 3 } }];
        return [request.id, { id: request.id, result }];
      }));
    };

    const discovered = await verifier.discover([OWNER, OTHER], BOT);
    assert.deepEqual(discovered.nfts.map(item => item.tokenId), [1]);
    assert.equal(discovered.nfts[0].wallet, OWNER);
    const discoveryCalls = calls;
    assert.deepEqual((await verifier.discover([OTHER], BOT)).nfts, []);
    assert.equal(calls, discoveryCalls);

    const owned = await verifier.read(OWNER, 1, BOT);
    assert.equal(owned.active, true);
    assert.equal(owned.companion.adapter, 'bots-computers-v1');
    assert.equal(owned.companion.frames.length, 6);
    const readCalls = calls;
    assert.equal((await verifier.read(OWNER, 1, BOT)).active, true);
    assert.equal(calls, readCalls);

    setNow(1_700_086_401);
    currentOwner = OTHER;
    const transferred = await verifier.read(OWNER, 1, BOT);
    assert.equal(transferred.active, false);
    assert.equal(db.prepare('SELECT count(*) AS count FROM extra_companion_ownership').get().count, 0);
    db.close();
  });

  test('reconstructs Robinhood inventory from bounded transfer logs', async () => {
    const { db, verifier } = createVerifier();
    const ranges: Array<{ fromBlock: string; toBlock: string }> = [];
    verifier.rpc = async (_collection, requests) => new Map(requests.map(request => {
      if (request.method === 'eth_chainId') return [request.id, { id: request.id, result: '0x1237' }];
      if (request.method === 'eth_blockNumber') return [request.id, { id: request.id, result: '0x989685' }];
      const filter = request.params[0] as { fromBlock: string; toBlock: string };
      ranges.push(filter);
      return [request.id, {
        id: request.id,
        result: filter.fromBlock === '0x0' ? [{
          address: NUB,
          blockNumber: '0x1',
          logIndex: '0x0',
          topics: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
            `0x${'0'.repeat(64)}`,
            ownerResult(OWNER),
            `0x${(1).toString(16).padStart(64, '0')}`,
          ],
        }] : [],
      }];
    }));
    const result = await verifier.discover([OWNER], NUB);
    assert.equal(result.nfts[0].originalAddress, NUB);
    assert.equal(result.nfts[0].chainId, 4663);
    assert.deepEqual(ranges.map(({ fromBlock, toBlock }) => ({ fromBlock, toBlock })), [
      { fromBlock: '0x0', toBlock: '0x98967f' },
      { fromBlock: '0x989680', toBlock: '0x989685' },
    ]);
    db.close();
  });

  test('fails closed without caching provider failures or wrong chains', async () => {
    const { db, verifier } = createVerifier();
    verifier.rpc = async () => { throw new Error('RPC unavailable'); };
    await assert.rejects(verifier.discover([OWNER], BOT), /RPC unavailable/);
    assert.equal(db.prepare('SELECT count(*) AS count FROM extra_companion_inventory').get().count, 0);
    verifier.rpc = async (_collection, requests) => new Map(requests.map(request => [
      request.id,
      { id: request.id, result: request.method === 'eth_chainId' ? '0x1237' : ownerResult(OWNER) },
    ]));
    await assert.rejects(verifier.read(OWNER, 1, BOT), /Wrong companion chain/);
    await assert.rejects(verifier.read(OWNER, 1, OWNER), /Unsupported companion collection/);
    assert.equal(EXTRA_COLLECTIONS[BOT][1], 10_000);
    db.close();
  });

  test('renders canonical Nub PNG into four deterministic hop frames', () => {
    const png = readFileSync(path.join(process.cwd(), '..', 'server', 'fixtures', 'nub-1.png'));
    const rig = nubCompanion(`data:image/png;base64,${png.toString('base64')}`);
    assert.equal(rig?.adapter, 'nubs-v1');
    assert.equal(rig?.frames.length, 4);
    assert.equal(rig?.frameMs, 160);
    assert.ok(rig?.frames.every(frame => frame.startsWith('data:image/png;base64,')));
  });
});
