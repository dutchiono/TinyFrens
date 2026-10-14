import { createHash } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';

export const DEFAULT_FREN_VAULT_SEED = 'tinyfrens-master-vault-seed-v1';

export interface FrenVaultKeys {
  address: `0x${string}`;
  privateKey: `0x${string}`;
}

export function frenVaultAddressAndKey(
  pid: string,
  seed: string = DEFAULT_FREN_VAULT_SEED
): FrenVaultKeys {
  const hash = createHash('sha256')
    .update(`${seed}:${pid}`, 'utf8')
    .digest('hex');

  const privateKey = `0x${hash}` as `0x${string}`;
  const account = privateKeyToAccount(privateKey);

  return {
    address: account.address,
    privateKey,
  };
}
