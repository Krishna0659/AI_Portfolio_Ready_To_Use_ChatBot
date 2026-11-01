# Local account lifecycle

Settings includes account erasure. The user must type `DELETE MY ACCOUNT` and have authenticated within the preceding ten minutes. The request uses the normal origin and CSRF checks. A failed check leaves the account intact.

The deletion transaction revokes every account session and deletes the workspace, including sources, snapshots, jobs, draft, approved versions and delivery events. Upload object keys enter a durable deletion outbox in the same transaction. A worker unlinks only validated managed object paths; failures retry with bounded exponential delay. A worker crash leaves a reclaimable lease. Missing files count as already removed.

The signed-out browser retains a random deletion receipt in session storage. The database stores its hash. The status endpoint accepts the receipt in a header and returns only status/timestamps, with caching disabled. Account completion includes files queued by earlier source erasures. Receipt creation and completion serialize per account to prevent concurrent workers leaving an otherwise completed request pending.

Sign-in replaces the same browser's previous session in one transaction. Sessions have a rolling twelve-hour idle timeout and a fixed seven-day maximum lifetime. Recent-authentication checks use session creation time; ordinary activity cannot refresh it. Google requests fresh authentication and checks token authentication age, but the actual provider flow still needs credentials and live verification.

## Verification

`npm test` includes real-database tests for stale authentication, foreign workspaces, session revocation, pending import removal, failed unlink/retry, prior source cleanup and concurrent cleanup completion. `node scripts/lifecycle-check.mjs` checks idle/absolute expiry, confirmation validation, desktop/mobile UI, revoked access and receipt reload in Edge using a disposable account.

## Boundary

This operates on the local installation. Downloaded exports, external backups and future hosted storage are not covered. Content-free deletion receipts/tombstones remain for reconciliation; no retention policy or backup restore replay is implemented yet. Global identity/cleanup tables still use the existing shared runtime role. This is not production lifecycle certification.
