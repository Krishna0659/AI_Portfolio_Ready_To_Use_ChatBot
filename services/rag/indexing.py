"""Bounded whole-profile batches over the KB's atomic snapshot/status contract."""
from dataclasses import dataclass
import hashlib
from http.client import HTTPException
import json
import logging
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from preparation import Scope, PIPELINE_VERSION, CHUNKING_VERSION, EXTRACTOR_VERSION
from observability import observed

CONTRACT = 'rag-chunks-v1'
PREPROCESSING = 'parent-retrieval-v3'
MAX_PAYLOAD = 1_048_576
MAX_RESPONSE = 16_384
logger = logging.getLogger('rag.indexing')


class IndexingError(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def canonical(value):
    # Must match KB model_dump serialization, including all default fields.
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


@dataclass(frozen=True)
class Batch:
    payload: bytes

    @property
    def batch_id(self):
        return hashlib.sha256(self.payload).hexdigest()


def form_batch(documents, *, tenant_id, profile_id, profile_version, generation,
               embedding_model, subject='', approved=False):
    """Caller must supply ALL approved documents in this profile generation.

    The approval flag is a fail-closed caller assertion, not an authorization system.
    The KB separately enforces caller grants; the website remains approval authority.
    """
    if approved is not True:
        raise IndexingError('approval_required')
    if type(profile_version) is not int or profile_version < 1:
        raise IndexingError('invalid_profile_version')
    if not isinstance(subject, str) or len(subject) > 120:
        raise IndexingError('invalid_subject')
    if not isinstance(documents, list) or not 1 <= len(documents) <= 500:
        raise IndexingError('invalid_documents')
    chunks, seen, document_ids = [], set(), set()
    for document in documents:
        if not isinstance(document, dict) or document.get('pipeline_version') != PIPELINE_VERSION:
            raise IndexingError('pipeline_mismatch')
        source_hash = document.get('source_content_hash')
        rows = document.get('chunks')
        if not isinstance(rows, list) or not 1 <= len(rows) <= 500:
            raise IndexingError('invalid_chunks')
        provenance = None
        for chunk in rows:
            if not isinstance(chunk, dict) or set(chunk) != {'text', 'metadata'}:
                raise IndexingError('invalid_chunk')
            text, meta = chunk['text'], chunk['metadata']
            if not isinstance(text, str) or not text.strip() or len(text) > 4000 or not isinstance(meta, dict):
                raise IndexingError('invalid_chunk')
            required = set(Scope.__dataclass_fields__) | {'chunk_id', 'section', 'content_hash',
                'source_content_hash', 'pipeline_version', 'chunking_version', 'extractor_version'}
            if set(meta) != required:
                raise IndexingError('invalid_metadata')
            Scope(**{k: meta[k] for k in Scope.__dataclass_fields__})
            if (meta['tenant_id'], meta['profile_id'], meta['generation'], meta['embedding_model']) != (
                    tenant_id, profile_id, generation, embedding_model) or type(generation) is not int:
                raise IndexingError('scope_model_mismatch')
            if (meta['pipeline_version'], meta['chunking_version'], meta['extractor_version']) != (
                    PIPELINE_VERSION, CHUNKING_VERSION, EXTRACTOR_VERSION):
                raise IndexingError('pipeline_mismatch')
            if not isinstance(meta['section'], str) or not 1 <= len(meta['section']) <= 500:
                raise IndexingError('invalid_section')
            if not isinstance(source_hash, str) or not re.fullmatch('[a-f0-9]{64}', source_hash) or meta['source_content_hash'] != source_hash:
                raise IndexingError('source_hash_mismatch')
            identity = hashlib.sha256(json.dumps([CHUNKING_VERSION, meta['section'], text], ensure_ascii=False).encode()).hexdigest()
            if meta['content_hash'] != hashlib.sha256(text.encode()).hexdigest() or meta['chunk_id'] != f"{meta['document_id']}:{identity[:32]}":
                raise IndexingError('chunk_hash_mismatch')
            current = tuple(meta[k] for k in ('document_id', 'document_version', 'source_type', 'source_label'))
            if provenance is not None and current != provenance:
                raise IndexingError('document_provenance_mismatch')
            provenance = current
            if meta['chunk_id'] in seen:
                raise IndexingError('duplicate_chunk')
            seen.add(meta['chunk_id'])
            chunks.append(chunk)
            if len(chunks) > 2000:
                raise IndexingError('chunk_limit')
        if provenance[0] in document_ids:
            raise IndexingError('duplicate_document')
        document_ids.add(provenance[0])
    payload = canonical(dict(subject=subject, operation='index', tenant_id=tenant_id,
        profile_id=profile_id, profile_version=profile_version, generation=generation,
        contract_version=CONTRACT, embedding_model=embedding_model,
        preprocessing_version=PREPROCESSING,
        chunks=sorted(chunks, key=lambda c: c['metadata']['chunk_id'])))
    # Never split a profile replacement into independently activated requests.
    if len(payload) > MAX_PAYLOAD:
        raise IndexingError('snapshot_too_large')
    return Batch(payload)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise IndexingError('redirect_rejected')


class IndexClient:
    def __init__(self, base_url, api_key, *, timeout=65, attempts=3):
        url = urlsplit(base_url)
        if url.scheme not in {'http', 'https'} or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in {'', '/'}:
            raise IndexingError('invalid_endpoint')
        if not isinstance(api_key, str) or not api_key or any(ord(c) < 33 or ord(c) > 126 for c in api_key):
            raise IndexingError('invalid_credentials')
        if type(attempts) is not int or not 1 <= attempts <= 3 or not 0 < timeout <= 65:
            raise IndexingError('invalid_retry_limits')
        self.base_url, self.api_key = base_url.rstrip('/'), api_key
        self.timeout, self.attempts = timeout, attempts
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def _request(self, path, payload=None, *, response_limit=MAX_RESPONSE):
        if type(response_limit) is not int or not 1 <= response_limit <= MAX_PAYLOAD:
            raise IndexingError('invalid_response_limit')
        request = Request(self.base_url + path, data=payload, headers={
            'X-KB-API-Key': self.api_key, 'Content-Type': 'application/json'})
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                raw = response.read(response_limit + 1)
                if len(raw) > response_limit:
                    raise IndexingError('invalid_response')
                value = json.loads(raw)
                if not isinstance(value, dict):
                    raise IndexingError('invalid_response')
                return response.status, value
        except HTTPError as exc:
            exc.close()
            return exc.code, {}
        except (URLError, TimeoutError, OSError, HTTPException):
            return 0, {}
        except (ValueError, UnicodeError) as exc:
            raise IndexingError('invalid_response') from exc

    @observed('indexing')
    def submit(self, batch):
        if not isinstance(batch, Batch) or not isinstance(batch.payload, bytes) or len(batch.payload) > MAX_PAYLOAD:
            raise IndexingError('invalid_batch')
        # Revalidate restored outbox bytes before any network request.
        try:
            request = json.loads(batch.payload)
            documents = {}
            for chunk in request['chunks']:
                meta = chunk['metadata']
                doc = documents.setdefault(meta['document_id'], dict(pipeline_version=meta['pipeline_version'],
                    source_content_hash=meta['source_content_hash'], chunks=[]))
                doc['chunks'].append(chunk)
            rebuilt = form_batch(list(documents.values()), **{k: request[k] for k in (
                'tenant_id', 'profile_id', 'profile_version', 'generation', 'embedding_model', 'subject')}, approved=True)
            if rebuilt.payload != batch.payload:
                raise IndexingError('invalid_batch')
        except (KeyError, TypeError, ValueError) as exc:
            raise IndexingError('invalid_batch') from exc
        started = time.monotonic()
        outcome, writes = 'uncertain', 0
        status_path = '/v1/status?' + urlencode({k: request[k] for k in ('tenant_id', 'profile_id')})

        def inspect(value, status_response=False):
            if value.get('profile_id') != request['profile_id'] or (status_response and value.get('tenant_id') != request['tenant_id']):
                raise IndexingError('response_scope_mismatch')
            generation = value.get('generation')
            if type(generation) is not int:
                raise IndexingError('invalid_response')
            pending = value.get('pending', {})
            if not isinstance(pending, dict):
                raise IndexingError('invalid_response')
            pg = pending.get('generation', 0)
            if type(pg) is not int:
                raise IndexingError('invalid_response')
            if generation > request['generation'] or pg > request['generation']:
                raise IndexingError('superseded')
            if pg == request['generation'] and pending.get('snapshot') != batch.batch_id:
                raise IndexingError('generation_conflict')
            if generation == request['generation']:
                if type(value.get('count')) is not int or not len(request['chunks']) <= value['count'] <= 2000:
                    raise IndexingError('invalid_child_count')
                if value.get('purged') or value.get('snapshot') != batch.batch_id:
                    raise IndexingError('generation_conflict')
                expected = dict(profile_version=request['profile_version'], parent_count=len(request['chunks']),
                    embedding_model=request['embedding_model'], preprocessing_version=PREPROCESSING,
                    contract_version=CONTRACT, pipeline_version=PIPELINE_VERSION)
                if any(type(value.get(k)) is not type(v) or value.get(k) != v for k, v in expected.items()):
                    raise IndexingError('receipt_mismatch')
                return True
            return False

        try:
            # Status first also makes restart recovery safe for a persisted exact batch.
            for attempt in range(self.attempts):
                code, state = self._request(status_path)
                if code == 200:
                    if state.get('status') != 'ok':
                        raise IndexingError('invalid_response')
                    if inspect(state, True):
                        outcome = 'indexed'
                        return {'status': outcome, 'batch_id': batch.batch_id, 'generation': request['generation'],
                                'count': len(request['chunks']), 'writes': writes, 'reconciled': True}
                elif code != 404:
                    if code not in {0, 408, 429, 500, 502, 503, 504}:
                        raise IndexingError('status_rejected')
                    # No replay while durable status is unavailable.
                    if attempt + 1 < self.attempts:
                        time.sleep(min(2 ** attempt, 4))
                    continue
                writes += 1
                code, receipt = self._request('/v1/index', batch.payload)
                if code == 200:
                    if receipt.get('status') != 'indexed' or not inspect(receipt):
                        raise IndexingError('invalid_receipt')
                    outcome = 'indexed'
                    return {'status': outcome, 'batch_id': batch.batch_id, 'generation': request['generation'],
                            'count': len(request['chunks']), 'writes': writes, 'reconciled': False}
                if code not in {0, 408, 429, 500, 502, 503, 504}:
                    raise IndexingError('generation_conflict' if code == 409 else 'index_rejected')
                if attempt + 1 < self.attempts:
                    time.sleep(min(2 ** attempt, 4))
            # Even the last write timeout needs a status check, never a claimed failure.
            code, state = self._request(status_path)
            if code == 200 and state.get('status') == 'ok' and inspect(state, True):
                outcome = 'indexed'
                return {'status': outcome, 'batch_id': batch.batch_id, 'generation': request['generation'],
                        'count': len(request['chunks']), 'writes': writes, 'reconciled': True}
            raise IndexingError('index_outcome_uncertain')
        except IndexingError as exc:
            outcome = exc.code
            raise
        finally:
            logger.info('batch=%s generation=%d chunks=%d pipeline=%s model=%r preprocessing=%s writes=%d outcome=%s latency_ms=%d',
                batch.batch_id, request['generation'], len(request['chunks']), PIPELINE_VERSION,
                request['embedding_model'], PREPROCESSING, writes, outcome, int((time.monotonic() - started) * 1000))
