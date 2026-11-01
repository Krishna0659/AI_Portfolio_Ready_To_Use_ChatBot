# PortfolioAI working plan

Last updated: 1 November 2026 (Asia/Calcutta).

## 1. Completed so far

These are verified local capabilities, not a declaration that any complete production phase has passed. Work already spans several phases of the website PRD.

- [x] Repository, Next.js/React dashboard, PostgreSQL persistence and separate runtime database role.
- [x] Dense responsive workspace with working light, dark and system themes; saved preferences and document-input warning fixes.
- [x] Local development login and Google sign-in verified with two accounts, each with a separate workspace. Existing imports remain in the local development workspace.
- [x] Hashed sessions, CSRF protection, idle/absolute expiry, encrypted temporary login data and validated Google callbacks. Safe error references added; an earlier second-account error did not recur after a fresh attempt, and its original cause remains unconfirmed.
- [x] Tenant isolation on content tables, with real-database isolation tests.
- [x] Active workspace/membership checks on browser API transactions and session lookup; owner-only mutations and deletion checks. Owner memberships were backfilled for existing workspaces. Local verification now passes 27 tests and all 10 API workflows. Database-role separation remains open.
- [x] Profile draft editor, revision checks, explicit approval, immutable versions, private JSON/Markdown export and restore-to-draft.
- [x] Single-page website imports, GitHub README imports and DOCX/PDF/TXT/Markdown uploads. Supplied portfolio and résumé were captured as separate evidence.
- [x] Local-owner GitHub App authorization; fresh PaySure and Text-Summazrizer captures verified. Rate-limit handling and failed-source retries implemented.
- [x] Durable import jobs, cancellation, heartbeats, interrupted-worker recovery and bounded retries; late results cannot replace cancelled or reassigned jobs.
- [x] Evidence stays separate from drafts until selected; comparison of the two latest successful captures is available.
- [x] Disabled/minimal mock knowledge-base delivery and non-conversational widget preview. These are not live indexing or chat.
- [x] Source erasure and confirmed local-account deletion, session revocation, durable uploaded-file cleanup and completion receipts.
- [x] Latest verification: 26 automated tests, production build, 10 API workflow checks, 7 lifecycle checks and 7 interface regression checks passed. GitHub captures and two Google sign-ins were also verified live.
- [x] Changes committed and pushed through `c2f37c6`, including deletion (`a458339`), worker recovery (`9109e40`) and Google sign-in (`c2f37c6`). Credentials remain outside Git.

Detailed evidence and limitations: [verification](docs/VERIFICATION.md) and [implementation status](docs/IMPLEMENTATION_STATUS.md).

## 2. Plan to execute

**Hosting decision — updated by the user on 1 November 2026:** Hosting is paused for every phase. Do not deploy or set up public hosting during intermediate phases. Finish all website phases, verify the complete website works end to end, and only then perform hosting setup and deployment as the final step. Local development and testing continue throughout.

Use the five website phases in the reference PRD as the execution order. Existing features above count as progress, but each phase still needs its remaining exit checks. ChromaDB/RAG are separate later projects in that PRD; they are not website Phase 2 or Phase 3.

1. **Phase 1 — Foundation:** Finish identity/worker database-role separation, membership-aware isolation, authentication edge cases, Linux/local Compose reproducibility and CI/security checks. Establish a working additional authentication method for Google-account destructive actions; the tested Google sessions lack a verified recent authentication time, so source/account erasure is currently blocked for them. Verify authentication and two-tenant isolation before closing this phase.
2. **Phase 2 — Profiles:** Complete database-enforced approval/evidence relationships, append-only audit protections and concurrent approval/export/restore coverage. Confirm stale edits and concurrent approvals fail safely.
3. **Phase 3 — Ingestion:** Complete multi-user GitHub installation authorization, private-repository checks and webhook verification/revocation. Add policy-aware multi-page crawling, structured extraction, independently isolated parsing, malware scanning, private object storage and storage quotas. Verify website URLs, GitHub and document uploads all work end to end before launch; permission denials must remain explicit.
4. **Phase 4 — Synchronization:** Complete field-level conflict resolution and partial-result handling. Finish the durable disabled/mock knowledge-base delivery contract, retries, polling, generation checks and purge behavior. Prove that unapproved, duplicate and stale versions cannot activate. Keep previews clearly identified until their real runtime exists.
5. **Phase 5 — Release readiness, before hosting:** Finish retention/reconciliation, backup deletion replay and restore tests, API quotas, operational metrics/alerts, accessibility, performance/load testing, security review and API contracts. Test the whole website locally in a reproducible environment, including every supported source type, sign-in, review, approval, export, synchronization and deletion. Resolve release-blocking failures and meet the PRD/TRD acceptance criteria.
6. **Hosting — final step only:** After all five phases and end-to-end website checks pass, determine the hosting configuration and inputs, carry out deployment/restore exercises, then verify the deployed website. No intermediate-phase hosting.

Maintain this file with every completed work batch: add verified results to section 1, update remaining work in section 2, record the date and relevant checks/commits, and preserve explicit limitations. Do not mark untested work, mocks, configuration alone or partial features as fully complete. Keep meaningful commits and pushes; never inflate the count with empty commits. Read-only reference files under `sources/` remain unchanged.
