# RAG preparation

Implements preparation and batch indexing from `RAG_IMPLEMENTATION.md`. This module
does not approve facts, generate embeddings or change the website.
Only a trusted caller may construct `Scope`; syntactic validation is not authorization.
Raw extracted source content must pass the existing approval workflow before indexing.

```python
from preparation import Scope, prepare, PreparationError

scope = Scope(
    tenant_id="tenant", profile_id="profile", document_id="resume",
    document_version=3, generation=7, source_type="approved-profile",
    source_label="Portfolio", embedding_model="operator-configured-model",
)
result = prepare(source_bytes, "pdf", scope)
```

Supported kinds: `pdf`, `docx`, `html`, `md`, `txt`. Dependencies reuse the pinned
`services/extraction/requirements.txt`; no new runtime packages are required.
Run from the repository root with an installed Python interpreter:

```text
python -m unittest discover -s services/rag -p 'test_*.py'
python services/extraction/test_parse.py
```

The result contains a title, SHA-256 source hash, pipeline version and chunks.
Each chunk contains text plus trusted scope, section, content hash, source hash,
stable chunk ID, extractor/chunking/pipeline versions and embedding model ID.
Chunk IDs depend on document ID, section, normalized text and chunking version.
Retries are deterministic; changing nearby content can change paragraph packing
and therefore chunk IDs. Deduplication removes identical complete chunks within
the same section and document, never evidence across tenants or documents.

Limits: 10 MiB source bytes, 200,000 extracted characters including repeated
section labels, 10,000 blocks, 500 chunks, 4,000 characters per chunk, 500-character
section/title. Blank content fails. Oversized paragraphs/list items split at spaces;
oversized indivisible identifiers fail. No overlap is added. These are initial
safety limits, not evaluated retrieval-quality or model-token limits.

`PreparationError.code` gives bounded errors without document content:
`unsupported_format`, `input_size`, `invalid_timeout`, `extraction_timeout`,
`extractor_unavailable`, `invalid_or_unsafe_document`, `invalid_extraction`,
`unsafe_text`, `invalid_scope`, `invalid_version`, `invalid_metadata`,
`oversized_identifier`, `section_size`, `too_many_chunks`, `empty_document`.
Invalid parser dependencies also fail closed; deployment must verify the runtime
with the format fixture tests before admitting work.

## Isolation and format limits

Extraction uses a fresh temporary working directory, Python isolated mode, an
empty inherited environment, a 15-second killable subprocess timeout and the
existing parser's Python socket block. These are **not an OS security sandbox**.
Before admitting untrusted production documents, run preparation in a dedicated
non-root container with no credentials or host files mounted, read-only root,
bounded temporary storage, process/memory/CPU limits, dropped capabilities and
`--network none`. Validate those limits with hostile-document/load drills.
The local implementation does not claim hard memory isolation, filesystem
isolation or protection from native-library networking. Parser output is logically
bounded; process memory must also be bounded by that container.

DOCX keeps explicit Title/Heading1–6 styles, paragraph order and list boundaries.
PDF keeps page boundaries and available title metadata; it does not infer visual
headings or perform OCR. Interactive/annotated PDFs are conservatively rejected.
HTML uses explicit headings/block/list boundaries and strips common non-content
elements. Markdown supports ATX headings and preserves fenced content; Setext
headings and document-specific boilerplate detection are not yet implemented.
All extracted content remains untrusted evidence, including apparent instructions.

## Phase 2: batch indexing

`indexing.form_batch` accepts the **complete approved document set for a profile
generation**, validates all chunk metadata/hashes and forms one immutable UTF-8 JSON
snapshot. `IndexClient.submit` sends it to the operator-configured private KB endpoint.
The caller is responsible for approval, generation allocation and retaining the exact
batch bytes for durable replay. A restored `Batch(payload)` is revalidated before I/O.
Do not pass a single changed document when other documents should remain active.

```python
from indexing import form_batch, IndexClient

batch = form_batch(
    approved_documents, tenant_id="tenant", profile_id="profile", profile_version=4,
    generation=7, embedding_model=operator_embedding_model, subject="Approved name",
    approved=True,
)
receipt = IndexClient(private_kb_url, scoped_operator_key).submit(batch)
```

The new `rag-chunks-v1` contract uses existing `/v1/index` and `/v1/status` routes
and caller grants (`index` plus `status` permission are required). Chroma's existing
service remains embedding, storage and atomic activation authority. Its original
`approved-profile-v1` request shape and payload digests remain unchanged. The new
contract retains every preparation metadata field, permits 500-character sections,
and validates scope, chunk hashes, document provenance, model and preprocessing
version before storage. No embedding vectors are sent by RAG.

The SHA-256 digest of canonical request bytes is both batch ID and idempotency key;
the KB stores it as `snapshot`. The payload carries all document IDs and versions.
Chunk order is canonical. The current limits are 2,000 chunks (or a lower configured
KB limit) and 1 MiB serialized request bytes. Oversized snapshots fail locally with
`snapshot_too_large`; they are not split into independently activated replacements.
A future larger-profile contract must support staging and one final activation.

Submission checks durable status first. A verified same-generation snapshot returns
success without writing. Stale generations, purge tombstones, conflicting payloads,
scope mismatches and incompatible receipts fail closed. After a timeout or retryable
server failure, status is checked before exact replay. An unavailable status endpoint
prevents further writes. At most three writes are attempted, with bounded backoff
and a final reconciliation check after the last uncertain write. Remaining ambiguity
raises `index_outcome_uncertain`; it does not mean that the write failed. Retry later
using the exact retained payload. Errors do not include server bodies or credentials.

HTTP responses are capped at 16 KiB; redirects and environment proxies are disabled.
The default socket-operation timeout is 65 seconds, above the KB's 60-second request
deadline. This is not an overall job deadline; callers must bound job concurrency and
runtime. Use HTTPS across trust boundaries or an isolated private container network
for HTTP. Provider/API credentials stay in the server-side caller.

Operational logging records batch ID, generation, chunk count, pipeline/model/
preprocessing versions, write count, outcome and elapsed time, never chunk text or
keys. A success receipt verifies snapshot, profile/version/generation, count and model
versions. Physical cleanup may still be pending after a successfully activated
snapshot; the KB's existing exact-replay/reconcile maintenance handles it.

Verification on 15 November 2026: 22 RAG tests and 10 extraction tests passed locally.
Offline KB suite: 37 passed, two SDK tests skipped due to import mocks; both SDK tests
passed separately. The six new HTTP contract tests cover actual FastAPI validation,
scope authorization, metadata/digest preservation, lost responses, failed staging
and legacy replay. `smoke_indexing.py` also passed in the preserved offline KB image
with real Chroma persistence, real bundled embeddings and loopback HTTP: two complete
generations, exact replay, lost-receipt reconciliation and obsolete-snapshot cleanup.
It uses only temporary synthetic profiles, not the running stack. The smoke emitted
existing runtime deprecation and multiprocessing semaphore-cleanup warnings.

## Phase 3: retrieval and evaluation

`retrieval.retrieve(client, scope, query)` defaults to hybrid retrieval. Construct
`RetrievalScope` from the authorized caller and the approved index receipt: tenant,
profile, generation, profile version, embedding model and exact batch/snapshot ID.
Never construct scope from the visitor's query. A stale scope returns
`profile_unavailable`; the caller must re-authorize/reload active scope, not silently
switch generations during a request.

The KB accepts dense, lexical and hybrid modes. Its original BM25/RRF implementation
remains authoritative, with RRF k=60 and at most 20 candidates per ranker. Lexical-only
queries skip embedding/vector search. All paths use the same active-snapshot filter
under the KB lock. Legacy callers retain their dense default and response shape.
Scoped RAG requests require every scope/version field, and receive a versioned
response envelope with candidate counts. Missing/purged profiles and mismatches
fail before retrieval. The client validates the envelope and every chunk's scope,
versions, identity/hash, source provenance and bounded shape; any invalid row
discards the entire response. Duplicate IDs and non-finite distances fail closed.

Retrieval returns `retrieved`, `insufficient_evidence`, `profile_unavailable`,
`retrieval_timeout` or `service_unavailable`, plus a trace ID, latency and counts.
`retrieved` means validated candidate evidence, not that an answer is supported.
Queries are limited to 1,000 characters and K to 1–20; response bodies to 1 MiB.
No reranker, compressor, generation or relevance-threshold abstention is added.
Logs contain bounded operational values, not visitor queries or evidence.

`fixtures/retrieval-v1.json` contains 12 explicitly synthetic documents and 12
independently labeled questions, including exact terms, semantic paraphrases and
multi-document relevance. `evaluation.py` computes macro MRR@K, Recall@K,
Precision@K, graded nDCG@K, duplicate rate and p50/p95/p99 observed request latency.
It aborts on service failures, rather than treating them as quality measurements.
The dataset hash and model/snapshot identify the run. Requests are paced at 0.55s
intervals to respect the existing tenant quota; pacing is excluded from latency.

Run `python smoke_indexing.py --evaluate` from `services/rag` in the existing offline
KB image with network disabled and temporary storage. It exercises real loopback
HTTP, bundled embeddings and a disposable persistent Chroma database. It does not
connect to the running stack or use private profile data. The initial unpaced run
did not complete; only the completed paced run is recorded.

Verified 15 November 2026: 30 RAG tests and 40 KB tests passed. Two SDK transport
tests are skipped in combined KB discovery because that suite mocks Chroma; they
passed separately during Phase 2 and were not rerun for this change. The evaluation
report is [RAG_RETRIEVAL_BASELINE.json](../../docs/RAG_RETRIEVAL_BASELINE.json).

| Mode | MRR@3 | Recall@3 | nDCG@3 | p95 latency (ms) |
| --- | ---: | ---: | ---: | ---: |
| Dense | 1.0000 | 0.9722 | 0.9922 | 30.38 |
| Lexical | 0.8194 | 0.8611 | 0.8230 | 8.48 |
| Hybrid | 1.0000 | 0.9444 | 0.9696 | 41.63 |

Duplicate rate was zero for all modes. Hybrid remains the explicit plan default,
but did not beat dense on this small development fixture. These results do not
establish production quality, answer correctness or production latency. Expand a
held-out evaluation set before tuning or adding reranking/compression. Phase 4
must separately validate context budgets, claims, citations and abstention.

## Phase 4: Gemini generation and token budgets

The default generation model is `gemini-3.5-flash-lite` through the Gemini Developer
API. This replaces the initial Ollama direction; embeddings remain exclusively
under the existing KB model. `gemini.py` uses only Python's standard library and
the fixed HTTPS Google endpoint. No model failover, tools, search, redirects,
or conversation uploads are enabled. Generation permits one bounded retry for
HTTP 429/503 within the existing deadline, respecting numeric Retry-After.

`GEMINI_MODEL` can explicitly override the default. Live evaluation is paced at
12 seconds between cases to reduce observed HTTP 429 failures; this does not
establish production throughput or remove the provider's quota limits.
Run `smoke_indexing.py --full-quality` in a disposable KB runtime to exercise
real HTTP indexing, Chroma retrieval and Gemini generation on synthetic cases.
Unlike `answer_evaluation.py`, this mode indexes the entire synthetic corpus,
including distractors, and does not supply hand-selected context to generation.

```python
from gemini import GeminiClient
from generation import answer, GenerationConfig

response = answer(kb_client, GeminiClient(), authorized_scope, visitor_question,
                  history=[], config=GenerationConfig())
```

Configure `GEMINI_API_KEY` only in the server process, or put just the key in the
Git-ignored `.local/gemini-key.txt`. The module reads that exact file without
printing it. Do not use a browser/public environment variable. Generation sends
selected evidence, the visitor question and optional bounded history to Google;
the upstream application must authorize that use of its data. Provider calls can
incur usage charges. No private profile data is used by the smoke script.

The adapter checks live model capabilities/limits, then uses the model's
`countTokens` API on the complete `generateContentRequest`, including the system
instruction, user question, history, evidence framing and output schema. It does
not estimate tokens by character count or use the embedding tokenizer. Defaults:
8,192-token application context ceiling and 2,048 reserved output tokens. The
ceiling is clamped to the reported model input limit; output capacity is checked
against the reported output limit. Every accepted prompt must satisfy
`counted_input + reserved_output <= context_limit` before generation.

Overflow handling first deduplicates exact text, then removes the lowest-ranked
whole chunks and recounts the exact request. If the base prompt or remaining
evidence cannot fit, it abstains without generating. Compression, summarization,
map-reduce and truncation are not enabled: the evaluation has not established
their quality, and removing factual qualifiers would weaken grounding. Their
absence is explicit rather than hidden behind an approximate budget.

`grounded-excerpts-v1` is deliberately extractive. The model returns JSON claims
with temporary evidence handles and complete, verbatim chunk quotations. The
local validator rejects invented/edited claims, partial quotations, unknown or
duplicate citations, extra output fields and malformed JSON. Citations are mapped
back to original chunk IDs and sections locally. Tenant/profile identifiers,
snapshot IDs, hashes and credentials are never inserted into the provider prompt.
History is untrusted context, never factual evidence or a system-message channel.

This verifies that returned text is supported verbatim by the chosen evidence.
It does not prove the source is true, settle conflicting sources, or independently
prove relevance/completeness. Those judgments remain model-dependent and require
the answer-quality evaluation gate. Arbitrary paraphrasing is intentionally not
accepted. `confidence: medium` is a conservative label, not a calibrated probability.
The caller must render returned evidence as text, not executable HTML.

The response includes status, answer, citations, grounded flag, confidence, profile
version, generation and trace ID. Missing evidence and unsupported claims abstain;
timeouts return `generation_timeout`; authentication/provider/protocol failures
return `service_unavailable`. No failed output is exposed. Partial/truncated model
responses are rejected. Actual prompt, candidate and thinking usage are checked
against the reserved budget; unexplained usage/model-version changes fail closed.
Opaque provider thought signatures are discarded, never displayed or logged.

Limits include two in-flight answers per process, ten retrieved chunks, six history
messages/6,000 total history characters, 1,000 query characters, three claims,
8,000 answer characters, 1 MiB provider requests and 256 KiB provider responses.
The generation stage has a shared 90-second budget across metadata/count/generate
calls, checked between requests and body reads. Socket waits are capped by that
remaining budget; OS DNS resolution is not a hard-killable subprocess. Retrieval
has its separate existing transport timeout. Queueing is rejected rather than
unbounded. No generation retries are made after ambiguous timeouts.

Logs contain trace ID, prompt/model versions, outcome, token counts/utilization,
fallback strategy and latency, not questions, evidence, responses or credentials.
The model ID can be supplied explicitly to `GeminiClient` for a controlled rollback;
there is no automatic switch to a different provider/model.

Run local tests with the existing RAG discovery command. The explicit live check
`python services/rag/smoke_generation.py` uses only synthetic evidence and attempts
an answerable and an unanswerable question. It stops on provider unavailability.
This verifies the generation boundary, not full live website/KB integration.

Verification on 15 November 2026: 45 local RAG tests passed. The saved key
authenticated model metadata and real token-counting requests. The two synthetic
prompts counted 215 and 217 input tokens with 2,048 output tokens reserved within
the 8,192-token ceiling. Live generation did **not** pass: calls returned a temporary
503 or exceeded the 30-second initial and subsequently 90-second bounded timeout.
No successful live answer or output-usage verification is claimed. The adapter
returned empty answers and no citations on every provider failure.

Official API references used for this implementation:
[model](https://aistudio.google.com/docs/models/gemini-3.8-flash),
[token counting](https://aistudio.google.com/api-reference/tokens),
[generation and usage](https://aistudio.google.com/api-reference/generate-content),
[count request schema](https://github.com/googleapis/googleapis/blob/master/google/ai/generativelanguage/v1beta/generative_service.proto).

## Phase 5: operational readiness

Added `observability.py` with fixed-field metrics, nested trace IDs, bounded local
latency windows/alerts and an opt-in sampled LangSmith exporter. Trace inputs are
empty and output fields are explicitly allowlisted. Export runs off the request
thread with queue/rate limits; cloud failures cannot change answers. Explicit
methods publish only bundled synthetic datasets and scored evaluation runs.

`answer_evaluation.py` independently evaluates the generator with gold evidence;
`load_check.py` exercises admission/overload/recovery without paid calls;
`release.py` rejects missing, incomplete, mock-only, regressed or undersized release
evidence. `RAG_GENERATION_DISABLED=1` stops new answer requests before external calls.

Verified locally: 56 RAG tests, 40 KB tests and 10 parser tests passed. The 131-request
synthetic drill passed. The live answer evaluation stopped on the first Gemini
timeout, so no quality scores were generated. LangSmith credentials are absent;
cloud trace/dataset/feedback compatibility is unverified. Release remains blocked.
See [operations and rollback](../../docs/RAG_OPERATIONS.md),
[load drill](../../docs/RAG_LOAD_DRILL.json),
[answer evaluation](../../docs/RAG_ANSWER_EVALUATION.json), and
[release status](../../docs/RAG_RELEASE_STATUS.json).

## Next phases and release gates

1. Finish Phase 1 production isolation drills and evaluate chunk parameters.
2. Phase 2 code and isolated tests are complete for bounded whole-profile batches.
   The running KB stack has not been rebuilt or migrated to the new contract; a clean
   image build and persistent HTTP Chroma deployment verification remain release gates.
3. Phase 3 baseline is implemented and measured. Expand held-out relevance data
   before any production acceptance or relevance optimization; the small fixture
   does not justify a reranker or compressor.
4. Phase 4 code and local tests are implemented for Gemini 3.8 Flash. Live model
   lookup and token counting have succeeded with the saved key; live generation
   acceptance and a broader answer-quality evaluation remain open.
5. Phase 5 code/local fault checks are in place. Complete the failed gates in the
   release status report before claiming production acceptance; local mocks and
   documentation do not satisfy live LangSmith, load, rollback or answer-quality gates.

No running-stack indexing, LangSmith export, website integration or hosting has been
enabled. Indexing verification used a disposable offline store; Gemini generation
checks use only synthetic evidence and explicit server-side credentials.
