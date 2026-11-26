# RAG acceptance check — 22 November 2026

Status: live acceptance has not passed. Backend storage/retrieval integration is implemented and verified in disposable infrastructure; the website has no live RAG adapter.

## Verified integration

- 64 RAG tests passed; 45 KB tests passed and two SDK tests were skipped.
- Real HTTP index/query calls, persistent disposable Chroma, real MiniLM embeddings and the pinned cross-encoder were exercised.
- A long parent produced ten children with 12-token overlap. Querying restored the complete original parent exactly once with its citation identity.
- All ten 384-dimensional stored child vectors matched regeneration within 1e-6 and were finite and normalized. This establishes embedding integrity on the fixture, not universal semantic quality.
- Snapshot replay, lost-receipt reconciliation and replacement-generation cleanup passed in the same smoke harness.
- Website inspection: `packages/domain/knowledge-base-client.ts` constructs only disabled/mock adapters; the settings API only accepts those modes. There is no completed website-to-live-RAG integration. No running profile was migrated or reindexed.

## Live provider results

The configured `gemini-3-flash-preview` completed five of ten baseline end-to-end cases correctly. Three cases ended with HTTP 503 and two with provider timeouts. The successful prompt-leak abstention did not call generation, so five completed pipeline cases must not be interpreted as five successful Gemini generations. No complete-run answer-quality score is assigned.

`gemini-2.5-flash` appeared in official model discovery and loaded metadata, but its countTokens call returned HTTP 404. All twelve challenge attempts failed at that prerequisite. `gemini-3.5-flash` loaded metadata and counted tokens but timed out at the 35-second generation probe deadline. `gemini-3.1-flash-lite` loaded metadata and counted tokens but generation returned HTTP 503. These are observations from this account/run, not claims of permanent model unavailability. The default model was not changed because no alternative passed the checks.

## Fresh challenge results

All twelve new questions were attempted on the configured model with the final retrieval policy. The six answerable questions all returned complete, exact supported answers with the expected citations, including two projects, two distinct metrics, and both teaching/leadership roles. Of six unanswerable questions, two correctly abstained; the semester-specific GPA request timed out, and the dataset-size, unknown-employer and injection cases ended with HTTP 429. These four cases do not establish semantic fallback correctness.

On the six answerable questions, macro labelled context recall was **100%** and macro labelled context precision was **40%**. These measure document-ID overlap in returned context, not LLM-judged relevance. The low precision exposes unnecessary retrieved context despite complete recall. All six delivered challenge answers matched their required source excerpts; this is a deterministic support check, not general faithfulness certification.

Across the baseline and fresh challenge runs on `gemini-3-flash-preview`, **13/22 cases completed correctly (59.1% end-to-end completion)**. Nine failed: three HTTP 503, three HTTP 429 and three provider timeouts. This is an availability-inclusive completion measure, not an aggregate answer-quality score. The twelve failed 2.5 Flash attempts are reported separately and are not folded into that denominator. The challenge corpus was already used in development; only the questions were fresh. No configuration was tuned against these new results.

**Final decision: acceptance failed.** Required next work: resolve provider availability/quota and repeat the full frozen suites; improve context precision with separate calibration and independent evaluation; then implement and test the website's real adapter and chat endpoint. Backend code integration alone is not a completed user-facing integration.

## Evidence and limitations

- `RAG_QUALITY_20261122_PREVIEW.json`: ten baseline cases with redacted per-case failure codes.
- `RAG_QUALITY_20261122_HARD.json`: twelve fresh challenge questions, answers, retrieved source IDs and failure codes.
- `RAG_QUALITY_20261122_FLASH25.json`: twelve alternate-model challenge attempts.
- `RAG_MODEL_PROBES_20261122.json`: stage-specific alternative-model checks.
- `RAG_EMBEDDING_CHECK_20261122.json`: vector integrity and exact parent recovery.
- `RAG_V2_RETRIEVAL.json`: earlier twelve-question development retrieval benchmark; not rerun or relabelled as independent acceptance here.

Synthetic evidence only was sent to Gemini. These cases do not establish broad corpus generalization, production capacity, a clean image build, or live website integration. Generation is exact-excerpt based: correct quotes establish source support, not source truth. LLM-judged faithfulness and answer relevance have not been measured. The runtime still reports a semaphore cleanup warning at shutdown; no production resource-leak claim can be excluded by these short tests.
