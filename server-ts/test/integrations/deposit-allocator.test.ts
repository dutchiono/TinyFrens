import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DepositRouterAllocator,
  sessionIdBytes,
  CREATE_SESSION_SELECTOR,
  SESSION_ADDRESS_SELECTOR,
  invokeAllocator,
  AllocatorError,
  NotConfigured,
} from '../../src/integrations/deposit-allocator.js';

describe('DepositRouterAllocator Integration & Unit Tests', () => {
  const ROUTER = '0x' + '11'.repeat(20);
  const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

  it('verifies selector constants match DepositRouter contract ABI', () => {
    assert.equal(CREATE_SESSION_SELECTOR, '0x6d0f5911');
    assert.equal(SESSION_ADDRESS_SELECTOR, '0xe3a91c1a');
  });

  it('generates collision-safe 32-byte session IDs with random salt', () => {
    const sid1 = sessionIdBytes('pet-1');
    const sid2 = sessionIdBytes('pet-1');
    assert.match(sid1, /^0x[a-f0-9]{64}$/);
    assert.match(sid2, /^0x[a-f0-9]{64}$/);
    assert.notEqual(sid1, sid2);
  });

  it('invokeAllocator handles functions and tuples', async () => {
    // String address
    const r1 = await invokeAllocator(() => '0x' + '22'.repeat(20), 'pet-1');
    assert.deepEqual(r1, { address: '0x' + '22'.repeat(20), token: null, sessionId: null });

    // 2-tuple (address, token)
    const r2 = await invokeAllocator(() => ['0x' + '22'.repeat(20), '0x' + '33'.repeat(20)], 'pet-1');
    assert.deepEqual(r2, { address: '0x' + '22'.repeat(20), token: '0x' + '33'.repeat(20), sessionId: null });

    // 3-tuple (address, token, sessionId)
    const r3 = await invokeAllocator(() => ['0x' + '22'.repeat(20), '0x' + '33'.repeat(20), '0x' + '44'.repeat(32)], 'pet-1');
    assert.deepEqual(r3, { address: '0x' + '22'.repeat(20), token: '0x' + '33'.repeat(20), sessionId: '0x' + '44'.repeat(32) });

    // Object with allocate method
    const mockObj = {
      allocate: async (_pid: string) => ['0x' + '55'.repeat(20), null, '0x' + '66'.repeat(32)],
    };
    const r4 = await invokeAllocator(mockObj, 'pet-1');
    assert.deepEqual(r4, { address: '0x' + '55'.repeat(20), token: null, sessionId: '0x' + '66'.repeat(32) });

    // Null or undefined throws
    await assert.rejects(() => invokeAllocator(null, 'pet-1'), /Deposit allocator not configured/);
  });

  it('allocates session with mock RPC execution', async () => {
    const allocator = new DepositRouterAllocator(ROUTER, KEY, 84532, 'http://127.0.0.1:8545');

    const cloneAddress = '0x' + '77'.repeat(20);
    allocator._rpc = async (method: string, _params: unknown[]) => {
      switch (method) {
        case 'eth_getTransactionCount':
          return '0x0';
        case 'eth_estimateGas':
          return '0x5208'; // 21000
        case 'eth_gasPrice':
          return '0x3b9aca00'; // 1 Gwei
        case 'eth_sendRawTransaction':
          return '0x' + 'ee'.repeat(32);
        case 'eth_getTransactionReceipt':
          return { status: '0x1', transactionHash: '0x' + 'ee'.repeat(32) };
        case 'eth_call':
          return '0x' + '00'.repeat(12) + cloneAddress.slice(2);
        default:
          throw new Error(`Unexpected method ${method}`);
      }
    };

    const [address, token, sid] = await allocator.allocate('pet-mock');
    assert.equal(address.toLowerCase(), cloneAddress.toLowerCase());
    assert.equal(token, null);
    assert.match(sid, /^0x[a-f0-9]{64}$/);
  });
});
