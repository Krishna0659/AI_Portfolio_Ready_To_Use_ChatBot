# RAG v3 — verified local backend configuration

The complete ten-question CV regression run passed on the configuration below: seven complete source-backed answers, three correct missing-information responses, and zero provider failures. This configuration is the handoff baseline for website integration. The website adapter and chat endpoint are not connected yet; running profiles were not migrated.

## Frozen configuration

| Stage | Setting |
|---|---|
| Generation | `gemini-3.5-flash-lite`; `grounded-selection-v5` |
| Preparation | `rag-prep-v2`, `rag-extract-v2`; generic short uppercase DOCX headings |
| Parents | Coherent section parents, maximum 4,000 characters |
| Stored children | 48 embedding tokens with 12-token overlap, never crossing parents |
| Embeddings | Pinned MiniLM; actual token-length checks, normalized vectors |
| Index contract | `parent-retrieval-v3`; re-prepare and submit a newer snapshot generation |
| Hybrid candidate retrieval | Dense/BM25 .75/.25, weighted RRF constant 60 |
| Parent reranking | Deduplicate parents first; score full parent with profile subject and section |
| Long-parent scoring | Query-budgeted 512-token pairs, 48-token overlap, maximum window score; no silent truncation |
| Rank blend | 75% cross-encoder rank, 25% hybrid rank; reciprocal-rank constant 10 |
| Rejection threshold | Raw score -8.195047378540039; model-specific, not a probability |
| Generation input | Up to five parents; 8,192-token budget with 2,048 reserved for output |
| Evidence selection | Model selects up to six whole-paragraph IDs; server renders exact paragraphs and deduplicates parent citations |
| Missing knowledge | Explicit insufficiency response; service failures remain separate |
| Provider handling | Bounded 90-second generation budget, one transient 429/503 retry within the deadline, validated model-limit cache for five minutes |

The pinned reranker weights and selection parameters are recorded in `services/knowledge-base/retrieval_policy.json`. Calibration results are in `RAG_CONTEXT_SELECTION_V3.json`. The 75% blend was selected after the CV exposed rank-dominance regressions; that CV is therefore regression evidence, not an untouched holdout. The change retains development Recall@5 while accepting a small nDCG tradeoff.

## Verified outcomes and metric definitions

`RAG_V3_VERIFICATION.json` records the final live results. All seven answered questions covered the required reference facts, all returned paragraphs were exact source text, and manual review found the selected paragraphs directly relevant. All three unsupported questions abstained correctly. These establish 100% exact-source fidelity and fact coverage on these seven answers; they are not independent LLM-judge or RAGAS estimates.

Median end-to-end latency was 8.54 seconds; maximum was 22.68 seconds, including the cold first case. The live test is not a load test. The CV's strict labelled-parent recall was 100% and precision was 20% before paragraph selection: retrieval still supplies broad context. The paragraph selector produced concise relevant answers, but the run does not demonstrate high first-stage context precision. Do not substitute final answer relevance for that retrieval metric.

68 RAG tests and 45 KB tests passed; two SDK tests were skipped. Real HTTP/Chroma verification passed snapshot replay, receipt reconciliation, generation replacement, and exact parent recovery. A parent exceeding 512 tokens produced 15 overlapping children; all stored 384-dimensional vectors matched regeneration and were normalized. The runtime still emits a semaphore cleanup warning on test shutdown.

`RAG_V3_OFFLINE_VERIFICATION.json` contains actual top-three retrieval results: Recall@3 94.44%, MRR@3 1.00, fixed-slot Precision@3 38.89%, and zero duplicates. This is lower top-three recall than the earlier 97.22%; generation uses five parents. Report this tradeoff explicitly instead of combining metrics from different configurations or cutoffs.

`RAG_V3_RETRIEVAL_K5.json` verifies the actual generation cutoff through HTTP/Chroma: Recall@5 97.22%, MRR@5 1.00, fixed-slot Precision@5 25%, nDCG@5 98.83%, zero duplicates. Fixed-slot precision divides by five even when fewer parents are returned; it differs from returned-parent precision in the calibration report and from the CV's strict parent labels.

## Integration handoff

**Website integration update:** The local authenticated delivery, chat, approval, retry and erasure flows are now implemented and verified through the built website and persistent Chroma. See `WEBSITE_RAG_INTEGRATION.md` and `WEBSITE_RAG_INTEGRATION.json`; these supersede the earlier website-handoff steps below. The historical retrieval metrics above remain unchanged. Public hosting is still paused.

1. Build the updated KB image with the pinned reranker; a clean network-dependent image build is still a deployment check.
2. Regenerate approved documents with extractor v2 and index a strictly newer snapshot using parent-retrieval-v3. Old v2 parent snapshots are not silently reinterpreted.
3. Implement the website's authenticated real delivery adapter and chat endpoint using active tenant/profile/snapshot scope, then run the complete user flow.
4. Provision and monitor sufficient provider quota. Earlier models returned quota and availability failures; a successful finite test is not a quota guarantee. No billing or hosting settings were changed.

Private CV text, questions, answers and raw traces remain under ignored `.local`; public reports contain aggregate outcomes and case IDs only. Production load, provider failover, independent-corpus generalization and the running website are outside this local verification result.
