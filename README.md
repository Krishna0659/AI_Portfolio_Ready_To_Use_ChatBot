# PortfolioAI — local Phase 1 workspace

Working local source imports and profile review. **Read [implementation status](docs/IMPLEMENTATION_STATUS.md) before treating this as a completed production Phase 1.** Follow [the working plan](plan.md): hosting is paused throughout every phase and happens only after all website phases are complete and the website passes end-to-end checks. The current workspace is intended for local verification.

## Open

Visit http://localhost:3000 and choose **Open local development workspace**. The supplied portfolio, PaySure README and résumé have been imported as separate sources. No combined profile has been approved on your behalf.

1. Sources → choose a source → inspect evidence → Add to draft.
2. Review → edit name, headline, sections and facts → Save draft.
3. Confirm review and any incomplete imports → Approve version.
4. Versions → download JSON or Markdown. Restore creates a draft requiring another approval.

Settings → Theme changes the whole workspace immediately; **Save settings** persists the choice. System follows your operating-system preference. Failed imports can be retried on their existing source; quota-limited GitHub imports display a waiting time and retry automatically. When multiple successful captures exist, Source evidence shows an expandable added/removed-line comparison.

The web process and import worker should stay running together during local use so queued imports and file cleanup can finish.

## Run on this Windows workspace

The initial setup is already complete. In separate terminals from this directory:

```powershell
& 'C:/Program Files/PostgreSQL/16/bin/pg_ctl.exe' -D .local/postgres -l .local/postgres.log -o '-p 55432 -h 127.0.0.1' start
npm run dev
npm run worker
```

`npm run worker` must run in a second terminal while the web process runs. If PostgreSQL is already running, do not start another instance.

For a fresh machine: install Node LTS, PostgreSQL and Python; `npm ci`; adapt `scripts/local-init.mjs` paths; run it; install `services/extraction/requirements.txt` into `.local/python-packages`; `npm run db:setup`. Configuration is local and ignored by Git. The initializer will not overwrite existing configuration.

The disposable Linux baseline is documented in [Foundation testing](docs/FOUNDATION_TESTING.md); it does not use the local database or imported sources.

## Google sign-in

Google sign-in is configured and was verified interactively with two accounts on 1 November 2026. Each identity has a separate workspace; the supplied references remain in the local development workspace. See [Google setup and verification](docs/GOOGLE_SIGN_IN.md).

For another installation, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and a random 32-byte hex `OIDC_FLOW_KEY` in `.env.local`. The local initializer generates the encryption key. Register `http://localhost:3000/api/auth/callback` and keep `APP_ORIGIN` exactly `http://localhost:3000`. Development remains loopback-only.

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

No LLM, embeddings, public hosting or chat runtime. Imported content lives in local PostgreSQL and `.local/objects`. Exported files leave the app's deletion boundary. Source erasure removes all versions linked to that source, not just the current version. Local account erasure includes durable file cleanup and requires verified recent authentication. Google sessions without a recent provider authentication-time claim cannot erase data. Production retention, backups, malware scanning and isolation remain open in the implementation status.
