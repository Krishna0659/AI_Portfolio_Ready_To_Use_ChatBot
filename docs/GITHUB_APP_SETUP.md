# GitHub App: local-owner setup

This adds authenticated repository imports for **one explicitly bound local owner workspace**. It does not implement the production multi-user GitHub authorization/installation flow or revocation webhooks. The app remains loopback-only.

## Create and install

1. Open https://github.com/settings/apps/new while signed into the account that owns the repositories.
2. Use a unique name, for example `Krishna-PortfolioAI-Local`, and homepage `http://localhost:3000`.
3. Leave user authorization during installation unchecked. No OAuth callback is needed for this owner-operated installation path.
4. Uncheck **Active** under Webhook for local development. Production webhook handling remains a separate requirement.
5. Repository permissions: **Contents: Read-only**. Metadata read access is automatic. Do not grant write, administration, or organization permissions.
6. Choose **Only on this account**, create the app, record the App ID and generate a private key.
7. Use **Install App**, choose your account and **Only select repositories**. Select the repositories you want imported, such as PaySure and Text-Summazrizer. Do not install on unrelated repositories.
8. Record the Installation ID from the installation settings URL, e.g. `/settings/installations/12345678`. It is different from the App ID.

## Configure privately

Keep the downloaded key in an ignored local path such as `.local/github-app.pem`. Do not paste its contents into chat or commit it.

Add these fields to `.env.local` (not `.env.example`):

```dotenv
GITHUB_APP_ID=your_numeric_app_id
GITHUB_INSTALLATION_ID=your_numeric_installation_id
GITHUB_PRIVATE_KEY_PATH=.local/github-app.pem
GITHUB_OWNER_WORKSPACE_ID=your_local_owner_workspace_uuid
```

Run `npx tsx scripts/github-status.ts` to obtain the local owner workspace ID and check configuration. It prints no token or private key. Use only your personal local workspace ID; this binding is the operator's authorization decision for this development-only deployment.

Restart `npm run worker` after editing environment values. Select a repository in Sources and sync it. If an old anonymous-quota retry is still queued, cancel that import first, then sync again. Existing evidence is retained. No new source record is needed.

## What the client enforces

- The requested repository must belong to the configured installation and that installation must not be suspended.
- Each token is restricted to that repository with Contents read-only permission.
- Tokens and JWTs exist only in memory and are never returned to the browser.
- Requests use fixed GitHub API paths, time/size bounds, and reject redirects rather than forwarding credentials.
- The configured workspace uses installation authentication and does not wait on the shared anonymous-IP cooldown. Other workspaces retain the public-only path.
- Missing configuration leaves the existing anonymous public-import path available. Provider rejection of a configured authenticated request does not silently fall back to another access path.

## Verification limit

Tests cover signing, token scope, installation mismatch/suspension and endpoint restrictions with synthetic keys and mocked responses. Live configuration/import testing requires your GitHub App. Authenticated requests have separate quotas; authentication does not mean unlimited syncing.

Official references: [installation authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-an-installation), [repository permissions](https://docs.github.com/en/apps/creating-github-apps/setting-up-a-github-app/choosing-permissions-for-a-github-app).
