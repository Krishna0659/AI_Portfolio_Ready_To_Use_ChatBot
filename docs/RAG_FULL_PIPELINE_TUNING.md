# Full-path tuning status — 19 November 2026

Status: incomplete; no final production configuration approved.

Implemented removal of resume-specific lexical expansion and prompt v3 for general document questions and equivalent wording. Added `smoke_indexing.py --full-quality`: actual HTTP indexing of the entire synthetic corpus with distractors, persistent disposable Chroma, scoped retrieval and live Gemini. The original gold-context evaluator remains available separately. Live evaluations now pause 12 seconds between cases, outside measured request latency.

Verified 62 RAG tests and 42 KB tests (two additional SDK tests skipped). Full-path runs correctly answered payment, image classification, education and leadership cases; the previous vision over-abstention did not reproduce. Missing-information and query-injection cases passed in the first runs. Redacted generation diagnostics identified HTTP 429 at the prompt-leak case; that case passed separately with gold evidence. Thus the earlier blanket diagnosis of endpoint failure was incomplete: provider quota is one confirmed failure cause.

The paced confirmation run still failed: five completed cases passed, then missing-salary returned service_unavailable. The first answer took 53.6 seconds. No aggregate answer-quality score is reported for incomplete runs. Raw reports are `.local/full-quality-v3.json`, `.local/full-quality-v3-confirmation.json`, `.local/full-quality-v3-paced.json`. The last failure's specific provider code was not captured and must not be assumed to be 429.

Current active code still uses v1 preparation (4,000-character cap, paragraph DOCX chunks), hybrid RRF k=60, mandatory scope filters, top-ten context candidates, an 8,192-token context budget with 2,048 output reserve, strict exact-quote citations, explicit insufficiency messages and distinct service failure messages. Semantic pre-filtering, query expansion and calibrated reranking remain experimental. The isolated 48/12-token hierarchy is not yet integrated into active indexing and retrieval; versioned parent storage and token-aware preparation remain required work. Existing data has not been reindexed.

Remaining: integrate and test versioned parent/child storage, prevent embedding truncation on long documents, expand multi-fact and independent evaluation cases, validate calibrated reranking under real retrieval, and complete reliable live generation evaluation with sufficient provider quota. Website integration, deployment and general quality certification are not claimed.
