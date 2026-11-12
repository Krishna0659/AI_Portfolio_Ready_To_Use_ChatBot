# PortfolioAI Knowledge Base

## Consistent local backup and restore drill

Run `./services/knowledge-base/restore-drill.ps1` from the repository in PowerShell. It briefly stops only the two KB containers, copies both /data directories as one consistent backup, restarts originals in a finally block, and restores separate isolated containers using the original image IDs. It checks active-profile retrieval and stale replay rejection for existing purge markers. Restored test containers are stopped afterward; backup files and stopped containers remain for inspection. The fixture-scoped credential must authorize the test profiles.

Verified drill: three active profiles and two purge markers survived restore; original API returned healthy afterward. Backup retained under ignored `.local/kb-backup-71ea0fc037db`. It contains resume-derived data and must remain private. This is a same-host test, not protection against loss of the host. Before production use, add encrypted off-host retention and replay deletions occurring after backup capture before opening restored access. No forced power-loss, cross-version restore or post-backup deletion recovery is claimed.

Optional hybrid query: set `mode` to `hybrid` on /v1/query. Default remains `dense`. Hybrid combines dense and BM25 ranks using RRF k=60, up to 20 candidates from each ranking. Both read only the active snapshot and authorized tenant/profile. Lexical scoring scans at most MAX_FACTS records; large-profile latency still requires benchmarking. Distances remain dense distances, not fused scores, and may be null for lexical-only results.

Hybrid evaluation on the unchanged eight-question development set: Recall@3=0.6667, MRR@3=0.6875, mean/max 22.53/48.04 ms. Thirteen tests pass. Because recall stayed unchanged and some ranks regressed, hybrid is optional. No model API or paid dependency was added.

Latest retrieval update: optional approved `subject` and section labels now contextualize each fact's embedding; returned documents stay unchanged. Republish existing profiles with a higher generation to re-embed; old active snapshots are not automatically rewritten. A formal preprocessing-version migration remains pending.

The unchanged eight-question development set now measures Recall@3=0.6667 and MRR@3=0.6667 (previously 0.50), mean/max latency 15.11/28.12 ms. Ten regressions pass. Research-result and computer-vision misses remain. These are tuning-set results, not independent quality acceptance.

This is the first standalone ChromaDB implementation. It indexes only approved profile projections and exposes no host port by default. The website or another trusted backend must call it with `x-kb-api-key`.

## Run

```powershell
Copy-Item .env.example .env
# Replace KB_API_KEY in .env with a long random value
docker compose --env-file .env up --build -d
```

The image build downloads the local embedding model into /opt/embedding-model. Runtime loads that packaged model with offline mode enabled. Gemini is not required. The model revision and transitive dependencies still need locking before production acceptance.

Local validation on 12 November 2026: real HTTP readiness, resume index/replay, PaySure-first retrieval, unrelated-tenant filtering and five unit tests passed. The running local stack uses a generated environment secret. Configure a durable private .env secret before future Compose recreation.

Hardening verification: seven unit tests and real HTTP smoke pass staged activation, replay/conflict handling, purge withdrawal and tenant filtering. New snapshots activate only after count verification; old snapshots remain stored but excluded from queries. Legacy snapshots remain readable; republish with a higher generation to adopt the new format.

Business endpoints now require KB_CALLER_GRANTS, a JSON map keyed by the lowercase SHA-256 of each caller secret. Each entry contains `profiles` (tenant ID mapped to allowed profile IDs, or `['*']` for all profiles in that tenant) and `operations` (index, query, purge, status). Missing grants deny all business access. KB_API_KEY grants readiness access only unless its hash is separately configured. Secrets must be high-entropy random values. Configure grants privately before Compose recreation. The running test stack permits only fixture-tenant. Request bodies are capped at 1 MiB, including streamed bodies.

Nine unit/HTTP tests and the real Docker smoke pass after authorization changes. Test profiles are purged after successful smoke runs.

Production limitations: synchronization supports exactly one process/replica. Credential provisioning/rotation, obsolete snapshot cleanup, full power-loss/restart/restore testing, concurrency and resource limits, timeouts, operation tracking and evaluation metrics remain open. Keep this service disconnected from the website until those acceptance gates pass.

Latest verification: ten tests pass. Activated profiles now clean obsolete snapshots in bounded pages under the write lock; failed cleanup returns cleanup_pending and is retried on exact replay. Two-generation live cleanup and graceful restart of both containers passed. evaluate.py supports prepare then evaluate; run evaluate again after restart without preparing to test persistence. The fixed evaluation profile is test data and may remain locally for repeated checks.

Eight-question baseline: Recall@3=0.50, MRR@3=0.50, warm mean/max 14.34/26.64 ms; post-restart mean/max 50.08/314.18 ms. This is a small fixture test, not a load benchmark or quality acceptance. Quality improvement, orphan staging reconciliation, forced-crash safety and backup restore remain pending. The older limitation list above is superseded for obsolete snapshot cleanup and graceful restart only.

## Fixture smoke test

The Compose file deliberately publishes no host port. Run the smoke test from a trusted backend container or a one-off diagnostic container attached to the `private` network. Do not add a public port mapping to ChromaDB or the KB service.

The request sequence is:

1. `POST /v1/index` with `fixtures/krishna-gaur-approved-profile.json`.
2. `POST /v1/query` with tenant `fixture-tenant`, profile `krishna-gaur`, and query `Which project uses escrow?`.
3. Repeat the index request and confirm it is safe to replay.
4. Send a lower-generation request and confirm it returns `409`.

The service intentionally has one worker and a local state file for the initial single-node deployment. Scale-out, distributed locking, and high availability are not claimed.
