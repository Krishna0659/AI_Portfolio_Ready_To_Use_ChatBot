# GitHub App live verification — 1 November 2026

The private key was validated locally and configured only in ignored local files. The import worker was restarted with GitHub App authentication. New imports were requested via the same source-sync API used by the workspace.

| Repository | New job result | New extracted README characters |
|---|---|---:|
| Krishna0659/PaySure | succeeded | 24,570 |
| Krishna0659/Text-Summazrizer | succeeded | 36 |

Both new jobs produced fresh evidence with no error. These are README imports, not entire-codebase extraction; the short Text-Summazrizer result is not a claim about the repository's total code content.

TypeScript validation passed for the reusable end-to-end verification script. Previously passing synthetic tests cover token scope, signature/lifetime and rejected foreign/suspended installations.

No private key, token, environment file, source evidence, or database file is tracked in Git. Multi-user installation authorization, private-repository live coverage, and revocation webhooks remain separate Phase 1 work.
