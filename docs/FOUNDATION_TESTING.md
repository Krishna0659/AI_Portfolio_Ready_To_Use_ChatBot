# Foundation verification

The isolated Linux test stack uses PostgreSQL 17 and Node 24. It exposes no host ports, imports no user data, and receives no Google/GitHub credentials. The database is disposable; the test runner runs as an unprivileged user. Container base images and GitHub Actions are pinned to resolved digests/revisions; Node dependencies and Python packages are version-pinned.

Run from the repository root with Docker Desktop or Docker Engine/Compose running:

```sh
node scripts/prepare-foundation-test.mjs
docker compose -f compose.test.yml up --build --abort-on-container-exit --exit-code-from checks
docker compose -f compose.test.yml down
```

Only the generated test environment is replaced by the preparation command; the existing `.env.local`, user database and uploaded objects are not used or changed. Stop the disposable stack before regenerating its credentials. The test environment file is readable by the container UID and contains disposable credentials only. Do not copy production credentials into it.

The checks apply migrations, exercise authentication/tenant/worker/lifecycle behavior, run TypeScript and parser checks, build the production application, and test API and membership behavior against that built server. GitHub Actions runs this stack with read-only repository permissions and no deployment step, plus a Node dependency audit and a baseline credential-pattern check. The pattern check is not exhaustive secret detection or a full security audit.

The Windows development database remains PostgreSQL 16. Run database unit tests against the isolated stack when the development worker is active: both can otherwise claim the same disposable test jobs. The Linux test stack has no background worker competing for test fixtures.

This is a foundation test baseline, not a production deployment manifest. Separate identity/web/worker privileges, restricted worker procedures, complete membership RLS and additional authentication for Google destructive actions remain required before Phase 1 is complete. Hosting is postponed until all five phases and end-to-end checks are complete.
