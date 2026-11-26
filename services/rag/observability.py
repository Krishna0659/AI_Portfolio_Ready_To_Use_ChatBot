"""Content-free metrics and opt-in, sampled LangSmith traces with bounded queues."""
from collections import Counter, deque
from contextvars import ContextVar
from datetime import datetime, timezone
from functools import wraps
import http.client
import json
import math
import os
from pathlib import Path
import queue
import re
import threading
import time
import uuid

STAGES = {'answer', 'retrieval', 'token_budget', 'generation', 'citation_validation',
          'preparation', 'extraction', 'indexing'}
STATUSES = {'ok', 'error', 'answered', 'retrieved', 'indexed', 'insufficient_evidence',
            'profile_unavailable', 'retrieval_timeout', 'generation_timeout', 'service_unavailable'}
NUMBERS = {'input_tokens', 'actual_input_tokens', 'actual_output_tokens', 'selected_chunks',
           'reserved_output_tokens', 'context_limit', 'input_budget_utilization', 'output_budget_utilization'}
FLAGS = {'overflow', 'unsupported_claim', 'citation_rejected', 'provider_failure', 'overloaded'}
_active = ContextVar('rag_span', default=None)
_exporter = None


class Metrics:
    def __init__(self):
        self.lock = threading.Lock()
        self.counts = Counter()
        self.samples = {stage: deque(maxlen=512) for stage in STAGES}
        self.tokens = Counter()

    def record(self, stage, status, elapsed, numbers=None, flags=()):
        if stage not in STAGES or status not in STATUSES or not math.isfinite(elapsed) or elapsed < 0:
            raise ValueError('invalid metric')
        with self.lock:
            self.counts[f'{stage}.{status}'] += 1
            self.samples[stage].append(elapsed)
            for key in set(flags) & FLAGS:
                self.counts[key] += 1
            for key, value in (numbers or {}).items():
                if key in NUMBERS and type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1e9:
                    self.tokens[key] += value

    def snapshot(self):
        with self.lock:
            latency = {}
            for stage, values in self.samples.items():
                ordered = sorted(values)
                if ordered:
                    latency[stage] = {f'p{p}_ms': ordered[min(len(ordered)-1, math.ceil(len(ordered)*p/100)-1)]
                                      for p in (50, 95, 99)}
            counts = dict(self.counts)
            requests = sum(v for k, v in counts.items() if k.startswith('answer.'))
            rates = {key: counts.get(key, 0)/max(1, requests) for key in FLAGS}
            rates['abstention'] = counts.get('answer.insufficient_evidence', 0)/max(1, requests)
            alerts = []
            if counts.get('unsupported_claim') or counts.get('citation_rejected'):
                alerts.append('grounding_validation_rejected_output')
            if requests >= 20 and rates['provider_failure'] > .05:
                alerts.append('provider_failure_rate_high')
            if requests >= 20 and rates['overflow'] > .10:
                alerts.append('context_overflow_rate_high')
            if latency.get('answer', {}).get('p95_ms', 0) > 10000:
                alerts.append('answer_p95_over_10_seconds')
            for stage in ('preparation','extraction','indexing','retrieval'):
                total = sum(v for k,v in counts.items() if k.startswith(stage+'.'))
                failed = sum(counts.get(stage+'.'+s,0) for s in ('error','service_unavailable','retrieval_timeout'))
                if total >= 20 and failed/total > .05:
                    alerts.append(stage+'_failure_rate_high')
            return {'counts': counts, 'rates': rates, 'latency': latency, 'token_totals': dict(self.tokens),
                    'alerts': alerts, 'latency_window_per_stage': 512}


metrics = Metrics()


def trace_id():
    current = _active.get()
    return current['trace_id'] if current else uuid.uuid4().hex


def annotate(stats=None, **flags):
    current = _active.get()
    if current:
        current['numbers'].update({k: v for k, v in (stats or {}).items()
            if k in NUMBERS and type(v) in (int, float) and math.isfinite(v) and 0 <= v <= 1e9})
        current['flags'].update(k for k, value in flags.items() if k in FLAGS and value is True)


def annotate_versions(model, prompt):
    current = _active.get()
    if current and re.fullmatch(r'gemini-[A-Za-z0-9.-]{1,100}', model) and re.fullmatch(r'[a-z0-9-]{1,80}', prompt):
        current['versions'] = {'model': model, 'prompt': prompt}


def observed(stage):
    if stage not in STAGES:
        raise ValueError('unknown stage')
    def decorate(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            parent = _active.get()
            identifier = uuid.uuid4().hex
            span = {'id': identifier, 'trace_id': parent['trace_id'] if parent else identifier,
                    'parent_run_id': parent['id'] if parent else None, 'stage': stage,
                    'start_time': datetime.now(timezone.utc).isoformat(), 'numbers': {}, 'flags': set(),
                    'events': parent['events'] if parent else [], 'versions': {}}
            token = _active.set(span)
            started, status = time.monotonic(), 'error'
            try:
                result = fn(*args, **kwargs)
                raw = result.get('status') if isinstance(result, dict) else None
                status = raw if isinstance(raw, str) and raw in STATUSES else 'ok'
                return result
            finally:
                elapsed = (time.monotonic()-started)*1000
                metrics.record(stage, status, elapsed, span['numbers'], span['flags'])
                event = {k: span[k] for k in ('id', 'trace_id', 'parent_run_id', 'stage', 'start_time')}
                event.update(end_time=datetime.now(timezone.utc).isoformat(), status=status,
                             duration_ms=elapsed, numbers=span['numbers'], flags=sorted(span['flags']), versions=span['versions'])
                if len(span['events']) < 32:
                    span['events'].append(event)
                _active.reset(token)
                if parent is None and _exporter is not None:
                    # No network I/O on request threads. Export failures never change answers.
                    try:
                        _exporter.submit(span['events'])
                    except Exception:
                        pass
        return wrapper
    return decorate


class LangSmith:
    def __init__(self, key, *, project='portfolioai-rag', sample_rate=.01, host='api.smith.langchain.com', workspace=None):
        if not isinstance(key, str) or not re.fullmatch(r'[\x21-\x7e]{1,512}', key):
            raise ValueError('invalid tracing credentials')
        if host not in {'api.smith.langchain.com', 'eu.api.smith.langchain.com'}:
            raise ValueError('unsupported tracing region')
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', project) or type(sample_rate) not in (int,float) or not 0 <= sample_rate <= .1:
            raise ValueError('invalid tracing limits')
        if workspace is not None:
            workspace = str(uuid.UUID(workspace))
        self.key, self.host, self.project, self.workspace = key, host, project, workspace
        self.sample_rate = sample_rate
        self.queue = queue.Queue(maxsize=8)
        self.sent = self.failed = self.dropped = 0
        self.closed = False
        self.thread = threading.Thread(target=self._worker, name='rag-traces', daemon=True)
        self.thread.start()

    def _post(self, path, payload):
        body = json.dumps(payload).encode()
        if len(body) > 262144:
            raise ValueError('trace payload too large')
        connection = http.client.HTTPSConnection(self.host, timeout=3)
        headers = {'x-api-key': self.key, 'Content-Type': 'application/json'}
        if self.workspace:
            headers['x-tenant-id'] = self.workspace
        try:
            connection.request('POST', path, body=body, headers=headers)
            response = connection.getresponse()
            if not 200 <= response.status < 300:
                raise RuntimeError('trace export rejected')
            raw = response.read(16385)
            if len(raw) > 16384:
                raise ValueError('trace response too large')
            return json.loads(raw) if raw else {}
        finally:
            connection.close()

    def submit(self, events):
        if self.closed or not events:
            return
        if int(events[0]['trace_id'], 16) / (1 << 128) >= self.sample_rate:
            return
        # Reconstruct the wire schema from allowed values. No generic input/output capture.
        runs = []
        for event in sorted(events, key=lambda e:e['start_time'])[:32]:
            if event['stage'] not in STAGES or event['status'] not in STATUSES:
                raise ValueError('unsafe trace category')
            numbers = {k:v for k,v in event['numbers'].items() if k in NUMBERS and type(v) in (int,float)
                       and math.isfinite(v) and 0 <= v <= 1e9}
            run = {'id': str(uuid.UUID(event['id'])), 'trace_id': str(uuid.UUID(event['trace_id'])),
                   'name': 'rag.'+event['stage'], 'run_type': 'chain', 'session_name': self.project,
                   'start_time': datetime.fromisoformat(event['start_time']).isoformat(),
                   'end_time': datetime.fromisoformat(event['end_time']).isoformat(),
                   'inputs': {}, 'outputs': {'status': event['status'], **numbers},
                   'extra': {'metadata': {'privacy': 'operational-only-v1',
                             'flags': sorted(set(event['flags']) & FLAGS)}}}
            for key, pattern in [('model', r'gemini-[A-Za-z0-9.-]{1,100}'), ('prompt', r'[a-z0-9-]{1,80}')]:
                value = event.get('versions', {}).get(key)
                if isinstance(value, str) and re.fullmatch(pattern, value):
                    run['extra']['metadata'][key] = value
            if event['parent_run_id']:
                run['parent_run_id'] = str(uuid.UUID(event['parent_run_id']))
            if event['status'] in {'error','service_unavailable','generation_timeout','retrieval_timeout'}:
                run['error'] = event['status']
            runs.append(run)
        try:
            self.queue.put_nowait(runs)
        except queue.Full:
            self.dropped += 1

    def _worker(self):
        window, allowance = time.monotonic(), 60
        while not self.closed or not self.queue.empty():
            try:
                runs = self.queue.get(timeout=.1)
            except queue.Empty:
                continue
            try:
                if time.monotonic()-window >= 60:
                    window, allowance = time.monotonic(), 60
                if len(runs) > allowance:
                    self.dropped += 1
                    continue
                allowance -= len(runs)
                for run in runs:
                    self._post('/runs', run)
                    self.sent += 1
            except Exception:
                self.failed += 1
            finally:
                self.queue.task_done()

    def close(self, timeout=2):
        self.closed = True
        self.thread.join(timeout=min(max(timeout, 0), 5))

    def publish_synthetic_answers(self):
        """Explicit operator action: only the bundled synthetic fixture can be uploaded."""
        root = Path(__file__).with_name('fixtures')
        dataset = json.loads((root/'answers-v1.json').read_text())
        corpus = json.loads((root/'retrieval-v1.json').read_text())
        if dataset['data_classification'] != 'synthetic' or corpus['data_classification'] != 'synthetic':
            raise ValueError('synthetic fixture required')
        created = self._post('/datasets', {'name':dataset['version']+'-'+uuid.uuid4().hex[:8], 'data_type':'kv',
                            'description':'Synthetic PortfolioAI generator evaluation; no private content.'})
        dataset_id = str(uuid.UUID(created['id']))
        examples = {}
        for case in dataset['cases']:
            evidence = [d for d in corpus['documents'] if d['id'] in case['documents']] + case.get('extra_evidence', [])
            example = self._post('/examples', {'dataset_id':dataset_id,
                'inputs':{'question':case['question'], 'evidence':evidence},
                'outputs':{'status':case['expected_status'], 'required_documents':case['required_documents']},
                'metadata':{'case_id':case['id'], 'classification':'synthetic'}})
            examples[case['id']] = str(uuid.UUID(example['id']))
        return {'dataset_id':dataset_id, 'examples':examples}

    def publish_evaluation(self, report, examples, session_id):
        """Publish only scores/labels and link to explicitly uploaded synthetic examples."""
        expected = json.loads(Path(__file__).with_name('fixtures').joinpath('answers-v1.json').read_text())
        if report.get('dataset_version') != expected['version'] or len(report['cases']) > 100:
            raise ValueError('unsupported evaluation dataset')
        session_id = str(uuid.UUID(session_id))
        for case in report['cases']:
            example_id = str(uuid.UUID(examples[case['case_id']]))
            status = case['status']
            if status not in STATUSES:
                raise ValueError('invalid evaluation status')
            scores = {key:case[key] for key in ('correct_status','correct_citations','supported') if type(case.get(key)) is bool}
            now = datetime.now(timezone.utc).isoformat()
            metadata = {'evaluation':'synthetic-answers-v1'}
            for key, pattern in [('model',r'gemini-[A-Za-z0-9.-]{1,100}'), ('prompt_version',r'[a-z0-9-]{1,80}')]:
                value = report.get(key)
                if isinstance(value,str) and re.fullmatch(pattern,value):
                    metadata[key] = value
            run_id = str(uuid.uuid4())
            self._post('/runs', {'id':run_id, 'name':'rag.answer-evaluation', 'run_type':'chain',
                'session_id':session_id, 'reference_example_id':example_id, 'start_time':now, 'end_time':now,
                'inputs':{}, 'outputs':{'status':status, **scores}, 'extra':{'metadata':metadata}})
            for criterion, score in scores.items():
                self._post('/api/v1/feedback', {'run_id':run_id, 'session_id':session_id,
                    'key':criterion, 'score':int(score), 'feedback_source':{'type':'api'}})


def configure_langsmith_from_env():
    global _exporter
    if os.getenv('RAG_LANGSMITH_ENABLED') != '1':
        return None
    if _exporter is None:
        _exporter = LangSmith(os.environ.get('LANGSMITH_API_KEY', ''),
            project=os.getenv('LANGSMITH_PROJECT', 'portfolioai-rag'),
            sample_rate=float(os.getenv('RAG_TRACE_SAMPLE_RATE', '.01')),
            workspace=os.getenv('LANGSMITH_WORKSPACE_ID'))
    return _exporter
