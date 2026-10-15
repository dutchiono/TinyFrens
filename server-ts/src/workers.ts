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
  moderation: AppContext['telegramModeration'] | null;
  stop(): Promise<void>;
}

export type WorkerErrorHandler = (worker: 'deposit' | 'treasury', error: unknown) => void;

/**
 * Starts background indexers mirroring server/app.py startup rules.
 * Deposit indexer: INDEXER_ENABLED=true forces, =false suppresses, auto requires
 * DEPOSIT_ROUTER_PROXY + GAME_CONTROLLER_PRIVATE_KEY + BASE_RPC_URL.
 * Treasury indexer: fails closed unless enabled with a valid address and RPC.
 */
export function startWorkers(
  context: AppContext,
  fetcher?: FetchFunction,
  onError?: WorkerErrorHandler
): Workers {
  const { config } = context;
  const rpc = config.BASE_RPC_URL;
  const mode = String(config.INDEXER_ENABLED || 'auto').toLowerCase();
  let deposit: DepositIndexer | null = null;
  let treasury: TreasuryTransferIndexer | null = null;
  const moderation = config.TELEGRAM_MODERATION && config.TELEGRAM_BOT_TOKEN
    ? context.telegramModeration
    : null;

  const autoReady = Boolean(config.DEPOSIT_ROUTER_PROXY && config.GAME_CONTROLLER_PRIVATE_KEY && rpc);
  if (rpc && mode !== 'false' && (mode === 'true' || autoReady)) {
    deposit = new DepositIndexer({
      economy: context.economy,
      rpcUrl: rpc,
      chainId: config.CHAIN_ID,
      pollSeconds: config.INDEXER_POLL_SECONDS,
      lookback: config.INDEXER_LOOKBACK,
      fetcher,
      onError: error => onError?.('deposit', error),
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
      onError: error => onError?.('treasury', error),
    });
  }

  void deposit?.start().catch(error => onError?.('deposit', error));
  void treasury?.start().catch(error => onError?.('treasury', error));
  moderation?.start();

  return {
    deposit,
    treasury,
    moderation,
    async stop() {
      await Promise.all([deposit?.aclose(), treasury?.aclose(), moderation?.stop()]);
    },
  };
}
