import { getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { AppContext } from '../context.js';
import { frenVaultAddressAndKey } from '../crypto/vault.js';
import { NET_STORAGE_ADDRESS } from './nft-traits.js';

export interface VaultTxResult {
  hash: string;
  from: string;
  to: string;
  gas: number;
  gasPrice: string;
}

const ADDR_REGEX = /^0x[a-fA-F0-9]{40}$/;

export function chainNamePayload(chainId: number): { chainId: number; chain: string } {
  return {
    chainId,
    chain: chainId === 84532 ? 'base-sepolia' : 'base',
  };
}

export function signingWallet(
  context: AppContext,
  pid: string
): { address: `0x${string}`; privateKey: `0x${string}` } {
  const row = context.repos.wallets.getPetWallet(pid);
  if (row && row.provider === 'bankr-partner') {
    throw new Error('Bankr partner wallet transaction signing is not wired yet.');
  }

  if (row && row.evm_address && row.api_key && row.api_key.startsWith('0x')) {
    return {
      address: row.evm_address as `0x${string}`,
      privateKey: row.api_key as `0x${string}`,
    };
  }

  const { address, privateKey } = frenVaultAddressAndKey(pid, context.config.FREN_VAULT_SEED);
  context.repos.wallets.upsertPetWallet({
    pet_id: pid,
    provider: 'fren-vault',
    wallet_id: 'vault:' + pid,
    evm_address: address,
    sol_address: '',
    api_key: privateKey,
    nft: null,
    created: Math.floor(context.now()),
  });

  return { address, privateKey };
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
      signal: controller.signal,
    });

    const body = (await res.json()) as { error?: { message?: string } | string; result?: any };
    if (body.error) {
      const msg = typeof body.error === 'object' && body.error?.message ? body.error.message : String(body.error);
      throw new Error(msg);
    }
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendVaultTx(
  context: AppContext,
  pid: string,
  to: string,
  data: `0x${string}`,
  value: bigint = 0n
): Promise<VaultTxResult> {
  const nftContract = context.config.TINYFRENS_NFT_ADDRESS;
  const isNetStorage = to.toLowerCase() === NET_STORAGE_ADDRESS.toLowerCase();

  if (!nftContract && !isNetStorage) {
    throw new Error('TinyFrens NFT contract is not configured.');
  }

  if (!ADDR_REGEX.test(to || '')) {
    throw new Error('Bad contract address.');
  }

  const rpc = context.config.BASE_RPC_URL;
  if (!rpc) {
    throw new Error('BASE_RPC_URL is not configured.');
  }

  const { address: fromAddr, privateKey } = signingWallet(context, pid);
  const checksumFrom = getAddress(fromAddr);
  const checksumTo = getAddress(to);

  const nonceHex = await rpcCall(rpc, 'eth_getTransactionCount', [checksumFrom, 'pending']);
  const nonce = parseInt(String(nonceHex), 16);

  const gasPriceHex = await rpcCall(rpc, 'eth_gasPrice', []);
  const gasPrice = BigInt(gasPriceHex);

  const txForEstimate = {
    from: checksumFrom,
    to: checksumTo,
    data,
    value: '0x' + value.toString(16),
  };
  const gasHex = await rpcCall(rpc, 'eth_estimateGas', [txForEstimate]);
  const estimatedGas = BigInt(gasHex);

  const gasLimit = Math.max(21000, Number((estimatedGas * 125n) / 100n + 5000n));
  const chainId = context.config.CHAIN_ID || 84532;

  const account = privateKeyToAccount(privateKey);
  const rawTx = await account.signTransaction({
    chainId,
    nonce,
    to: checksumTo,
    value,
    data,
    gas: BigInt(gasLimit),
    gasPrice,
  });

  const txHash = await rpcCall(rpc, 'eth_sendRawTransaction', [rawTx]);

  return {
    hash: txHash,
    from: checksumFrom,
    to: checksumTo,
    gas: gasLimit,
    gasPrice: gasPrice.toString(),
  };
}
