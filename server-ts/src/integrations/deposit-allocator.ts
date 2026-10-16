import crypto from 'node:crypto';
import {
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  getAddress,
  concat,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { EconomyError, NotEnabled } from '../domain/economy.js';

export class AllocatorError extends EconomyError {
  constructor(message: string) {
    super(message);
    this.name = 'AllocatorError';
  }
}

export class NotConfigured extends AllocatorError {
  constructor(message: string = 'Deposit allocator not configured') {
    super(message);
    this.name = 'NotConfigured';
  }
}

export class AllocatorTimeout extends AllocatorError {
  constructor(message: string) {
    super(message);
    this.name = 'AllocatorTimeout';
  }
}

export const CREATE_SESSION_SELECTOR = '0x6d0f5911' as const;
export const SESSION_ADDRESS_SELECTOR = '0xe3a91c1a' as const;
export const ONE_GWEI = 1_000_000_000n;

export function sessionIdBytes(petId: string, token: string | null = null): `0x${string}` {
  const salt = crypto.randomBytes(8);
  const payload = Buffer.concat([
    Buffer.from(petId, 'utf-8'),
    Buffer.from(token || '', 'utf-8'),
    salt,
  ]);
  return keccak256(payload);
}

export interface AllocatorOptions {
  token?: string | null;
  timeout?: number;
  pollSeconds?: number;
  maxPriorityFee?: number | bigint;
}

export class DepositRouterAllocator {
  router: `0x${string}`;
  account: ReturnType<typeof privateKeyToAccount>;
  chainId: number;
  rpcUrl: string;
  token: `0x${string}` | null;
  timeout: number;
  poll: number;
  maxPriorityFee: bigint;

  constructor(
    routerAddress: string,
    controllerKey: string,
    chainId: number | string,
    rpcUrl: string,
    options: AllocatorOptions = {}
  ) {
    this.router = getAddress(routerAddress);
    const key = (controllerKey.startsWith('0x') ? controllerKey : `0x${controllerKey}`) as `0x${string}`;
    this.account = privateKeyToAccount(key);
    this.chainId = Number(chainId);
    this.rpcUrl = rpcUrl.endsWith('/') ? rpcUrl.slice(0, -1) : rpcUrl;
    this.token = options.token ? getAddress(options.token) : null;
    this.timeout = options.timeout ?? 30;
    this.poll = options.pollSeconds ?? 1.5;
    this.maxPriorityFee = BigInt(options.maxPriorityFee ?? 1_000_000_000);
  }

  async _rpc(method: string, params: unknown[]): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), (this.timeout + 5) * 1000);
    try {
      const res = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });
      const data: any = await res.json();
      if (data.error) {
        throw new AllocatorError(`rpc ${method}: ${JSON.stringify(data.error)}`);
      }
      return data.result;
    } catch (e: any) {
      if (e instanceof AllocatorError) throw e;
      throw new AllocatorError(`rpc ${method} failed: ${e.message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async allocate(petId: string): Promise<[string, `0x${string}` | null, string]> {
    const token = this.token || '0x0000000000000000000000000000000000000000';
    const sid = sessionIdBytes(petId, token);
    const encodedParams = encodeAbiParameters(parseAbiParameters('bytes32, address'), [sid, token]);
    const calldata = concat([CREATE_SESSION_SELECTOR, encodedParams]);

    const nonceHex = await this._rpc('eth_getTransactionCount', [this.account.address, 'pending']);
    const nonce = Number(BigInt(nonceHex));

    let gas: bigint;
    try {
      const gasHex = await this._rpc('eth_estimateGas', [
        { from: this.account.address, to: this.router, data: calldata },
      ]);
      gas = BigInt(gasHex);
    } catch (e) {
      throw e;
    }

    const priority = this.maxPriorityFee;
    const gasPriceHex = await this._rpc('eth_gasPrice', []);
    const gasPrice = BigInt(gasPriceHex);
    const maxFeePerGas = gasPrice + priority;
    const maxPriorityFeePerGas = priority;

    const signed = await this.account.signTransaction({
      to: this.router,
      value: 0n,
      data: calldata,
      chainId: this.chainId,
      nonce,
      gas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      type: 'eip1559',
    });

    const txHash = await this._rpc('eth_sendRawTransaction', [signed]);
    const receipt = await this._waitReceipt(txHash);
    if (!receipt || (receipt.status !== '0x1' && receipt.status !== '1')) {
      throw new AllocatorError(`createSession tx ${txHash} failed: ${JSON.stringify(receipt)}`);
    }

    const address = await this._readSessionAddress(sid);
    return [address, this.token, sid];
  }

  async _waitReceipt(txHash: string): Promise<any> {
    const deadline = Date.now() + this.timeout * 1000;
    while (Date.now() < deadline) {
      const receipt = await this._rpc('eth_getTransactionReceipt', [txHash]);
      if (receipt) {
        return receipt;
      }
      await new Promise(r => setTimeout(r, this.poll * 1000));
    }
    throw new AllocatorTimeout(`tx ${txHash} not mined within ${this.timeout}s`);
  }

  async _readSessionAddress(sid: `0x${string}`): Promise<string> {
    const encodedSid = encodeAbiParameters(parseAbiParameters('bytes32'), [sid]);
    const calldata = concat([SESSION_ADDRESS_SELECTOR, encodedSid]);
    const result: string = await this._rpc('eth_call', [{ to: this.router, data: calldata }, 'latest']);
    return getAddress('0x' + result.slice(-40));
  }
}

export async function invokeAllocator(
  allocator: any,
  petId: string,
  token?: string | null
): Promise<{ address: string; token: string | null; sessionId: string | null }> {
  if (!allocator) {
    throw new NotEnabled('Deposit allocator not configured');
  }
  let result: any;
  if (typeof allocator === 'function') {
    result = await allocator(petId, token);
  } else if (typeof allocator.allocate === 'function') {
    result = await allocator.allocate(petId, token);
  } else {
    throw new NotEnabled('Deposit allocator not configured');
  }
  if (!result) {
    throw new NotEnabled('Deposit allocator not configured');
  }
  if (Array.isArray(result)) {
    if (result.length === 3) {
      return { address: result[0], token: result[1] ?? null, sessionId: result[2] ?? null };
    }
    return { address: result[0], token: result[1] ?? null, sessionId: null };
  }
  return { address: result, token: null, sessionId: null };
}
