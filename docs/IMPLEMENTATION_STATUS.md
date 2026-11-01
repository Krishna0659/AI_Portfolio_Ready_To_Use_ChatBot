# Phase 1 implementation status

This is a functioning local development implementation, not completion of the full production specification. Hosting is intentionally deferred. No Phase 2 indexing or Phase 3 inference is implemented.

## Implemented

- Next.js App Router, React, TypeScript; locally served IBM Plex Sans and responsive dense dashboard.
- PostgreSQL persistence, a separate non-owner runtime role, forced tenant RLS on content tables, tenant-bearing foreign keys, transaction-local context.
- Google OIDC authorization code + PKCE/state/nonce flow; opaque hashed sessions and CSRF-protected mutations. Google credentials are not supplied and the real provider flow is not verified.
- Explicit loopback development login; binds Next.js to 127.0.0.1. Never expose this development setup publicly.
- Website single-page HTML/text extraction with public HTTPS-only validation, DNS address checks/pinning, redirect validation, time and byte bounds.
- Public GitHub repository README imports via GitHub API; no credential scraping.
- DOCX/PDF/TXT/Markdown uploads with size limits, random local storage names, bounded Python subprocess parsing, XML entity protections, ZIP expansion and PDF active-content checks.
- Durable per-source jobs, lease-fenced result commits, expired-lease recovery, cancellation, user-triggered retry and synchronization. Existing draft text is never overwritten by an import.
- Source evidence stays distinct until the user adds it to a draft; source identity is never assumed to match profile identity.
- Structured editable draft, provenance references, optimistic revision checks, immutable approved versions, approval idempotency, deterministic Markdown and canonical SHA-256 hashes.
- Private authenticated JSON/Markdown exports, version-to-draft restoration, source detachment and source erasure of linked draft facts/history.
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
- Separate identity and worker database roles with narrowly scoped security-definer procedures; current worker can enumerate workspace IDs and shares the web runtime role. Global identity tables are not isolated into their specified restricted role.
- Complete membership-aware RLS, approval/evidence deferred database constraints, profile-bearing composite keys across the full schema, protected append-only audit and dedicated erasure role.
- Full account erasure, object-purge outbox, retention/reconciliation jobs, backup deletion tombstones and restoration testing. Local source erasure is not a substitute for the full lifecycle design.
- Full retry classification/backoff, heartbeats, per-tenant fairness, API quotas and the complete durable KB contract/mock scenarios (timeouts, accepted/polling, generation fences, purge).
- Recent reauthentication, idle/absolute session rotation lifecycle, encrypted transient OIDC flow storage, complete negative-provider identity tests.
- OpenAPI-generated contracts, operational metrics/alerts, dependency/container/secret CI gates, load and fault-injection tests, accessibility audit.

## Environment and verification boundaries

The available local database is PostgreSQL 16. The specification calls for PostgreSQL 17 in production. Local filesystem storage substitutes for private object storage during development only. Credentials and imported files stay in ignored `.env.local` and `.local/` paths. User reference documents under `sources/` were not changed.

Executed check artifacts are `import-check.json`, `api-check.json`, `browser-check.json`, and `screenshots/`. Do not equate successful sample imports with coverage of arbitrary hostile files or public-launch readiness.
