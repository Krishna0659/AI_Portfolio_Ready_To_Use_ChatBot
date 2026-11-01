# Google sign-in

Local Google sign-in was verified on 1 November 2026 with two user-operated accounts. The owner completed the Google screens; database checks confirmed provider-backed sessions. Each Google identity gets an isolated workspace. The local development owner and its existing source imports remain separate.

An earlier generic failure for the second account did not recur when starting a fresh flow. There is no evidence establishing the original cause. Errors now include a reference and a recovery message; `.local/auth-diagnostics.jsonl` records only time, stage, reference, allowed error codes and claim names. It excludes tokens, credentials, identity values and raw provider responses. Never send callback URLs or credential JSON in bug reports.

## Setup on another installation

1. Create/select a project in Google Auth Platform. Configure branding and an external testing audience; add intended test accounts.
2. Create a **Web application** OAuth client. Register exactly `http://localhost:3000/api/auth/callback`. This server flow does not need JavaScript origins.
3. Store the client ID and secret in ignored `.env.local` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Use `APP_ORIGIN=http://localhost:3000`.
4. Set `OIDC_FLOW_KEY` to a random 32-byte key encoded as 64 hex characters. The local initializer supplies it for new installations. Preserve it across web restarts; replacing it invalidates outstanding sign-in attempts.
5. Run `npx tsx scripts/verify-google-config.ts`, then complete an actual sign-in in a regular browser. Start each account switch from `/api/auth/google`, not an old callback URL.

Google requires exact redirect URI matching. See [OAuth client configuration](https://support.google.com/cloud/answer/15549257?hl=en).

## Validation

The app uses authorization code flow with PKCE, a browser-bound one-use state and nonce. Encrypted transient secrets expire after ten minutes. The shared callback verifier checks ID-token signatures as well as issuer, audience, expiry, nonce and state. Tests include wrong signatures/claims, ciphertext tampering, wrong encryption keys, state swapping, absent/future authentication times and diagnostics redaction.

## Deletion limitation

Google documents that it does not support Google Account reauthentication requests. Its optional authentication-time claim requires a published, verified app with the relevant security-bundle setting enabled. The tested local Google sessions did not contain that claim. Ordinary Google sign-in works, while source/account erasure stays blocked because fresh authentication cannot be verified. Local-development erasure remains available after refreshing local sign-in. A complete production step-up flow remains a release requirement; do not publish the app just to bypass this local limitation. [Google security-bundle documentation](https://developers.google.com/identity/siwg/security-bundle)

Hosting remains paused. Credentials, encryption keys and diagnostics are not committed.
