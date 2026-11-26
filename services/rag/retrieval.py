"""Retrieval orchestration. Ranking, embeddings and vector storage stay in the KB."""
from dataclasses import dataclass
import hashlib
import json
import logging
import math
import re
import time
import uuid

from indexing import CONTRACT, PREPROCESSING, IndexingError, canonical
from preparation import PIPELINE_VERSION, CHUNKING_VERSION, EXTRACTOR_VERSION
from observability import observed, trace_id as current_trace_id

logger = logging.getLogger('rag.retrieval')
MODES = ('dense', 'lexical', 'hybrid')


@dataclass(frozen=True)
class RetrievalScope:
    # Must come from the authorized caller and approved active-snapshot receipt.
    tenant_id: str
    profile_id: str
    generation: int
    profile_version: int
    embedding_model: str
    snapshot: str

    def __post_init__(self):
        if any(not isinstance(v, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', v)
               for v in (self.tenant_id, self.profile_id)):
            raise ValueError('invalid retrieval scope')
        if any(type(v) is not int or v < 1 for v in (self.generation, self.profile_version)):
            raise ValueError('invalid retrieval version')
        if not isinstance(self.embedding_model, str) or not 1 <= len(self.embedding_model) <= 200:
            raise ValueError('invalid embedding model')
        if not isinstance(self.snapshot, str) or not re.fullmatch('[a-f0-9]{64}', self.snapshot):
            raise ValueError('invalid snapshot')


@observed('retrieval')
def retrieve(client, scope, query, *, mode='hybrid', top_k=5):
    if not isinstance(scope, RetrievalScope) or mode not in MODES:
        raise ValueError('invalid retrieval configuration')
    if not isinstance(query, str) or not query.strip() or len(query) > 1000:
        raise ValueError('invalid query')
    if type(top_k) is not int or not 1 <= top_k <= 20:
        raise ValueError('invalid top_k')
    expected = {**scope.__dict__, 'contract_version': CONTRACT, 'preprocessing_version': PREPROCESSING}
    trace_id, started = current_trace_id(), time.monotonic()
    status, rows, counts, code = 'service_unavailable', [], {}, 0
    try:
        code, response = client._request('/v1/query', canonical({**expected, 'query': query,
            'mode': mode, 'top_k': top_k}), response_limit=1_048_576)
        if code in {0, 408, 504}:
            status = 'retrieval_timeout'
        elif code in {404, 409}:
            status = 'profile_unavailable'
        elif code == 200:
            if not isinstance(response, dict) or any(type(response.get(k)) is not type(v) or response.get(k) != v for k, v in expected.items()):
                raise IndexingError('retrieval_scope_mismatch')
            if response.get('mode') != mode or response.get('rrf_k') != (60 if mode == 'hybrid' else None) or (mode == 'hybrid' and type(response.get('rrf_k')) is not int):
                raise IndexingError('ranking_contract_mismatch')
            candidate_counts = response.get('candidate_counts')
            if not isinstance(candidate_counts, dict) or set(candidate_counts) != {'dense', 'lexical'} or any(type(v) is not int or not 0 <= v <= 20 for v in candidate_counts.values()):
                raise IndexingError('invalid_candidate_counts')
            counts = candidate_counts
            candidates = response.get('results')
            if not isinstance(candidates, list) or len(candidates) > top_k:
                raise IndexingError('invalid_results')
            seen = set()
            for row in candidates:
                if not isinstance(row, dict):
                    raise IndexingError('invalid_result')
                text, meta, distance = row.get('text'), row.get('metadata'), row.get('distance')
                if not isinstance(text, str) or not text.strip() or len(text) > 4000 or not isinstance(meta, dict):
                    raise IndexingError('invalid_evidence')
                if any(type(meta.get(k)) is not type(v) or meta.get(k) != v for k, v in expected.items()):
                    raise IndexingError('evidence_scope_mismatch')
                if (meta.get('pipeline_version'), meta.get('chunking_version'), meta.get('extractor_version')) != (
                        PIPELINE_VERSION, CHUNKING_VERSION, EXTRACTOR_VERSION):
                    raise IndexingError('evidence_version_mismatch')
                if not isinstance(meta.get('section'), str) or not 1 <= len(meta['section']) <= 500:
                    raise IndexingError('invalid_section')
                if not isinstance(meta.get('document_id'), str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', meta['document_id']):
                    raise IndexingError('invalid_document')
                if type(meta.get('document_version')) is not int or meta['document_version'] < 1:
                    raise IndexingError('invalid_document_version')
                if any(not isinstance(meta.get(k), str) or not 1 <= len(meta[k]) <= 200 for k in ('source_type', 'source_label')):
                    raise IndexingError('invalid_source')
                if not isinstance(meta.get('source_content_hash'), str) or not re.fullmatch('[a-f0-9]{64}', meta['source_content_hash']):
                    raise IndexingError('invalid_source_hash')
                identity = hashlib.sha256(json.dumps([CHUNKING_VERSION, meta['section'], text], ensure_ascii=False).encode()).hexdigest()
                chunk_id = f"{meta['document_id']}:{identity[:32]}"
                if meta.get('chunk_id') != chunk_id or meta.get('content_hash') != hashlib.sha256(text.encode()).hexdigest():
                    raise IndexingError('evidence_hash_mismatch')
                if chunk_id in seen:
                    raise IndexingError('duplicate_result')
                seen.add(chunk_id)
                if distance is not None and (type(distance) not in (float, int) or not math.isfinite(distance)):
                    raise IndexingError('invalid_distance')
            # Never return partially validated evidence if a later row is invalid.
            rows = candidates
            status = 'retrieved' if rows else 'insufficient_evidence'
    except IndexingError:
        status, rows = 'service_unavailable', []
    elapsed = (time.monotonic() - started) * 1000
    logger.info('trace=%s mode=%s candidates=%r selected=%d status=%s http=%d latency_ms=%.2f',
                trace_id, mode, counts if isinstance(counts, dict) and len(counts) <= 2 else {}, len(rows), status, code, elapsed)
    return {'status': status, 'results': rows, 'trace_id': trace_id, 'mode': mode,
            'generation': scope.generation, 'profile_version': scope.profile_version,
            'latency_ms': elapsed, 'http_status': code,
            'candidate_counts': counts if status in {'retrieved', 'insufficient_evidence'} else {}}
