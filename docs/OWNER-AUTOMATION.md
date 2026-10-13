# Owner PR automation

Every non-draft PR authored by `dutchiono`, from this repository into `main`, is
eligible for native GitHub squash auto-merge, including contract, server, native,
wallet and workflow changes. This is the owner's explicit policy. GitHub still
enforces required checks and requires the branch to be current with main.

Agents submit a branch and PR, run relevant local validation, and let GitHub CI
and auto-merge finish the merge. A second review by the submitting agent is not
required and should not be described as independent review. This does not
authorize contract deployment, fund transfers or exposure of credentials.

- Keep a PR as a draft, or apply `hold-merge`, to pause merging.
- Removing `hold-merge` or marking the PR ready requests auto-merge again.
- Failed checks and conflicts stop the merge. Stale branches still need updating;
  this workflow does not weaken the strict main-branch requirement.
- The privileged workflow reads GitHub metadata only. It never checks out or
  executes PR code, and re-reads the PR state before acting on its current head.
- Merged remote branches are deleted by the repository setting. Local worktree
  cleanup remains a local operation.

The quality gate already runs the relay suite and browser syntax checks, so the
separate relay workflow is now a manual diagnostic. Superseded PR validation runs
are cancelled; main-branch release runs are preserved.

This orchestration uses `GITHUB_TOKEN`, not a model API key. Standard GitHub-hosted
Actions runners are free for public repositories; storage and other GitHub
services have their own limits:
https://docs.github.com/en/billing/concepts/product-billing/github-actions

## Next: Telegram issue to background coding

The existing relay can create a GitHub issue and persist its originating Telegram
chat for follow-up events. Its deployed GitHub runtime credentials must be
configured before issue filing is live. Do not copy a developer's CLI token into
the relay.

The local `Playground/SuperAgent` project provides terminal orchestration, agent
selection, quota handling and event-driven waits. It is a useful worker starting
point; it currently has no GitHub issue/webhook adapter and is not a Git checkout.

The next integration can use this sequence:

1. The owner marks an issue `agent-ready` (Telegram can expose an equivalent
   owner-only command).
2. GitHub queues the issue once; SuperAgent claims it and creates an isolated
   branch/worktree.
3. An available coding CLI implements the issue and opens a PR. Model API fallback
   is used only when the selected coding backend needs it, with a task budget.
4. GitHub runs the required checks and auto-merges an eligible owner PR.
5. Deployment and health verification report the outcome to the originating chat.

Issue deduplication, durable task state and an explicit retry limit should be part
of the worker adapter. GitHub checks and scheduling do not need a language model;
writing or repairing code still needs a coding agent. This worker adapter and
automated relay deployment are not implemented by the PR policy change.
