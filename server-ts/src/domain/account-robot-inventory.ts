import type { AppContext } from '../context.js';
import { NotLinked } from './robot-care.js';
import { validateRobotTokenId } from './robot-care-rules.js';
import { linkedWallets } from './wallet-link.js';

export interface AccountRobotInventory {
  account: string;
  wallets: string[];
  tokenIds: number[];
}

/** Resolve a complete account-level Robots v1 inventory for Energy settlement. */
export async function verifiedAccountRobotInventory(
  context: AppContext,
  pid: string
): Promise<AccountRobotInventory> {
  const account = context.repos.deviceSync.ensureAccount(pid);
  const wallets = linkedWallets(context, pid);
  if (wallets.length === 0) throw new NotLinked('Link your wallet first');

  const results = await Promise.all(wallets.map(wallet => context.robotsVerifier.discover(wallet)));
  if (results.some(result => result.partial)) {
    throw new Error('Complete Robot inventory unavailable');
  }

  const tokenIds = new Set<number>();
  for (const result of results) {
    for (const nft of result.nfts) {
      tokenIds.add(validateRobotTokenId(nft?.tokenId));
    }
  }

  return {
    account,
    wallets,
    tokenIds: [...tokenIds].sort((a, b) => a - b),
  };
}
