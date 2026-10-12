# TinyFrens agent instructions

Work from a feature branch and open a pull request. Do not push directly to main.

## Validation
- Run relevant tests/builds and report exactly what was run.
- Do not call a feature complete if an external RPC, deployment or provider has not been tested.
- No silent fallback for required blockchain infrastructure.
- Verify supported chains explicitly, rather than assuming universal contracts exist.
- Preserve native Android, iOS, desktop and browser behavior when changing shared web code.

## Merge policy
A trusted workflow may request GitHub native auto-merge for non-draft PRs authored by dutchiono and touching only lower-risk paths. All merges must obey required branch protection/status checks. Contract, server, wallet/auth, deployment, native, CI and skill edits require manual review. Never bypass branch protections or use admin merge.

Agents may propose fixes to issues but must not self-approve, deploy contracts, expose credentials or release funds.
