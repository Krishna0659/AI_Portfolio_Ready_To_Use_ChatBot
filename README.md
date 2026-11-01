# PortfolioAI — local Phase 1 workspace

Working local source imports and profile review. **Read [implementation status](docs/IMPLEMENTATION_STATUS.md) before treating this as a completed production Phase 1.** Hosting is paused.

## Open

Visit http://localhost:3000 and choose **Open local development workspace**. The supplied portfolio, PaySure README and résumé have been imported as separate sources. No combined profile has been approved on your behalf.

1. Sources → choose a source → inspect evidence → Add to draft.
2. Review → edit name, headline, sections and facts → Save draft.
3. Confirm review and any incomplete imports → Approve version.
4. Versions → download JSON or Markdown. Restore creates a draft requiring another approval.

Settings → Theme changes the whole workspace immediately; **Save settings** persists the choice. System follows your operating-system preference. Failed imports can be retried on their existing source; quota-limited GitHub imports display a waiting time and retry automatically. When multiple successful captures exist, Source evidence shows an expandable added/removed-line comparison.

## Run on this Windows workspace

The initial setup is already complete. In separate terminals from this directory:

```powershell
& 'C:/Program Files/PostgreSQL/16/bin/pg_ctl.exe' -D .local/postgres -l .local/postgres.log -o '-p 55432 -h 127.0.0.1' start
npm run dev
npm run worker
```

`npm run worker` must run in a second terminal while the web process runs. If PostgreSQL is already running, do not start another instance.

For a fresh machine: install Node LTS, PostgreSQL and Python; `npm ci`; adapt `scripts/local-init.mjs` paths; run it; install `services/extraction/requirements.txt` into `.local/python-packages`; `npm run db:setup`. Configuration is local and ignored by Git. The initializer will not overwrite existing configuration.

## Google sign-in

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env.local` using your own Google OAuth app. Register `http://localhost:3000/api/auth/callback` for local testing. Keep `APP_ORIGIN` exactly `http://localhost:3000`, and use that hostname in the browser. Disable `LOCAL_DEVELOPMENT_LOGIN` before any non-local environment. Real provider sign-in is unverified until credentials are available.

## Checks

```powershell
npm run check
npm test
npm run build
node scripts/api-check.mjs
node scripts/browser-check.mjs
```

API/browser checks need the web/database processes. Browser check uses installed Edge. `scripts/smoke.mjs` imports the user-supplied references and uses a machine-specific résumé path; do not run it as a generic CI fixture. It records status/counts without copying résumé text into reports.

## Privacy

No LLM, embeddings, public hosting or chat runtime. Imported content lives in local PostgreSQL and `.local/objects`. Exported files leave the app's deletion boundary. Source erasure removes all versions linked to that source, not just the current version. Full account purge, retention, malware scanning and production isolation remain open in the implementation status.
