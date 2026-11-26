# RAG quality review — 15 November 2026

**Verdict: embedding storage is sound in the isolated test; retrieval needs improvement; live answer quality is unverified.** No running index or website was changed.

## Missing-information fallback follow-up

The pipeline now returns **“I don't have enough information in my knowledge base to answer that.”** for `insufficient_evidence`, with no citations and `grounded=false`. This covers empty retrieval, explicit model abstention, budget abstention and rejected unsupported claims. A provider/retrieval outage, missing profile, overload or disabled generation instead returns **“I couldn't check my knowledge base right now. Please try again shortly.”** Service failure is not evidence that a fact is absent.

Prompt v2 explicitly distinguishes third- and fourth-semester GPA and requires complete role coverage. This is an instruction, not proof of model compliance. The independent evaluator now scores an answer correct only when status, complete required citations and quote support all pass; a regression test verifies that quoting only one of two roles earns zero answer accuracy.

Added five synthetic quality cases: semester mismatch (abstain), correct semester (answer), missing salary (abstain), both leadership roles (answer), and unsupported Nobel Prize premise (abstain). Live execution stopped on the first case with `service_unavailable` after 4.47 seconds. **0 of 5 cases obtained a usable model answer; no semantic-quality percentage is reported.** A separate minimal generation request also timed out after 30.19 seconds, establishing that the failure is not confined to the RAG prompt. See `RAG_FALLBACK_EVALUATION.json` for the real-provider result.

The expanded local RAG suite passes **60 tests**, including fallback rendering, no provider call on empty retrieval, model abstention, rejected citations, separate timeout messaging, overload/recovery and strict answer scoring. Deterministic provider fixtures verify control flow only. Full live semantic quality remains blocked by generation availability; website integration remains outside this change.

## Gemini endpoint repair

The supplied key was already present in the ignored local key file; it was not printed or committed. Model discovery showed `gemini-3.8-flash`, but a minimal `generateContent` request hung for 35 seconds. `gemini-3-flash-preview` responded in 1.3 seconds on the same endpoint and key. The default is now `gemini-3-flash-preview`, with `GEMINI_MODEL` available for an explicit override.

The five-case live fallback suite now completes with **100% answer accuracy, 100% citation correctness, 0% unsupported claims, 100% abstention accuracy**, and 3.29-second p95 latency on synthetic evidence. The ten-case suite no longer times out, but remains incomplete: one supported vision case over-abstained and one prompt-leak case hit a transient service failure. Therefore endpoint availability is repaired; full RAG quality certification is still open.

## Retrieval measured separately

The supplied resume went through the real preparation code, HTTP index endpoint, bundled embedding model, disposable persistent Chroma collection and HTTP retrieval endpoint. This replaces the earlier lexical-only experiment. Six development questions comprise the user's three questions and three paraphrases. Relevance labels require the CGPA chunk, DSA count chunk, or both leadership title chunks. These are known examples, not held-out evaluation.

| Mode | MRR@3 | Recall@3 | Precision@3 | nDCG@3 |
|---|---:|---:|---:|---:|
| Dense | 0.8333 | 0.8333 | 0.3333 | 0.7718 |
| Keyword/BM25 | 0.6667 | 0.7500 | 0.3333 | 0.6696 |
| Hybrid | 0.8333 | 0.9167 | 0.3889 | 0.8229 |

MRR measures first relevant rank; recall measures required evidence coverage; precision counts relevant chunks among three returned slots; nDCG measures ranking quality. With only one relevant chunk, Precision@3 cannot exceed 1/3. Low precision here also exposes irrelevant filler; it does not justify returning more chunks.

For the exact original questions, hybrid retrieves the CGPA evidence first, DSA count first, and leadership titles at ranks 1 and 3. The name-only chunk occupies rank 2 for all three. A leadership paraphrase retrieves Placement Coordinator but misses Operational Head (50% required-role recall).

Q1 labels the fourth-semester chunk as relevant **counterevidence**, not as an answer to the third-semester question. Retrieval success must not be counted as answer success.

Expected answers, manually checked against the resume (not generated model outputs):

- Q1: Third-semester CGPA is not provided. The resume states **8.41 through the fourth semester** only.
- Q2: **365+ DSA problems**.
- Q3: **Operational Head, Robogenesis**, October 2025–present; **Placement Coordinator, Placement Career Services Centre**, August 2026–present, both at Bennett University.

## Embedding integrity and semantic quality

All 37 stored embeddings have 384 dimensions, finite values and norms within 0.00000012 of 1. Regenerating the exact indexed inputs produces maximum absolute difference **0.0**, minimum cosine similarity approximately **1.0**. Largest input is 51 tokens against the bundled model's 256-token limit: **zero truncated resume chunks**.

This verifies storage/reproducibility, not universal semantic understanding. Dense-only Recall@3 of 0.8333 is the separate semantic retrieval measurement. No alternative embedding model was benchmarked. The existing running database was not audited or migrated.

## Pipeline findings, in priority order

1. **Live generation unavailable:** the current real Gemini evaluation timed out on its first synthetic question after 90.06 seconds. Zero successful answers were evaluated; accuracy, citation correctness and abstention quality are **unavailable**, not zero or 100%. The full retrieval-to-live-answer path cannot be certified.
2. **Metadata incorrectly labels introductory content:** preparation assigns blocks without a heading the document title, which is inferred from the first section heading. Consequently the name and summary are labelled EDUCATION. This pollutes retrieval and embeddings.
3. **Paragraph splitting loses relationships:** titles and achievements become separate chunks. A role query can retrieve placement activities without all role titles. Use coherent role/project units, with their heading and dates retained, and benchmark before selecting a replacement.
4. **Ranking is sensitive to wording:** the existing hardcoded expansion adds operational/head/coordinator/placement terms even to generic “roles” questions. It improves this known wording but is not a general solution. Evaluate unrelated role questions and paraphrases before retaining it. The name-only chunk repeatedly consumes a top-three slot.
5. **Citation validation is not relevance validation:** exact quotes can still answer the wrong semester or omit a required role. The prompt requests abstention, but local validation only establishes quote membership and structural correctness. Temporal constraints, missing evidence and completeness need live negative-case evaluation.
6. **General token-limit risk remains:** preparation permits 4,000 characters per chunk while this model accepts 256 tokens. This resume is safe, but longer documents can silently lose their tails during embedding. Token-aware splitting/validation must be measured on longer evidence.
7. **Version labels did not change with the prior DOCX behavior change:** extraction/chunking still use v1 identifiers. Future fixes need coordinated version handling and deliberate reindexing, not silently mixing old and new preparation behavior.

## Verification and reproducibility

The new `services/rag/quality_check.py` runs with `smoke_indexing.py --resume-quality` in the existing offline KB image. It consumes the normal extractor's prepared private input from `.local/resume-quality-input.json`; the output is `.local/resume-quality-report.json`, including ranked evidence. Both private artifacts remain ignored by Git. This mode also runs the existing two-generation indexing/replay/lost-receipt checks first.

Current RAG tests: **57 passed**. Current KB discovery: **41 passed, 2 skipped** (43 total; SDK checks skipped in that discovery setup). These establish contracts and failure handling, not semantic answer quality. Provider test uses synthetic evidence only; the resume was not sent to Gemini.

The separate 12-question synthetic benchmark reproduced dense MRR/Recall@3 **1.0000/0.9722**, lexical **0.8194/0.8611**, hybrid **1.0000/0.9444**. Thus hybrid performs better on this resume set but does not uniformly beat dense. Current container p95 retrieval latency was dense 1,387 ms, lexical 14 ms, hybrid 2,266 ms; resource-constrained concurrent local runs are not production latency measurements. The smoke run emitted an existing multiprocessing semaphore-cleanup warning.

Prioritize metadata and coherent chunk boundaries, then compare dense/hybrid ranking and candidate filtering on broader independent cases. Resolve provider availability and run real answer tests with semester mismatch, missing facts, multi-role completeness and irrelevant evidence before accepting the pipeline. Do not increase top-k to conceal missing precision.
