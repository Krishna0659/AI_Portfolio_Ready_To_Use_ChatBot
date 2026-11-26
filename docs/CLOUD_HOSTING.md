# Cloud hosting — 27 November 2026

Public website: https://portfolioai-mu.vercel.app

Google callback: https://portfolioai-mu.vercel.app/api/auth/callback

## Architecture

Vercel hosts the public routing deployment in `deploy/vercel`. It forwards requests over HTTPS to the Next.js application on Azure. Vercel does not run the Python pipeline or store uploads. The same public origin handles the website, OAuth and authenticated APIs.

Azure resource group: `portfolioai-pilot-rg`. VM: `portfolioai-backend`, Malaysia West, Standard_B2as_v2 (2 vCPU / 8 GiB), 64 GiB Standard SSD. The resource group's Central India metadata does not change the VM's actual region.

Azure hostname: `portfolioai-krishna0659.malaysiawest.cloudapp.azure.com`. Caddy manages HTTPS certificates. Only ports 80/443 are public; PostgreSQL, Chroma and the knowledge API have no published host ports. SSH is only opened temporarily to the operator's current IP for maintenance, then removed.

Docker Compose runs web, worker, PostgreSQL, Chroma, the knowledge service and Caddy. Named volumes persist database state, uploads, Chroma snapshots, knowledge state and certificates. Containers restart automatically; logs are capped at three 10 MB files per service. Separate database roles and a scoped website knowledge credential are retained. API keys stay on Azure, not in the browser or Vercel routing configuration.

## Verified

- User confirmed Google login opens the deployed dashboard.
- Public HTTPS page and database health pass through Vercel.
- Disposable live profiles passed upload, autonomous extraction, approval, indexing, cited Gemini answer, unknown-semester fallback, tenant isolation, source invalidation and account erasure.
- 101 website tests pass; TypeScript checks pass; npm audit reports zero known vulnerabilities after Next.js 16.4.6 upgrade.
- Encrypted backup decrypted and restored into an isolated PostgreSQL database (22 public tables), then the temporary restore database was removed. Vector/object directories are present in the archive. This is not a full VM-loss recovery drill.
- Encrypted off-VM backup upload and read-back SHA-256 verification pass. Services recover after the backup pause.

Detailed evidence: `CLOUD_HOSTING_VERIFICATION.json`.

## Backups and recovery

`portfolioai-backup.timer` runs daily at 21:30 UTC / 03:00 IST. It briefly stops web, worker, knowledge and Chroma for a consistent snapshot, dumps PostgreSQL, archives uploads/vector state and server configuration, encrypts the archive, restarts the services and uploads it to private Azure Blob Storage.

Storage account: `portfoliobackup0659`; container: `snapshots`. Public blob access and shared-key authentication are disabled. The VM uses its managed identity, restricted to this storage account. Local and Blob lifecycle retention are seven days. Backup interruption is expected during the nightly consistency pause; this is a single-VM pilot, not a high-availability deployment.

The encryption passphrase is stored privately at `/root/portfolioai-backup-passphrase` on the VM and `.local/cloud/backup-passphrase` in the operator checkout. An encrypted off-server copy is also in `.local/cloud/cloud-backup.enc`. Keep the local key securely backed up separately: Azure blobs cannot be decrypted without it. These files must never be committed.

To restore, use an isolated host, decrypt with OpenSSL AES-256-CBC/PBKDF2 (200000 iterations), restore `database.dump` into PostgreSQL, restore the matching Chroma/knowledge/object volumes and configuration, then apply any deletion records newer than the selected snapshot before exposing the service. Restore the whole matching snapshot, not individual stale components. Check all services and rerun the cloud acceptance script before reopening access.

## Operation and deployment

Server checkout: `/opt/portfolioai`; configuration: `deploy/*.env` (mode 600). Runtime services do not receive the administrator database password; `migration.env` is mounted only for migration/verification tasks.

From the server checkout:

```sh
sudo docker compose -f deploy/compose.yml ps
sudo docker compose -f deploy/compose.yml logs --tail 50 web worker knowledge
sudo systemctl status portfolioai-backup.timer
sudo journalctl -u portfolioai-backup.service -n 30
```

For application changes, build the web/knowledge images as needed, run migrations with the private migration environment, update containers and rerun `scripts/verify-cloud.ts`. That script creates synthetic profiles and cleans them up. Do not publish its temporary sessions or migration credentials.

For Vercel routing changes, deploy only `deploy/vercel` using the linked PortfolioAI project. Never deploy the repository root as an independent serverless Next.js backend: the cloud deployment intentionally uses Azure for persistent application processing.

The Google settings and current domain are configured. Website deployment is complete for the existing authenticated dashboard. Anonymous embeddable-widget functionality is a separate unfinished feature.

## Cost and limits

Estimated base Azure VM/disk/IP cost: USD 74.52 per 730-hour month, plus usage and small backup storage/transaction charges. This is credit-funded, not permanently free. The monthly alert budget is INR 4650 (approximately USD 50 at setup), with 50/80/100% emails; it does not stop spending and is lower than the expected monthly hosting cost.

Vercel's external proxy has a 120-second request limit. Normal live answers passed through it; provider outages and unusually long requests can still fail. The pilot has not undergone a sustained production-load or full VM-loss test. Operational health is available at `/api/health`; Gemini uptime is not guaranteed by this deployment.
