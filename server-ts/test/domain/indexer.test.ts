import assert from 'node:assert';
import { describe, test } from 'node:test';
import { getAddress, keccak256, stringToBytes } from 'viem';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import { Economy } from '../../src/domain/economy.js';
import {
  DEPOSIT_TOPIC,
  TRANSFER_TOPIC,
  decodeDepositLog,
  decodeTransferLog,
  DepositIndexer,
  TreasuryTransferIndexer,
  IndexerError,
} from '../../src/domain/indexer.js';
import { parseCliArgs } from '../../src/indexer-cli.js';

describe('Domain: Indexer (Deposit & Treasury Transfer Indexers)', () => {
  describe('Event Log Decoding', () => {
    test('decodeDepositLog successfully decodes valid deposit log', () => {
      const sessionId = '0x' + 'aa'.repeat(32);
      const sender = '0x1234567890123456789012345678901234567890';
      const token = '0x0000000000000000000000000000000000000000';
      const amount = 1000000000000000000n; // 1 ETH

      const raw = {
        address: '0x' + '22'.repeat(20),
        topics: [
          DEPOSIT_TOPIC,
          sessionId,
          '0x000000000000000000000000' + sender.slice(2),
          '0x000000000000000000000000' + token.slice(2),
        ],
        data: '0x' + amount.toString(16).padStart(64, '0'),
        transactionHash: '0x' + '33'.repeat(32),
        logIndex: '0x2',
      };

      const decoded = decodeDepositLog(raw);
      assert.strictEqual(decoded.sessionId, sessionId);
      assert.strictEqual(decoded.sender.toLowerCase(), sender.toLowerCase());
      assert.strictEqual(decoded.token.toLowerCase(), token.toLowerCase());
      assert.strictEqual(decoded.amount, amount);
    });

    test('decodeDepositLog rejects logs with wrong topic or invalid length', () => {
      const rawWrongTopic = {
        address: '0x' + '22'.repeat(20),
        topics: [
          '0x' + '00'.repeat(32),
          '0x' + '11'.repeat(32),
          '0x' + '22'.repeat(32),
          '0x' + '33'.repeat(32),
        ],
        transactionHash: '0x' + 'aa'.repeat(32),
        logIndex: 0,
      };
      assert.throws(() => decodeDepositLog(rawWrongTopic), IndexerError);

      const rawShort = {
        address: '0x' + '22'.repeat(20),
        topics: [DEPOSIT_TOPIC, '0x' + '11'.repeat(32)],
        transactionHash: '0x' + 'aa'.repeat(32),
        logIndex: 0,
      };
      assert.throws(() => decodeDepositLog(rawShort), IndexerError);
    });

    test('decodeTransferLog successfully decodes ERC-20 transfer log', () => {
      const sender = '0x1111111111111111111111111111111111111111';
      const recipient = '0x2222222222222222222222222222222222222222';
      const amount = 25000000000000000000n; // 25 FRENS

      const raw = {
        address: '0x' + '99'.repeat(20),
        topics: [
          TRANSFER_TOPIC,
          '0x000000000000000000000000' + sender.slice(2),
          '0x000000000000000000000000' + recipient.slice(2),
        ],
        data: '0x' + amount.toString(16).padStart(64, '0'),
        transactionHash: '0x' + '55'.repeat(32),
        logIndex: '0x5',
      };

      const decoded = decodeTransferLog(raw);
      assert.strictEqual(decoded.sender.toLowerCase(), sender.toLowerCase());
      assert.strictEqual(decoded.recipient.toLowerCase(), recipient.toLowerCase());
      assert.strictEqual(decoded.amount, amount);
    });

    test('decodeTransferLog rejects non-transfer topic', () => {
      const raw = {
        address: '0x' + '99'.repeat(20),
        topics: ['0x' + '12'.repeat(32), '0x' + '34'.repeat(32), '0x' + '56'.repeat(32)],
        transactionHash: '0x' + '55'.repeat(32),
        logIndex: 0,
      };
      assert.throws(() => decodeTransferLog(raw), IndexerError);
    });
  });

  describe('DepositIndexer', () => {
    test('sessionAddresses returns sorted unique lowercased addresses for open sessions', () => {
      const db = createDbConnection(':memory:');
      runMigrations(db);
      const economy = new Economy(db, () => 1000);

      economy.openSession('pet-1', '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 10);
      economy.openSession('pet-2', '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 10);

      const indexer = new DepositIndexer({
        economy,
        rpcUrl: 'http://127.0.0.1:8545',
        chainId: 84532,
      });

      const addresses = indexer.sessionAddresses();
      assert.deepStrictEqual(addresses, [
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ]);
    });

    test('scan credits deposit session and returns confirmed count', async () => {
      const db = createDbConnection(':memory:');
      runMigrations(db);
      const economy = new Economy(db, () => 1000);

      const depositAddr = '0x3333333333333333333333333333333333333333';
      const session = economy.openSession('pet-target', depositAddr, 1);

      const mockLogs = [
        {
          address: depositAddr,
          topics: [
            DEPOSIT_TOPIC,
            session.id,
            '0x0000000000000000000000001234567890123456789012345678901234567890',
            '0x0000000000000000000000000000000000000000000000000000000000000000',
          ],
          data: '0x' + BigInt('1000000000000000000').toString(16).padStart(64, '0'),
          transactionHash: '0x' + 'aa'.repeat(32),
          logIndex: '0x1',
        },
      ];

      const mockFetcher = async (_url: any, init: any) => {
        const body = JSON.parse(init.body);
        if (body.method === 'eth_getLogs') {
          return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: mockLogs }) } as any;
        }
        return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }) } as any;
      };

      const indexer = new DepositIndexer({
        economy,
        rpcUrl: 'http://127.0.0.1:8545',
        chainId: 84532,
        fetcher: mockFetcher,
      });

      const confirmed = await indexer.scan(100, 200);
      assert.strictEqual(confirmed, 1);

      // Verify session updated to confirmed and pet received credits
      const updatedSess = economy.session(session.id);
      assert.strictEqual(updatedSess.status, 'confirmed');
      assert.strictEqual(economy.balance('pet-target'), 100);

      // Rescan with same log returns 0 (idempotent duplicate)
      const rescan = await indexer.scan(100, 200);
      assert.strictEqual(rescan, 0);
    });

    test('runOnce manages lookback, chunking, and checkpoint state', async () => {
      const db = createDbConnection(':memory:');
      runMigrations(db);
      const economy = new Economy(db, () => 1000);

      const scannedRanges: Array<{ from: string; to: string }> = [];
      const mockFetcher = async (_url: any, init: any) => {
        const body = JSON.parse(init.body);
        if (body.method === 'eth_blockNumber') {
          return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x3e8' }) } as any; // 1000
        }
        if (body.method === 'eth_getLogs') {
          scannedRanges.push({ from: body.params[0].fromBlock, to: body.params[0].toBlock });
          return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: [] }) } as any;
        }
        return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: null }) } as any;
      };

      economy.openSession('pet-x', '0x4444444444444444444444444444444444444444', 1);

      const indexer = new DepositIndexer({
        economy,
        rpcUrl: 'http://127.0.0.1:8545',
        chainId: 84532,
        lookback: 200,
        startBlock: 'latest',
        maxBlockSpan: 100,
        fetcher: mockFetcher,
      });

      // First run initializes start block (1000 - 200 = 800) and saves 800, then scans 801 to 1000
      const res = await indexer.runOnce();
      assert.strictEqual(res.confirmed, 0);
      assert.strictEqual(res.blocks, 200);
      assert.strictEqual(indexer.stateLast(), 1000);
      assert.strictEqual(scannedRanges.length, 2); // 801-900, 901-1000
    });
  });

  describe('TreasuryTransferIndexer', () => {
    test('scan credits treasury transfer when sender maps to unique pet', async () => {
      const db = createDbConnection(':memory:');
      runMigrations(db);
      const economy = new Economy(db, () => 1000);

      const treasury = '0x8888888888888888888888888888888888888888';
      const sender = '0x9999999999999999999999999999999999999999';
      const token = '0x1A96226727a1D0a46334b3A4b3878B32B7659ba3';

      const mockLogs = [
        {
          address: token,
          topics: [
            TRANSFER_TOPIC,
            '0x000000000000000000000000' + sender.slice(2),
            '0x000000000000000000000000' + treasury.slice(2),
          ],
          data: '0x' + (100000000000000000000n).toString(16).padStart(64, '0'), // 100 FRENS -> 10000 credits
          transactionHash: '0x' + 'fe'.repeat(32),
          logIndex: '0x0',
        },
      ];

      const mockFetcher = async (_url: any, init: any) => {
        const body = JSON.parse(init.body);
        if (body.method === 'eth_getLogs') {
          return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: mockLogs }) } as any;
        }
        return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x200' }) } as any;
      };

      const indexer = new TreasuryTransferIndexer({
        economy,
        rpcUrl: 'http://127.0.0.1:8545',
        chainId: 84532,
        treasury,
        token,
        resolve: s => (s.toLowerCase() === sender.toLowerCase() ? 'pet-treasury-owner' : null),
        fetcher: mockFetcher,
      });

      const credited = await indexer.scan(100, 200);
      assert.strictEqual(credited, 1);
      assert.strictEqual(economy.balance('pet-treasury-owner'), 10000);
      assert.strictEqual(indexer.stateLast(), null); // scan doesn't commit head, runOnce does
    });

    test('runOnce manages treasury_last_block checkpoint', async () => {
      const db = createDbConnection(':memory:');
      runMigrations(db);
      const economy = new Economy(db, () => 1000);

      const mockFetcher = async () =>
        ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x64' }) } as any); // 100

      const indexer = new TreasuryTransferIndexer({
        economy,
        rpcUrl: 'http://127.0.0.1:8545',
        chainId: 84532,
        treasury: '0x7777777777777777777777777777777777777777',
        startBlock: 50,
        fetcher: mockFetcher,
      });

      const res = await indexer.runOnce();
      assert.strictEqual(res.blocks, 50);
      assert.strictEqual(indexer.stateLast(), 100);
    });

    test('resolveWalletPet returns petId only when unique wallet link exists', async () => {
      const { resolveWalletPet } = await import('../../src/domain/indexer.js');
      const db = createDbConnection(':memory:');
      runMigrations(db);

      const sender = '0x1234567890123456789012345678901234567890';
      assert.strictEqual(resolveWalletPet(db, sender), null);

      db.prepare('INSERT INTO wallet_links(pet_id, address, created) VALUES(?, ?, ?)').run('pet-single', sender, 100);
      assert.strictEqual(resolveWalletPet(db, sender), 'pet-single');

      db.prepare('INSERT INTO wallet_links(pet_id, address, created) VALUES(?, ?, ?)').run('pet-two', sender, 101);
      assert.strictEqual(resolveWalletPet(db, sender), null);
    });
  });

  describe('CLI Arguments Parsing', () => {
    test('parseCliArgs parses custom flags accurately', () => {
      const args = [
        '--once',
        '--rpc',
        'https://rpc.example.com',
        '--chain-id',
        '1',
        '--db',
        'custom.db',
        '--poll',
        '2.5',
        '--lookback',
        '500',
        '--start-block',
        '12345',
      ];
      const parsed = parseCliArgs(args);
      assert.strictEqual(parsed.once, true);
      assert.strictEqual(parsed.rpc, 'https://rpc.example.com');
      assert.strictEqual(parsed.chainId, 1);
      assert.strictEqual(parsed.dbPath, 'custom.db');
      assert.strictEqual(parsed.poll, 2.5);
      assert.strictEqual(parsed.lookback, 500);
      assert.strictEqual(parsed.startBlock, '12345');
    });
  });

  describe('CLI Runner Execution', () => {
    test('runCli --once runs and prints JSON without error', async () => {
      const http = await import('node:http');
      const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => {
          body += chunk;
        });
        req.on('end', () => {
          const parsed = JSON.parse(body);
          if (parsed.method === 'eth_blockNumber') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x10' }));
          } else if (parsed.method === 'eth_getLogs') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: [] }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }));
          }
        });
      });

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
      const addr = server.address() as any;
      const rpcUrl = `http://127.0.0.1:${addr.port}`;

      const origLog = console.log;
      const logs: string[] = [];
      console.log = (msg: string) => logs.push(msg);

      try {
        const { runCli } = await import('../../src/indexer-cli.js');
        await runCli(['--once', '--rpc', rpcUrl, '--db', ':memory:', '--start-block', '10']);
        assert.strictEqual(logs.length, 1);
        const data = JSON.parse(logs[0]);
        assert.strictEqual(typeof data.blocksScanned, 'number');
        assert.strictEqual(typeof data.confirmed, 'number');
      } finally {
        console.log = origLog;
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  });
});

