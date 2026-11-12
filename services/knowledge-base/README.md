# PortfolioAI Knowledge Base

This is the first standalone ChromaDB implementation. It indexes only approved profile projections and exposes no host port by default. The website or another trusted backend must call it with `x-kb-api-key`.

## Run

```powershell
Copy-Item .env.example .env
# Replace KB_API_KEY in .env with a long random value
docker compose --env-file .env up --build -d
```

The first startup downloads the pinned local embedding model into the named model volume. Gemini is not required. It can be added later only to generate final answers after retrieval; it must not be used for indexing identity facts.

## Fixture smoke test

The Compose file deliberately publishes no host port. Run the smoke test from a trusted backend container or a one-off diagnostic container attached to the `private` network. Do not add a public port mapping to ChromaDB or the KB service.

The request sequence is:

1. `POST /v1/index` with `fixtures/krishna-gaur-approved-profile.json`.
2. `POST /v1/query` with tenant `fixture-tenant`, profile `krishna-gaur`, and query `Which project uses escrow?`.
3. Repeat the index request and confirm it is safe to replay.
4. Send a lower-generation request and confirm it returns `409`.

The service intentionally has one worker and a local state file for the initial single-node deployment. Scale-out, distributed locking, and high availability are not claimed.
