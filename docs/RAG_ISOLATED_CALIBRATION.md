# Isolated calibration — 19 November 2026

Completed retrieval-only experiments using actual MiniLM embeddings and the `cross-encoder/ms-marco-MiniLM-L-6-v2` reranker. No generator, running database, website or full-pipeline tests were called. Results are exploratory and not activated.

## Dataset and selection

`services/rag/fixtures/general-calibration-v1.json` supplies 20 answerable QA pairs and 10 negative questions with a shared expected fallback across ten synthetic domains. Five document domains supply calibration labels; five different domains supply validation labels. This is a very small development dataset, already inspected during development, not independent release evidence. Documents are short: longer manuals, tables and multi-section questions still need testing.

The first sweep tested 64 combinations of token size/overlap, RRF constant and dense weight. Selection used calibration scores only. Selected values: **48 child tokens, 12 overlap tokens, RRF k=10, dense weight 0.25**. Validation answer-span recall@3 was 1.00, child precision with a fixed three-slot denominator was 0.3333, MRR@3 was 0.95. These settings are not universal recommendations.

Parent/child windows preserve source offsets and section boundaries; selected children retain parent IDs, deduplicated for expansion. Parent text consumption and answer quality are not evaluated here. The generic hierarchy is experimental and is not integrated with active Chroma schema/versioning.

## Reranking and filtering ablations

Cross-encoder scores were calculated on the original queries. Thresholds maximize pair-level F1 using calibration candidates only. All three variants selected a raw threshold of **3.1983037**; this is not a probability. Hybrid candidate lists are capped at 20, with at most three accepted children.

| Validation variant | Answer-span recall | Returned-child precision | Negative rejection |
|---|---:|---:|---:|
| Hybrid + cross-encoder | 0.90 | 0.90 | 5/5 |
| Semantic top-two-section pre-filter + cross-encoder | 0.70 | 0.70 | 5/5 |
| Original + semantic section query expansion + cross-encoder | 0.90 | 0.90 | 5/5 |

Precision averages relevant/returned children over answerable questions; empty results receive zero. This differs from the fixed three-slot denominator of the initial sweep, so the percentages cannot be treated as a like-for-like precision gain. Recall means at least one correct answer-bearing child is retained, not full multi-fact completeness. Negative rejection means no candidate passed the threshold, not a verified generated fallback.

The pre-filter picks the two closest section names before child-vector candidate search. It loses relevant sections and is rejected. Its perfect pair-level calibration F1 hides candidates excluded before reranking; end-to-end retrieval recall exposes this. Query expansion appends the closest semantic section label while preserving the original query and fuses both rankings; it adds no measured benefit here. It is not a generative rewrite model.

## Decision and remaining work

Keep semantic pre-filtering and query expansion disabled pending stronger evidence. Retain reranking as an isolated candidate: it rejects all five validation negatives but misses one of ten answerable questions. No threshold or configuration is approved for the active pipeline. Mandatory tenant/profile authorization filters remain separate from optional semantic filters.

Before promotion: add longer and more diverse documents, multi-fact cases, explicit answer-span annotations and a fresh independent test split; measure a recall-constrained threshold rather than F1 alone; measure expanded-parent precision and token cost; integrate versioned parent storage and token budgets. Faithfulness and Answer Relevance are unmeasured because generation was deliberately excluded.

Reproduce in the existing model runtime with `python calibrate.py`, then `python calibrate_reranker.py` after caching the public cross-encoder. The latter reads the first run's selected configuration from `.local/general-calibration.json`. Raw reports: `.local/general-calibration.json`, `.local/reranker-hybrid-calibration.json`. The completed reranker comparison ran with network disabled after download. Hierarchy/threshold unit tests: 2 passed; compilation and diff whitespace checks passed. No broad test suite was run.
