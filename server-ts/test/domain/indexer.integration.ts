import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import { Economy } from '../../src/domain/economy.js';
import { DepositIndexer } from '../../src/domain/indexer.js';
import { DepositRouterAllocator } from '../../src/integrations/deposit-allocator.js';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const chainId = 84532;
const account = privateKeyToAccount(privateKey);
let anvil: ReturnType<typeof spawn>;
let rpcUrl: string;

function foundryBinary(name: 'anvil' | 'cast' | 'forge'): string {
  const override = process.env[`${name.toUpperCase()}_BIN`];
  if (override) return override;
  const local = path.join(repoRoot, '.tools', 'foundry', process.platform === 'win32' ? `${name}.exe` : name);
  return existsSync(local) ? local : name;
}

async function availablePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const payload = await response.json() as { result?: unknown; error?: unknown };
  if (payload.error) throw new Error(`rpc ${method}: ${JSON.stringify(payload.error)}`);
  return payload.result;
}

async function waitForRpc(): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (anvil.exitCode !== null) throw new Error(`anvil exited with ${anvil.exitCode}`);
    try {
      await rpc('eth_blockNumber');
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error('anvil did not become ready');
}

async function command(commandName: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(commandName, args, {
    cwd: repoRoot,
    env: { ...process.env, PRIVATE_KEY: privateKey },
    maxBuffer: 10 * 1024 * 1024,
  });
  return `${stdout}${stderr}`;
}

function addressFrom(output: string, label: string): string {
  const match = output.match(new RegExp(`^\\s*${label}\\s+(0x[a-fA-F0-9]{40})`, 'm'));
  assert.ok(match, `missing ${label} in forge output`);
  return match[1];
}

async function castSend(target: string, ...args: string[]): Promise<void> {
  await command(foundryBinary('cast'), [
    'send', target, ...args, '--private-key', privateKey, '--rpc-url', rpcUrl,
  ]);
}

before(async () => {
  const port = await availablePort();
  rpcUrl = `http://127.0.0.1:${port}`;
  anvil = spawn(foundryBinary('anvil'), ['--port', String(port), '--chain-id', String(chainId)], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  await waitForRpc();
});

after(async () => {
  if (anvil.exitCode === null) {
    anvil.kill('SIGTERM');
    await new Promise<void>(resolve => anvil.once('exit', () => resolve()));
  }
});

test('credits real ETH and ERC-20 deposits emitted by Anvil contracts', { timeout: 180_000 }, async () => {
  const economyDeployment = await command(foundryBinary('forge'), [
    'script',
    'contracts/testnet/script/DeployEconomy.s.sol:DeployEconomy',
    '--rpc-url', rpcUrl,
    '--broadcast',
  ]);
  const router = addressFrom(economyDeployment, 'routerProxy');

  await command(foundryBinary('forge'), [
    'script',
    'contracts/testnet/script/DeployTestFRENS.s.sol:DeployTestFRENS',
    '--rpc-url', rpcUrl,
    '--broadcast',
  ]);
  const broadcastPath = path.join(repoRoot, 'broadcast', 'DeployTestFRENS.s.sol', String(chainId), 'run-latest.json');
  const broadcast = JSON.parse(await readFile(broadcastPath, 'utf8')) as {
    transactions: Array<{ contractName?: string; contractAddress?: string; transactionType?: string }>;
  };
  const tokenDeployment = broadcast.transactions.find(transaction =>
    transaction.contractName === 'TestFRENS' && transaction.transactionType === 'CREATE'
  );
  assert.match(tokenDeployment?.contractAddress || '', /^0x[a-fA-F0-9]{40}$/);
  const token = tokenDeployment!.contractAddress!;

  const ethAllocator = new DepositRouterAllocator(router, privateKey, chainId, rpcUrl, { pollSeconds: 0.1 });
  const ercAllocator = new DepositRouterAllocator(router, privateKey, chainId, rpcUrl, {
    token,
    pollSeconds: 0.1,
  });
  const [ethAddress, , ethSessionId] = await ethAllocator.allocate('pet-eth');
  const [ercAddress, , ercSessionId] = await ercAllocator.allocate('pet-erc');

  const db = createDbConnection(':memory:');
  runMigrations(db);
  const economy = new Economy(db);
  economy.openSession('pet-eth', ethAddress, 40, { chainId, sessionId: ethSessionId });
  economy.openSession('pet-erc', ercAddress, 25, { token, chainId, sessionId: ercSessionId });

  await castSend(ethAddress, '--value', '40ether');
  await castSend(token, 'mint(address,uint256)', account.address, String(100n * 10n ** 18n));
  await castSend(token, 'transfer(address,uint256)', ercAddress, String(25n * 10n ** 18n));
  await castSend(ercAddress, 'sweep()');

  const indexer = new DepositIndexer({
    economy,
    rpcUrl,
    chainId,
    startBlock: 'earliest',
    pollSeconds: 0.1,
  });
  const first = await indexer.runOnce();
  assert.ok(first.blocks > 0);
  assert.equal(first.confirmed, 2);
  assert.equal(economy.balance('pet-eth'), 4000);
  assert.equal(economy.balance('pet-erc'), 2500);
  assert.equal(economy.session(ethSessionId).status, 'confirmed');
  assert.equal(economy.session(ercSessionId).status, 'confirmed');

  const second = await indexer.runOnce();
  assert.equal(second.confirmed, 0);
  assert.equal(economy.balance('pet-eth'), 4000);
  assert.equal(economy.balance('pet-erc'), 2500);
  db.close();
});
