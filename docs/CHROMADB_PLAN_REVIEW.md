# ChromaDB Plan Review

Last reviewed: 11 November 2026

## Decision

Proceed with ChromaDB as a separate, local and self-hosted knowledge-base service. The service will be built and tested before it is connected to the website. The website remains the authority for approved profile versions; ChromaDB is a derived, rebuildable index.

The strict budget is ₹0. No paid hosting, managed vector database, hosted embedding API, hosted tracing service, or persistent cloud volume is required for development or the first production-like deployment. Public hosting remains deferred under the website project rules.

## Changes to the supplied plan

1. Hugging Face is no longer a recommended deployment path. It may be evaluated later for a disposable demo only. It is not an acceptable authority for durable ChromaDB data without a separately verified persistent storage arrangement.
2. The first target is Docker Compose on an operator-controlled machine with a local durable volume, PostgreSQL as the website authority, and a tested rebuild from approved versions.
3. The ChromaDB service will expose an authenticated backend-only API. The browser will never receive ChromaDB credentials or connect to ChromaDB directly.
4. The first retrieval release is dense retrieval plus metadata filtering. Sparse or hybrid retrieval is a separate measured feature; it must not be assumed to be available or equivalent across ChromaDB versions.
5. Embeddings will use a pinned local model and recorded model/version metadata. Changing model, dimension, preprocessing, or distance metric requires a new collection and deliberate re-index.
6. No raw uploads, drafts, rejected content, private evidence excerpts, visitor conversations, or user-supplied provider keys enter the index.

## Boundary contract

The website sends only an approved immutable profile projection:

- `tenant_id`, `profile_id`, `profile_version`, and `generation`
- normalized approved sections and facts
- public provenance labels required for an answer
- stable `chunk_id` and `content_hash`
- embedding model and contract version
- explicit operation: `index`, `purge`, or `reconcile`

The service validates authorization, version state, generation fencing, payload limits, and idempotency before writing. A successful local write is not reported as indexed until record counts, metadata filters, and representative queries pass verification.

## Delivery sequence

1. Create a pinned Docker Compose ChromaDB fixture and health/readiness checks.
2. Implement the small KB API with authentication, request validation, idempotency, generation fencing, bounded retries, and status polling.
3. Add deterministic structure-aware chunking and a pinned local embedding model.
4. Add tenant/profile/version metadata filtering and isolation tests.
5. Add index, purge, restart, corruption-recovery, and clean-instance rebuild tests.
6. Add dense retrieval evaluation with a small content-safe fixture set and record Recall@K, MRR, latency, and resource use.
7. Keep the website adapter disabled/mock until the Phase 1/website contract is accepted; then connect the real HTTP adapter behind explicit publication consent.

## Free-tier operating policy

The supported ₹0 deployment is local or on already-owned infrastructure. A free third-party tier may be used only when its current terms, persistence, private networking, storage, quotas, sleep behavior, and data handling are verified and recorded. If any of those are unknown, the provider is unsuitable for durable production data.

The system must state its service level honestly: single node, no automatic high availability, possible downtime, and recovery based on rebuild time. Backups are useful but do not replace a tested rebuild from PostgreSQL-approved data.

## Definition of done

- Reproducible pinned deployment.
- Backend-only authenticated access.
- Tenant and profile-version isolation tests pass.
- Idempotent index and purge operations pass replay and stale-generation tests.
- Website remains usable when the KB is unavailable.
- Clean ChromaDB can be rebuilt and verified from approved website data.
- Embedding and collection versions are recorded.
- Retrieval and resource baselines are measured.
- No paid dependency is required or silently assumed.

## Not included yet

Live chatbot runtime, visitor conversation storage, LLM inference, public widget serving, distributed ChromaDB, Kubernetes, multi-region failover, and public hosting remain separate work.
