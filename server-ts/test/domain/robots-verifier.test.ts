import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createDbConnection, DatabaseConnection } from '../../src/db/connection.js';
import { initSchema } from '../../src/db/schema.js';
import { Robots } from '../../src/domain/robots-verifier.js';
import { ROBOTS_CONTRACT } from '../../src/media/robot-companion-art.js';

const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';

describe('Domain: Robots Verifier & Ownership', () => {
  const fixturePath = path.resolve(process.cwd(), '../server/fixtures/robots-v1/1.svg');
  const svgData = fs.readFileSync(
    fs.existsSync(fixturePath)
      ? fixturePath
      : path.resolve(process.cwd(), 'server/fixtures/robots-v1/1.svg')
  );
  const base64Image = 'data:image/svg+xml;base64,' + svgData.toString('base64');
  const metadata =
    'data:application/json;base64,' +
    Buffer.from(JSON.stringify({ name: 'Robot #1', image: base64Image })).toString('base64');
  const metadataHex = Buffer.from(metadata, 'utf-8').toString('hex');
  const encoded =
    '0x' +
    (32).toString(16).padStart(64, '0') +
    metadata.length.toString(16).padStart(64, '0') +
    metadataHex;

  let db: DatabaseConnection;
  let robots: Robots;
  let currentOwner: string;
  let currentTime: number;
  let ownerBatchCallCount: number;

  beforeEach(() => {
    db = createDbConnection(':memory:');
    initSchema(db);
    currentTime = 1_700_000_000;
    robots = new Robots(db, 'https://mock-rpc', () => currentTime);
    currentOwner = OWNER;
    ownerBatchCallCount = 0;

    robots.rpc = async (method: string, params: any[]) => {
      if (method === 'eth_chainId') return '0x2105';
      if (method === 'eth_blockNumber') return '0x321900a';
      const selector = params?.[0]?.data?.slice(0, 10);
      if (selector === '0x18160ddd') return '0x' + (1).toString(16).padStart(64, '0');
      if (selector === '0x70a08231') return '0x' + (1).toString(16).padStart(64, '0');
      if (selector === '0x6352211e') return '0x' + currentOwner.slice(2).padStart(64, '0');
      if (selector === '0xc87b56dd') return encoded;
      throw new Error(`Unhandled RPC selector: ${selector}`);
    };

    robots.owner_batch = async (_ids: number[]) => {
      ownerBatchCallCount++;
      return { '1': OWNER };
    };
  });

  test('owner-only daily renewal and transfer revocation', async () => {
    const otherRead = await robots.read(OTHER, 1);
    assert.equal(otherRead.active, false);

    const ownerRead = await robots.read(OWNER, 1);
    assert.equal(ownerRead.active, true);
    assert.equal(ownerRead.companion?.adapter, 'tinyfrens-robots-v1');

    // Transfer occurs: owner changes on-chain to OTHER
    currentOwner = OTHER;

    // Within cache TTL (24h), cached read still returns active: true
    const cachedRead = await robots.read(OWNER, 1);
    assert.equal(cachedRead.active, true);

    // After validUntil expires, read re-checks on-chain and detects ownership loss
    currentTime = ownerRead.validUntil + 1;
    const expiredRead = await robots.read(OWNER, 1);
    assert.equal(expiredRead.active, false);
  });

  test('fresh ownerOf ignores cache for money and care paths', async () => {
    assert.equal(await robots.ownerOf(OWNER, 1), true);
    assert.equal(await robots.ownerOf(OTHER, 1), false);

    // Immediate transfer
    currentOwner = OTHER;
    assert.equal(await robots.ownerOf(OWNER, 1), false);
    assert.equal(await robots.ownerOf(OTHER, 1), true);
  });

  test('discovery uses current inventory without archive logs', async () => {
    const result = await robots.discover(OWNER);
    assert.deepEqual(
      result.nfts.map(n => n.tokenId),
      [1]
    );
    assert.equal(result.nfts[0].originalAddress, ROBOTS_CONTRACT);

    // Second discover call within 600s uses cache
    await robots.discover(OWNER);
    assert.equal(ownerBatchCallCount, 1);

    // Rejects non-Base chains
    robots.rpc = async () => '0x1';
    await assert.rejects(async () => robots.discover(OWNER), /Base mainnet/);
  });

  test('incomplete inventory is not cached as missing nfts', async () => {
    robots.owner_batch = async () => ({});
    await assert.rejects(async () => robots.discover(OWNER), /does not match/);
    const row = db.prepare('SELECT owners FROM robot_owner_inventory').get();
    assert.equal(row, undefined);
  });
});
