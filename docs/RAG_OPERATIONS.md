# RAG operations and release gates

Status on 15 November 2026: Phase 5 implementation and local fault checks are in
place. Production acceptance is blocked. `RAG_RELEASE_STATUS.json` is the generated
gate report; it is not a deployment authorization.

## Monitoring and tracing

All preparation/extraction, indexing, retrieval, token-budget, generation and
citation-validation calls have content-free spans. An answer and its child spans
share a trace ID. Exceptions retain only the fixed error category in traces; neither
arguments, return objects nor exception messages are captured. Preparation's parser
child does not inherit credentials or tracing configuration.

`observability.metrics.snapshot()` returns fixed-cardinality counters, cumulative
rates/token totals, and p50/p95/p99 latency over the last 512 samples per stage.
Counters reset on process restart. Alerts include any grounding/citation rejection,
provider/stage failure rates above 5% after 20 requests, overflow above 10%, and
answer p95 above ten seconds. These are initial operational thresholds; an operator
must wire the private snapshot into a monitor to deliver notifications. There is
no public metrics endpoint or installed monitoring service in this batch.

At trusted server startup, explicitly call:

```python
from observability import configure_langsmith_from_env, metrics
exporter = configure_langsmith_from_env()
```

Configuration: `RAG_LANGSMITH_ENABLED=1`, server-side `LANGSMITH_API_KEY`, optional
`LANGSMITH_WORKSPACE_ID`, `LANGSMITH_PROJECT` and `RAG_TRACE_SAMPLE_RATE` (default
0.01, maximum 0.10). Tracing stays disabled otherwise. No LangSmith key is currently
configured, so no successful cloud export is claimed.

The exporter uses an eight-trace non-blocking queue, at most 32 spans per trace,
one background worker, at most 60 runs per minute and three-second socket timeouts.
Sampling is deterministic on the random root trace ID so parent/children agree.
US and EU SaaS hosts are explicitly allowlisted; no arbitrary destination or redirect
is supported. Inputs are always empty; outputs contain only fixed status categories
and approved numeric counts. Versions come from operator configuration, not text.
Failed/dropped/sent counts are available on the exporter. Export errors never change
the answer. Shutdown `close()` waits at most five seconds; pending telemetry can be
lost. This is intentionally best-effort, not a durable audit log. DNS/header waits
remain OS/socket bounded rather than killable-process deadlines.

The trace adapter uses LangSmith's documented REST runs interface and run schema:
[tracing API](https://github.com/langchain-ai/docs/blob/main/src/langsmith/trace-with-api.mdx),
[run schema](https://github.com/langchain-ai/langsmith-sdk/blob/main/python/langsmith/schemas.py).
No LangChain/SDK runtime dependency is introduced. Cloud schema compatibility still
needs the live LangSmith gate before release.

## Evaluation and model comparisons

Retriever metrics remain independent in `RAG_RETRIEVAL_BASELINE.json`.
`fixtures/answers-v1.json` adds ten synthetic generator cases: supported facts,
missing qualifications/salary, contradictory dates, query/source injection and
prompt/credential extraction requests. Gold evidence bypasses retrieval ranking
so generator failures are not confused with retrieval misses. This is a development
fixture, not held-out production evidence.

```text
python services/rag/answer_evaluation.py --live
```

This explicitly sends only synthetic evidence to Gemini. It stops on the first
provider failure and emits no aggregate quality scores for incomplete runs.
The current report `RAG_ANSWER_EVALUATION.json` stopped on the first question after
approximately 90 seconds with `generation_timeout`. No live answer pass is claimed.

With LangSmith credentials, an operator may explicitly call
`exporter.publish_synthetic_answers()`. It uploads only the two bundled synthetic
fixture files, returning dataset/example IDs. Then
`exporter.publish_evaluation(report, examples, session_id)` publishes redacted score
runs and feedback linked to those examples and the chosen project UUID. The project
UUID is required by the current feedback API. These explicit synchronous actions
are intended for offline evaluation, not request threads; they have no automatic
retry. Separate project/session IDs let operators compare prompt/model versions.
No dataset, evaluation or private content has been uploaded during this batch.

## Local load and failure evidence

```text
python -m unittest discover -s services/rag -p "test_*.py"
python services/rag/load_check.py
```

56 RAG tests passed, covering privacy/sampling, queue overflow, exporter outages,
scope/citation/claim validation, timeouts, release-gate rejection and a kill switch.
The offline KB regression suite passed 40 tests; two SDK transport tests were skipped
because that suite mocks Chroma. Ten existing hostile-document parser tests passed.
The two SDK tests were previously run separately in Phase 2, not rerun in this batch.

`RAG_LOAD_DRILL.json` records 131 synthetic requests: two held generation slots,
128 rejected overload requests and one successful recovery request. Peak provider
concurrency was two. It uses test transports and establishes local admission/recovery
behavior only; it is not Gemini throughput, real-server load or production latency
evidence. A production workload/capacity drill remains a release gate.

## Release decision

```text
python services/rag/release.py docs/RAG_RELEASE_EVIDENCE.json docs/RAG_RETRIEVAL_BASELINE.json docs/RAG_ANSWER_EVALUATION.json
```

Exit code 1 means blocked or malformed/missing evidence; 0 means the supplied gates
pass. The current result is blocked. Evidence references are operator attestations,
not cryptographic proof or a substitute for review. Do not mark a gate passed from
mocks, configuration alone, or documentation.

Initial quality gates: MRR@3 and Recall@3 at least 0.90; no regression greater than
0.02 on the same dataset hash; at least 100 held-out retrieval cases and 100 live,
held-out answer cases (including at least 20 abstention cases); answer accuracy at
least 0.90; citation correctness 1.0; unsupported-claim rate 0; abstention accuracy
at least 0.95; answer p95 no more than ten seconds. Answer scores must reproduce
from the per-case outcomes. These are explicit initial release targets, not measured
claims or calibrated guarantees. Review them with the intended workload before release.

Other required gates: live Gemini and LangSmith, isolated parser resource/security
acceptance, clean locked build, persistent HTTP Chroma integration, real load/timeout
drill, runtime rollback exercise, security review and off-host backup/restore.
Earlier same-host backup and disposable embedded-Chroma checks do not close them.
The gate command never authorizes hosting, deploys, or changes service state.

## Stop and rollback procedure

1. Set server-side `RAG_GENERATION_DISABLED=1` and restart/reload the caller's process
   environment. New answer requests return `service_unavailable` before retrieval
   or provider calls. Already-running requests are not cancelled. This behavior is
   unit-tested; no running service has been stopped by this batch.
2. Preserve the failing deployment's code/image digest, model ID, prompt version,
   counts, gate reports and synthetic reproduction. Do not capture private prompts,
   credentials or unrestricted conversations in incident artifacts.
3. Select a previously accepted immutable code/image and explicit model version.
   Restore its matching prompt, schema and context-budget settings together in an
   isolated candidate runtime. Do not silently switch providers or model families.
4. Rerun local contract/failure tests, held-out retrieval/answer evaluations and live
   synthetic checks. Exercise an intentional failure followed by recovery. Recompute
   release gates; keep the stop flag set until reviewed evidence passes.
5. Generator-only rollback must not modify embedding settings or KB data. If source,
   extraction, chunking or embedding contracts change, re-prepare/re-evaluate and
   publish a new, higher generation through normal approval/indexing. Never lower
   generations, erase purge tombstones, edit the active state file, or restore data
   that bypasses the deletion ledger.
6. Record the accepted artifact/version and rollback drill evidence before clearing
   the stop flag. A successful local test does not authorize public hosting.

No immutable runtime rollback has been exercised yet. The current working tree
contains implementation work; it is not being represented as an accepted release.
