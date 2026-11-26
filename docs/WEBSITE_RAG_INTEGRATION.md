# Website, RAG and Chroma integration

The local website now delivers approved profiles to persistent Chroma and answers through the calibrated parent-child RAG pipeline and Gemini. The interface has private chat in Overview and Settings. This is authenticated workspace chat, not an anonymously embedded public widget. Hosting remains paused.

## Use it

1. Open the local website at http://localhost:3000 and sign in.
2. In Settings, choose **RAG — approved profile chat** and save.
3. Import evidence, review/edit the draft, and approve with publishing selected.
4. Wait for the delivery status to become **succeeded**, then ask questions in Overview or Settings.

Drafts and approvals without publication consent do not become chatbot knowledge. Existing private profiles have not been automatically published. Answers include approved-section citations; missing information and provider outages have different messages. Each question is independently grounded; conversation history is not stored.

## Local services and restart

The existing local PostgreSQL directory and Chroma volumes are preserved. The website uses its existing runtime database role; the worker has restricted database functions. Secrets are in ignored local configuration, never browser variables.

From the repository root, start the existing local PostgreSQL instance on port 55432 if stopped, then run:

```powershell
npm run db:setup
docker compose --env-file .local/kb-website.env -f services/knowledge-base/compose.yml -f services/knowledge-base/compose.offline.yml -f services/knowledge-base/compose.website.yml up --build -d
npm run build
npm run start
```

In another terminal run `npm run worker`. The website runs on port 3000; only the authenticated knowledge API is published at **127.0.0.1:18080**. Chroma has no host port. The local image uses the previously verified offline runtime and the pinned cached reranker; this is not a new clean dependency build or public deployment.

Required server settings are documented in `.env.example`: `RAG_PYTHON`, `RAG_KB_URL`, `RAG_KB_API_KEY`, `GEMINI_API_KEY_FILE` (or `GEMINI_API_KEY`) and `GEMINI_MODEL`. The local model is `gemini-3.5-flash-lite`. The website caller grant explicitly permits all workspace tenants **only for `approved-profile`**, with index/query/status/purge operations. This trusted server key must never be given to a browser. Tenant and snapshot selection come from the authenticated database state, not request fields. All other credentials retain their existing exact scope.

## Delivery and erasure guarantees

- An approval and its outbox entry commit together. The worker uses a four-minute lease, bounded subprocess execution and exponential retry delays, capped at one hour. An interrupted worker can reconcile the same immutable snapshot rather than duplicating it.
- Chat requires a completed receipt matching the current approved version, publication generation and active RAG setting. It rechecks membership and that exact snapshot after generation. One generation request per workspace may be in flight at a time; abandoned locks expire after three minutes.
- Source/account erasure invalidates chat immediately and queues a newer purge generation. The queue survives workspace deletion. Deletion receipts wait for both uploaded-file cleanup and acknowledged Chroma purge. A later approval retains monotonically increasing version numbers after source erasure.
- Existing backups/exported files remain outside this erasure workflow. The integration does not claim to delete copies held outside these running services.

## Verification

Final production-server integration run: all 11 recorded checks passed, including four live Gemini requests (three delivered responses and one response suppressed after access revocation). Website tests: 101 passed. RAG tests: 73 passed. KB tests: 46 passed and two SDK checks skipped. Production build passed. Desktop and 390px mobile chat were rendered and visually reviewed.

`scripts/verify-rag-integration.ts` creates disposable identities and uses real upload/extraction, HTTP approval/chat routes, PostgreSQL, persistent Chroma, the local embedding/reranking models, Gemini and a desktop/mobile browser. Its sanitized result is `WEBSITE_RAG_INTEGRATION.json`. It also checks lack of publication consent, CSRF, tenant isolation, lost receipts, stale leases, in-flight membership revocation, source cleanup and account cascades. It removes its test identities and purges their vectors.

Run it while the website is up and the ordinary worker is stopped so its controlled lease-recovery assertions cannot race another worker:

```powershell
node --import tsx scripts/verify-rag-integration.ts
```

Provider availability can fluctuate. A live production-check attempt returned `service_unavailable`; the website did not misreport that as absent knowledge. Safe provider error codes are logged server-side without credentials, queries or source text. Finite live checks are not an uptime or quota guarantee. The build also reports a Next.js security-update recommendation, which should be resolved before any public deployment.
