import { createDbConnection } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import { Economy } from './domain/economy.js';
import { DepositIndexer } from './domain/indexer.js';

interface CliArgs {
  rpc: string;
  chainId: number;
  dbPath: string;
  poll: number;
  lookback: number;
  startBlock: string;
  once: boolean;
}

export function parseCliArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    rpc: 'https://sepolia.base.org',
    chainId: 84532,
    dbPath: 'tinyfrens.db',
    poll: 6,
    lookback: 300,
    startBlock: 'latest',
    once: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--once') {
      result.once = true;
    } else if (arg === '--rpc' && i + 1 < args.length) {
      result.rpc = args[++i];
    } else if (arg === '--chain-id' && i + 1 < args.length) {
      result.chainId = parseInt(args[++i], 10);
    } else if (arg === '--db' && i + 1 < args.length) {
      result.dbPath = args[++i];
    } else if (arg === '--poll' && i + 1 < args.length) {
      result.poll = parseFloat(args[++i]);
    } else if (arg === '--lookback' && i + 1 < args.length) {
      result.lookback = parseInt(args[++i], 10);
    } else if (arg === '--start-block' && i + 1 < args.length) {
      result.startBlock = args[++i];
    }
  }

  return result;
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseCliArgs(argv);
  const db = createDbConnection(options.dbPath);
  runMigrations(db);

  const economy = new Economy(db);
  const indexer = new DepositIndexer({
    economy,
    rpcUrl: options.rpc,
    chainId: options.chainId,
    pollSeconds: options.poll,
    lookback: options.lookback,
    startBlock: options.startBlock,
  });

  if (options.once) {
    const res = await indexer.runOnce();
    console.log(JSON.stringify({ blocksScanned: res.blocks, confirmed: res.confirmed }));
    db.close();
  } else {
    const controller = new AbortController();
    const onSigInt = () => {
      controller.abort();
      indexer.stop();
    };
    process.on('SIGINT', onSigInt);
    process.on('SIGTERM', onSigInt);

    try {
      await indexer.runForever(controller.signal);
    } finally {
      db.close();
    }
  }
}

if (process.argv[1]?.endsWith('indexer-cli.js') || process.argv[1]?.endsWith('indexer-cli.ts')) {
  runCli().catch(err => {
    console.error('Indexer failed:', err);
    process.exit(1);
  });
}
