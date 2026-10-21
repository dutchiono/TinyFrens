# TinyFrens agent instructions

Work from a feature branch and open a pull request. Do not push directly to main.

## Validation
- Run relevant tests/builds and report exactly what was run.
- Do not call a feature complete if an external RPC, deployment or provider has not been tested.
- No silent fallback for required blockchain infrastructure.
- Verify supported chains explicitly, rather than assuming universal contracts exist.
- Preserve native Android, iOS, desktop and browser behavior when changing shared web code.

## Production runtime policy
- Production and server-bound TinyFrens processes must use Node.js/JavaScript/TypeScript. Do not add Python HTTP services, workers, systemd units, containers, deployment receivers, remote hooks, or production entrypoints.
- Python is allowed only as a frozen compatibility reference, a local developer tool, or an explicitly user-run maintenance script. It must never be required to serve traffic or complete a production deployment.
- Keep server processes small and single-purpose. Prefer the TypeScript modules under `server-ts/` and minimal Node or shell operational helpers over new monolithic services.
- Historical Python code may remain for parity and rollback archaeology until separately removed, but production configuration must not execute it.

## Universal product surfaces
- Product UI and game behavior belong in the canonical `web/` implementation. Android, iOS, desktop, Telegram, and Discord may add only the native adapter required to host that shared behavior.
- Do not add a platform-only version of a feature when the shared implementation can support it.
- Companion rendering is NFT-only. Never add a generic or customizable fallback pet when no verified NFT is selected.
- Run `node scripts/check-universal-surfaces.mjs` when changing a product surface. Extend that guard when introducing a new native adapter or shared surface.

## Merge policy
A trusted workflow requests GitHub native squash auto-merge for every non-draft PR authored by dutchiono from this repository into main, regardless of changed paths. The owner explicitly authorizes this policy for work submitted through their account. All merges must obey required branch protection/status checks, including the strict requirement to be current with main. Never bypass branch protections or use admin merge. The `hold-merge` label pauses auto-merge; drafts also stay unmerged. Agents should open a PR and let real CI and native auto-merge complete it, rather than performing a second ceremonial review or polling indefinitely.

Agents may propose fixes to issues but must not self-approve, deploy contracts, expose credentials or release funds.

## Post-merge cleanup
- After a pull request merges, delete its feature branch locally and on the remote, and remove any temporary worktree you created once the worktree is clean and the merged commit is safely on `main`.
- Never remove a dirty, shared, or still-active branch/worktree. If cleanup must be deferred, leave a clear note explaining what remains and why.
