# PortfolioAI Knowledge Base

This is the first standalone ChromaDB implementation. It indexes only approved profile projections and exposes no host port by default. The website or another trusted backend must call it with `x-kb-api-key`.

## Run

```powershell
Copy-Item .env.example .env
# Replace KB_API_KEY in .env with a long random value
docker compose --env-file .env up --build -d
```

The image build downloads the local embedding model into /opt/embedding-model. Runtime loads that packaged model with offline mode enabled. Gemini is not required. The model revision and transitive dependencies still need locking before production acceptance.

Local validation on 12 November 2026: real HTTP readiness, resume index/replay, PaySure-first retrieval, unrelated-tenant filtering and five unit tests passed. The running local stack uses a generated environment secret. Configure a durable private .env secret before future Compose recreation.

Production limitations: the shared key trusts the backend to authorize tenant IDs; replacement indexing is not atomic; conflicting same-generation payloads are not rejected yet. Restore testing, resource limits and evaluation metrics remain open. Keep this service disconnected from the website until those acceptance gates pass.

## Fixture smoke test

The Compose file deliberately publishes no host port. Run the smoke test from a trusted backend container or a one-off diagnostic container attached to the `private` network. Do not add a public port mapping to ChromaDB or the KB service.

The request sequence is:

1. `POST /v1/index` with `fixtures/krishna-gaur-approved-profile.json`.
2. `POST /v1/query` with tenant `fixture-tenant`, profile `krishna-gaur`, and query `Which project uses escrow?`.
3. Repeat the index request and confirm it is safe to replay.
4. Send a lower-generation request and confirm it returns `409`.

The service intentionally has one worker and a local state file for the initial single-node deployment. Scale-out, distributed locking, and high availability are not claimed.
