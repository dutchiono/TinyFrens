# Farcaster United claim

Farcaster United is a Base-only, one-for-one ownership claim:

- source collection: Network School Farcaster client (`VOTE`)
- Base contract: `0x4ecfEd276c566AeB49Da1f3A888E8Dbb7263028D`
- supported chain: Base mainnet (`8453`)
- output collection: Farcaster United (`FU`)

The source VOTE contract disables approvals and transfers with
`TransferDisabled()`. Its NFTs cannot be sent to a vault or burned by their
holders. F.U. therefore uses an ownership claim rather than pretending to
escrow an NFT that the source contract makes immovable.

A successful `claim(voteTokenId)` checks the live VOTE owner, permanently marks
that VOTE token ID claimed, and mints F.U. token `voteTokenId` to the same
address. Matching token IDs make the one-for-one relationship directly
auditable. The holder keeps the soulbound VOTE.

## Safety properties

- Claims start paused.
- Only the current VOTE owner can claim.
- Each VOTE token ID can claim once.
- F.U. uses the same token ID as its qualifying VOTE.
- The owner has no arbitrary mint function.
- Metadata can be permanently frozen.
- The contract is not upgradeable.

## User-run deployment

Agents must not deploy contracts for this repository. The owner can deploy to
Base mainnet after reviewing the source and tests:

```powershell
$env:DEPLOYER_PRIVATE_KEY = '<private key>'
$env:FU_BASE_URI = 'ipfs://<metadata-directory-cid>/'
forge script contracts/fu/script/DeployFarcasterUnitedClaim.s.sol:DeployFarcasterUnitedClaim `
  --rpc-url base `
  --broadcast `
  --verify
```

The script rejects every chain except Base mainnet. The deployed contract starts
paused. Before unpausing:

1. Verify the deployment on BaseScan.
2. Put the deployed claim address in the mint page configuration.
3. Confirm the page reads `voteToken()` as the expected VOTE address.
4. Complete one end-to-end claim with a controlled VOTE NFT.
5. Confirm the VOTE remains with the holder and the matching F.U. token is
   minted to that holder.
6. Only then call `setClaimsPaused(false)` for the public launch.

Do not call the claim live until the external Base RPC, deployed contract,
metadata URI, claim transaction, and receipt state have all been tested.
