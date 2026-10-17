import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, getAddress, http } from 'viem';
import { baseSepolia } from 'viem/chains';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const configDir = path.resolve(scriptDir, '../../contracts/config');
const economy = JSON.parse(fs.readFileSync(path.join(configDir, 'testnet-economy.json'), 'utf8'));
const nft = JSON.parse(fs.readFileSync(path.join(configDir, 'testnet-nft.json'), 'utf8'));
const rpcUrl = process.env.BASE_SEPOLIA_RPC || process.env.BASE_RPC_URL || 'https://sepolia.base.org';
const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

const addressOutput = [{ type: 'address' }];
const noInputAddressAbi = name => [{ type: 'function', name, stateMutability: 'view', inputs: [], outputs: addressOutput }];
const noInputBoolAbi = name => [{ type: 'function', name, stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] }];
const implementationSlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

const sameAddress = (actual, expected, label) => {
  assert.equal(getAddress(actual), getAddress(expected), label);
};

async function requireCode(address, label) {
  const bytecode = await client.getBytecode({ address: getAddress(address) });
  assert.ok(bytecode && bytecode !== '0x', `${label} has no deployed bytecode`);
}

async function requireProxy(proxy, implementation, label) {
  await requireCode(proxy, `${label} proxy`);
  await requireCode(implementation, `${label} implementation`);
  const stored = await client.getStorageAt({ address: getAddress(proxy), slot: implementationSlot });
  assert.ok(stored, `${label} proxy has no EIP-1967 implementation`);
  sameAddress(`0x${stored.slice(-40)}`, implementation, `${label} implementation mismatch`);
}

assert.equal(await client.getChainId(), economy.chainId, 'wrong RPC chain');

await Promise.all([
  requireCode(economy.testFrens, 'TestFRENS'),
  requireProxy(economy.treasury.proxy, economy.treasury.implementation, 'Treasury'),
  requireProxy(economy.jackpotVault.proxy, economy.jackpotVault.implementation, 'JackpotVault'),
  requireProxy(economy.depositRouter.proxy, economy.depositRouter.implementation, 'DepositRouter'),
  requireCode(economy.depositRouter.sessionImplementation, 'DepositSession implementation'),
  requireCode(nft.collection, 'robot collection'),
  requireCode(nft.artRenderer, 'art renderer'),
  requireCode(nft.spriteRenderer, 'sprite renderer'),
]);

for (const [label, proxy] of [
  ['Treasury', economy.treasury.proxy],
  ['JackpotVault', economy.jackpotVault.proxy],
  ['DepositRouter', economy.depositRouter.proxy],
]) {
  const [owner, controller, paused] = await Promise.all([
    client.readContract({ address: getAddress(proxy), abi: noInputAddressAbi('owner'), functionName: 'owner' }),
    client.readContract({ address: getAddress(proxy), abi: noInputAddressAbi('gameController'), functionName: 'gameController' }),
    client.readContract({ address: getAddress(proxy), abi: noInputBoolAbi('paused'), functionName: 'paused' }),
  ]);
  sameAddress(owner, economy.owner, `${label} owner mismatch`);
  sameAddress(controller, economy.controller, `${label} controller mismatch`);
  assert.equal(paused, false, `${label} is paused`);
}

const [routerTreasury, sessionImplementation, collectionRenderer, rendererSprite] = await Promise.all([
  client.readContract({ address: getAddress(economy.depositRouter.proxy), abi: noInputAddressAbi('treasury'), functionName: 'treasury' }),
  client.readContract({ address: getAddress(economy.depositRouter.proxy), abi: noInputAddressAbi('sessionImplementation'), functionName: 'sessionImplementation' }),
  client.readContract({ address: getAddress(nft.collection), abi: noInputAddressAbi('artRenderer'), functionName: 'artRenderer' }),
  client.readContract({ address: getAddress(nft.artRenderer), abi: noInputAddressAbi('spriteRenderer'), functionName: 'spriteRenderer' }),
]);

sameAddress(routerTreasury, economy.treasury.proxy, 'DepositRouter treasury mismatch');
sameAddress(sessionImplementation, economy.depositRouter.sessionImplementation, 'DepositSession implementation mismatch');
sameAddress(collectionRenderer, nft.artRenderer, 'collection art renderer mismatch');
sameAddress(rendererSprite, nft.spriteRenderer, 'art renderer sprite mismatch');

console.log(`Base Sepolia contract audit passed at block ${await client.getBlockNumber()}.`);
