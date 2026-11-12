# PortfolioAI standalone knowledge base

Local, free, backend-only ChromaDB service. Website integration and hosting remain isolated. **Production release is not yet accepted.**

## Verified on 12 November 2026

- 33 Python tests passed with no skips: 29 API/state/authorization/limits tests and four real-SDK/worker tests. Installed dependency consistency (`pip check`) passed.
- Live index/replay/conflict/query/purge and scoped orphan-cleanup smoke tests passed.
- Actual API-container SIGKILL during a first index: pending state survived, unactivated evidence stayed hidden, reconciliation removed the recorded orphan, and exact replay succeeded.
- Consistent backup restored into separate containers: three active profiles and twelve purge markers passed. A fixture deleted after backup capture was withdrawn by replaying the current deletion ledger before starting the restored API.
- AES-256-GCM encryption/decryption matched the original archive byte-for-byte. Wrong keys and modified ciphertext were rejected without producing a plaintext output.

## Runtime and contract

Compose publishes no host ports and uses an internal network. One API process/replica only: the state file and in-process lock are not a distributed coordination protocol. Both containers have 2 GiB RAM, two CPUs, 256-process limits and rotated logs. Embeddings run locally in a persistent subprocess; no paid model/API is required.

All business endpoints require `x-kb-api-key`, a SHA-256 grant, an allowed operation, and an allowed tenant/profile. Readiness uses the separate `KB_API_KEY`. Never give a browser these credentials.

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/index` | Stage then activate an approved profile snapshot |
| `POST /v1/query` | Retrieve active evidence; dense default, optional hybrid |
| `GET /v1/status` | Inspect durable committed and pending generations |
| `POST /v1/purge` | Persist withdrawal before deleting scoped vectors |
| `POST /v1/reconcile` | Retry cleanup while preserving committed evidence |

Indexing writes a pending generation and payload digest before embedding/upsert. Activation replaces it only after staging verification and a remaining-budget check. Conflicting pending or committed replays are rejected. An identical retry is safe; do not increase generation merely because a response timed out. Status can report both an older active snapshot and a newer pending stage. First-stage records have committed generation zero and return no evidence. Reconciliation of such records deletes only the journaled snapshot. Missing state refuses blind deletion. Tombstones remain to reject stale resurrection.

State replacement fsyncs the file and parent directory on Linux. This is not a proof against every host-power-loss/storage failure. The crash test kills the API container; it does not simulate physical drive failure.

## Operational bounds

- Body: 1 MiB, ten seconds to receive; 408/413 on rejection.
- Admission: sixteen in-flight requests; overload 503 with Retry-After.
- Response budget: sixty seconds after body reception; 504 on expiry. Threads already performing filesystem/network work are not magically cancelled; staged writes may have uncertain outcomes. Check status and replay exactly.
- Lock queue: at most five seconds, also bounded by the remaining budget.
- Embeddings: forty-five seconds including worker startup, shortened by the remaining request budget; timed-out workers are killed and recreated on the next request.
- Chroma network inactivity: connect/pool three seconds, read/write ten seconds, shortened by remaining budget. Adapter requires exactly Chroma 1.4.1.
- Per tenant: 1,000 retained profile IDs including tombstones and 10,000 active facts. Replacement accounting occurs before embedding under the state lock. Existing profiles can still be purged at quota.
- Token buckets per tenant across credentials: query 120/minute with burst 20; index 10/minute with burst 10; purge/status/reconcile share 60/minute with burst 10. Exhaustion returns 429/Retry-After. Buckets reset on restart.
- New indexing requires 512 MiB free on both volumes. The Chroma volume is mounted read-only into the API for this check. Low space returns 507, unreadable capacity 503. This is an admission reserve, **not a hard filesystem quota**. Other writers and WAL/index growth can consume disk.
- Cleanup: 200 records/page, at most fifty pages/call; repeat when `cleanup_pending` is true. No background reconciliation is installed.

## Reproducibility and builds

`Dockerfile` pins the Python image digest, Chroma image digest, embedding model revision `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`, and captured transitive package versions in `constraints.txt`. Preprocessing is recorded as `approved-subject-section-fact-v1`: approved subject + section + individual fact; source evidence text remains unchanged. Existing profiles are not silently re-embedded.

The clean locked rebuild was attempted but Docker DNS could not resolve the PyTorch download host. The running validation image uses `Dockerfile.offline` / `compose.offline.yml`, based on the previously installed runtime tagged `portfolioai-kb-offline-base:20261112`. This is a local fallback, not a portable verified clean build. Dependency consistency is not a vulnerability scan. Do not claim supply-chain/security acceptance yet.

Standard build, from the repository, with private credentials already in the environment:

```powershell
docker compose -f services/knowledge-base/compose.yml up --build -d
```

Local offline fallback requires the recorded base image to exist:

```powershell
docker compose -f services/knowledge-base/compose.yml -f services/knowledge-base/compose.offline.yml up --build -d
```

Keep readiness credentials and grants outside source control. `.env.example` is not usable production credentials. The live fixture secret is preserved in the container environment; do not print `docker inspect` environment contents into logs.

## Caller credential rotation

`credentials.py` operates inside the container as a trusted operator. It writes only hashes/scopes to `/data/caller-grants.json`; the API rereads that file for each request and fails closed if invalid. Initial provisioning preserves existing environment grants. Run one provisioning operator at a time.

```text
python /app/credentials.py --tenant TENANT --profile PROFILE --operation query --key-file /private/new-caller.key
python /app/credentials.py --revoke-hash OLD_SHA256_HASH
```

The key file is created exclusively with mode 0600 and the raw key is never printed. Provision a replacement, transfer it securely to the trusted caller, verify it, then revoke the old hash. Requests already admitted may finish after revocation. This rotates business callers, not the readiness environment secret; rotate readiness by replacing the container environment. Never store operator keys alongside cloud backups.

## Backups and restore

Run `restore-drill.ps1` from this folder/repository in PowerShell. It briefly stops only the two KB containers for a consistent copy, restarts originals in a finally block, makes a disposable fixture deletion after capture, applies the current deletion ledger to restored state, and verifies separate restored containers. Restored containers are stopped after the drill. Originals are never overwritten.

For a real restore, obtain the **latest trusted deletion ledger** first and run `replay_deletions.py` offline before exposing the restored API. Reconcile purged profiles to physically remove their stale vectors. If the ledger is unavailable, keep the restored service isolated; an old backup alone cannot prove that data has not since been deleted. Copy the ledger off-host whenever deletion history changes. A same-host drill is not disaster recovery against loss of this computer.

`Protect-Backup.ps1` encrypts a consistent TAR archive with AES-256-GCM and a fresh 32-byte recovery key. It refuses overwrite and supports archives up to 512 MiB. The encryption tests are in `test-backup-encryption.ps1`.

```powershell
./services/knowledge-base/Protect-Backup.ps1 -Mode Encrypt -InputPath backup.tar -OutputPath backup.kbenc -KeyPath recovery.key
./services/knowledge-base/Protect-Backup.ps1 -Mode Decrypt -InputPath backup.kbenc -OutputPath verified.tar -KeyPath recovery.key
```

Prepared local artifacts (ignored by Git):

- `.local/portfolioai-backup-20261112.kbenc` — encrypted backup, 1,329,188 bytes.
- `.local/backup-keys/portfolioai-20261112.key` — recovery key; keep separately, never upload beside the archive.
- `.local/kb-backup-02d8c0078571/` — original private local snapshot, current deletion ledger and replayed state used by the successful restore drill.

For the user's free off-host setup: create a private Google Drive folder `PortfolioAI-Backups`, check available account storage, upload only the `.kbenc`, and retain the key separately in a recoverable secure location. Google documents up to 15 GB free shared across Drive/Gmail/Photos: https://support.google.com/accounts/answer/6374270?hl=en . No upload or off-host recovery has been performed. Keep the last two verified archives only if they fit; do not delete the last good backup before verifying a replacement.

## Retrieval quality and remaining acceptance

The unchanged eight-question development set remains at dense Recall@3/MRR@3 0.6667/0.6667 and hybrid 0.6667/0.6875. Research-result and computer-vision questions still miss relevant evidence. These are tuning fixtures, not an independent held-out acceptance set. The latest run included a cold worker start (~4 seconds); warm hybrid mean/max was ~77/100 ms, not a load-capacity claim.

Release remains blocked on:

1. Off-host encrypted copy, independent key custody, and a restore after simulated host loss with a current deletion ledger.
2. Host-enforced persistent-volume quotas and disk-exhaustion acceptance; the current disk reserve is not a quota.
3. A clean locked rebuild, dependency vulnerability review/remediation, and workload capacity testing.
4. Retrieval quality improvements and an independently reviewed evaluation set.

Website integration and hosting remain paused. No production-complete claim is made.
