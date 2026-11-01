# Import recovery

Each worker pass visits workspaces in stable order and claims at most one eligible job per workspace. A claim gets a fresh random lease and increments its attempt count. The worker renews valid leases every fifteen seconds, to sixty seconds from the last heartbeat. Expired leases cannot be renewed.

Success and failure transactions require a matching, unexpired running lease. A cancelled job, deleted source or a job reclaimed by another worker cannot accept a late result. Success writes its evidence snapshot and terminal status atomically. Source and job locks follow the same order as source erasure.

Temporary DNS failures, interrupted connections and transport timeouts retry with exponential delay and jitter. Provider rate-limit/reset times are minimum waiting periods. Access denials, missing sources, invalid document contents and unsafe addresses remain terminal. Five attempts is the automatic limit. Expired leases recover with a delay and the same attempt cap. Successful evidence and draft edits are preserved during retries.

`tests/jobs.test.ts` exercises backoff, provider waits, lease renewal/expiry/reassignment, late success/error rejection, cancellation, cross-tenant rejection and exactly one successful snapshot. These are local behavioral checks, not load or distributed fairness certification. The worker still uses the shared runtime database role and the KB adapter remains a minimal mock.
