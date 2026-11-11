# Phase 1 implementation status

Milestone disposition — 11 November 2026: local Phase 1 Foundation and Phase 2 Profiles are complete against PRD section 10 exit gates. Database-enforced approval and evidence provenance, immutable triggers, append-only audit log, concurrent approval serialization, stale edit rejection, and rollback restoration are verified across 38 automated tests. Phase 3 Ingestion is next; hosting and production release remain deferred.

Current update (11 November 2026): Google is the only sign-in method; the public local-login endpoint is disabled and theme switching has been removed. Passkey enrollment uses a five-minute, one-use Google account-access confirmation bound to the existing session. Sensitive actions for Google accounts require passkey verification. The user confirmed the real Google/enrollment/verification sequence succeeds. Commit 1b856ca passed foundation CI and 33 local tests; local API/membership checks also passed and the worker was started. Fresh authenticated GitHub import and dashboard browser acceptance remain outstanding, so Phase 1 is not closed. Older implementation details below describe historical behavior where superseded by this update.

This is a functioning local development implementation, not completion of the full production specification. Hosting is intentionally deferred. No Phase 2 indexing or Phase 3 inference is implemented.

## Implemented

- **Phase 2 Profiles**: Database-enforced `version_evidence` table with composite foreign keys to versions, snapshots, and sources with tenant RLS. Complete `approvals` metadata (`draft_revision`, `partial_ack`, `publish_consent`). Immutable triggers preventing modification on `versions`, `approvals`, and `version_evidence`. Append-only protection trigger and runtime role revocation on `audit` table. Draft rejection/reset API and UI discard control. Dedicated test suite in `tests/profiles.test.ts` verifying concurrent approval serialization, stale edit conflict rejection, rollback restoration, and cross-tenant isolation.
- Next.js App Router, React, TypeScript; locally served IBM Plex Sans and responsive dense dashboard.
- PostgreSQL persistence, a separate non-owner runtime role, forced tenant RLS on content tables, tenant-bearing foreign keys, transaction-local context.
- Google OIDC authorization code + PKCE/state/nonce flow; opaque hashed sessions and CSRF-protected mutations. Transient verifier/nonce payloads use AES-256-GCM encryption bound to state. ID-token signatures, issuer, audience, expiry and nonce are checked. Two Google accounts successfully signed in interactively on 1 November 2026; configuration and session creation were verified. An earlier generic failure for the second account did not recur on a fresh attempt; its cause is unconfirmed. Safe stage/error references now support diagnosis.
- Explicit loopback development login; binds Next.js to 127.0.0.1. Never expose this development setup publicly.
- Website single-page HTML/text extraction with public HTTPS-only validation, DNS address checks/pinning, redirect validation, time and byte bounds.
- Public GitHub repository README imports via GitHub API; no credential scraping.
- DOCX/PDF/TXT/Markdown uploads with size limits, random local storage names, bounded Python subprocess parsing, XML entity protections, ZIP expansion and PDF active-content checks.
- Durable per-source jobs, lease-fenced result commits, expired-lease recovery, cancellation, user-triggered retry and synchronization. Existing draft text is never overwritten by an import.
- Fifteen-second worker heartbeats extend valid sixty-second leases. Both success and failure commits reject expired/reassigned/cancelled leases. Transient network failures retry with jittered exponential delays, provider waiting periods are honored, and imports stop after five attempts. Each pass handles at most one job per tenant.
- Source evidence stays distinct until the user adds it to a draft; source identity is never assumed to match profile identity.
- Structured editable draft, provenance references, optimistic revision checks, immutable approved versions, approval idempotency, deterministic Markdown and canonical SHA-256 hashes.
- Private authenticated JSON/Markdown exports, version-to-draft restoration, source detachment and source erasure of linked draft facts/history.
- Local account erasure with exact confirmation and authentication within 10 minutes; immediate session revocation and transactional workspace removal. Durable uploaded-object cleanup retries across worker restarts; hashed bearer receipts expose only completion status. Account receipts also wait for earlier source cleanup. Concurrent completions are serialized per account.
- Transactional sign-in with same-device session replacement, rolling 12-hour idle expiry bounded by seven days, and fresh authentication before source/account erasure.
- Transactional local delivery events; disabled and minimal mock modes explicitly distinguished from live indexing.
- Widget appearance preferences and non-conversational preview.
- Workspace light/dark/system theme, immediate preview and persisted settings; system preference follows OS changes.
- Public GitHub rate-limit classification with persisted shared-host cooldown, automatic bounded retry, explicit waiting time, and reusing failed source records rather than rejecting duplicates.
- Source evidence comparison between the two latest successful captures (added/removed lines). This is not full three-way profile conflict resolution; drafts remain untouched.
- Owner-operated local GitHub App installation client: workspace binding, installation matching, repository-scoped read-only tokens, bounded fixed-host requests. Synthetic tests pass. Live authenticated worker imports verified on 1 November 2026 for PaySure and Text-Summazrizer, with new evidence snapshots and no import errors. Multi-user installation authorization and webhooks below remain open.

## Required before calling the full Phase 1 specification complete

These are implementation gaps, not merely credential or hosting tasks:

- Multi-user GitHub App installation ownership verification, user-to-installation authorization, private-repository live verification, and webhook verification/revocation. Local-owner installation matching and scoped token minting are implemented and verified above.
- Multi-page policy-aware crawling and robots handling, structured metadata extraction beyond reviewable text, three-way field-level synchronization/conflict resolution.
- Independent OS/container enforcement of parser networking/filesystem limits, malware scanning, private immutable object-storage upload protocol and storage quotas. Local Python socket blocking is not a security sandbox.
- Separate worker database role with narrowly scoped claim/heartbeat/result procedures; current worker still shares the web runtime role. Identity tables now use a separate role, ordinary workspace SQL cannot read them, and recent-authentication lookup uses a restricted boolean function. Service-specific secret distribution remains open.
- Complete membership-aware RLS, approval/evidence deferred database constraints, profile-bearing composite keys across the full schema, protected append-only audit and dedicated erasure role.
- Production storage erasure, retention/reconciliation jobs, backup deletion tombstone replay and restoration testing. Local account/object deletion is implemented; external exports and backups remain outside its boundary.
- Production fairness/load guarantees, API quotas and the complete durable KB contract/mock scenarios (timeouts, accepted/polling, generation fences, purge). Local heartbeat, recovery and bounded retry behavior is implemented.
- Google-account deletion step-up: Google does not support forced reauthentication and authentication-time claims require enabled security-bundle features. The tested sessions have no such claim, so Google source/account erasure fails closed. Normal sign-in works. Local-development reauthentication works; negative token/callback and encrypted-flow tests pass, but the full provider fault matrix remains open.
- OpenAPI-generated contracts, operational metrics/alerts, dependency/container/secret CI gates, load and fault-injection tests, accessibility audit.

## Environment and verification boundaries

The available local database is PostgreSQL 16. The specification calls for PostgreSQL 17 in production. Local filesystem storage substitutes for private object storage during development only. Credentials and imported files stay in ignored `.env.local` and `.local/` paths. User reference documents under `sources/` were not changed.

Executed check artifacts are `import-check.json`, `api-check.json`, `browser-check.json`, and `screenshots/`. Do not equate successful sample imports with coverage of arbitrary hostile files or public-launch readiness.
