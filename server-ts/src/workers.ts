import { AppContext } from './context.js';
import {
  DepositIndexer,
  TreasuryTransferIndexer,
  FetchFunction,
  resolveWalletPet,
} from './domain/indexer.js';

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

export interface Workers {
  deposit: DepositIndexer | null;
  treasury: TreasuryTransferIndexer | null;
  stop(): Promise<void>;
}

/**
 * Starts background indexers mirroring server/app.py startup rules.
 * Deposit indexer: INDEXER_ENABLED=true forces, =false suppresses, auto requires
 * DEPOSIT_ROUTER_PROXY + GAME_CONTROLLER_PRIVATE_KEY + BASE_RPC_URL.
 * Treasury indexer: fails closed unless enabled with a valid address and RPC.
 */
export function startWorkers(context: AppContext, fetcher?: FetchFunction): Workers {
  const { config } = context;
  const rpc = config.BASE_RPC_URL;
  const mode = String(config.INDEXER_ENABLED || 'auto').toLowerCase();
  let deposit: DepositIndexer | null = null;
  let treasury: TreasuryTransferIndexer | null = null;

  const autoReady = Boolean(config.DEPOSIT_ROUTER_PROXY && config.GAME_CONTROLLER_PRIVATE_KEY && rpc);
  if (rpc && mode !== 'false' && (mode === 'true' || autoReady)) {
    deposit = new DepositIndexer({
      economy: context.economy,
      rpcUrl: rpc,
      chainId: config.CHAIN_ID,
      pollSeconds: config.INDEXER_POLL_SECONDS,
      lookback: config.INDEXER_LOOKBACK,
      fetcher,
    });
  }

  if (config.FRENS_TREASURY_INDEXER && config.FRENS_TREASURY && ADDR_RE.test(config.FRENS_TREASURY) && rpc) {
    treasury = new TreasuryTransferIndexer({
      economy: context.economy,
      rpcUrl: rpc,
      chainId: config.FRENS_TREASURY_CHAIN_ID,
      treasury: config.FRENS_TREASURY,
      token: config.FRENS_TREASURY_TOKEN,
      pollSeconds: config.INDEXER_POLL_SECONDS,
      lookback: config.INDEXER_LOOKBACK,
      resolve: sender => resolveWalletPet(context.db, sender),
      maxCredits: config.FRENS_TREASURY_MAX_CREDITS ?? null,
      fetcher,
    });
  }

  deposit?.start().catch(() => undefined);
  treasury?.start().catch(() => undefined);

  return {
    deposit,
    treasury,
    async stop() {
      await Promise.all([deposit?.aclose(), treasury?.aclose()]);
    },
  };
}
