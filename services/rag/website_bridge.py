"""Private stdin/stdout bridge. The authenticated website supplies approval and scope."""
from dataclasses import asdict
import json
import os
from pathlib import Path
import sys

from preparation import Scope, normalize, split_block, digest, PIPELINE_VERSION, CHUNKING_VERSION, EXTRACTOR_VERSION
from indexing import IndexClient, form_batch, canonical
from retrieval import RetrievalScope
from generation import answer
from gemini import GeminiClient, ProviderError

PROFILE = 'approved-profile'
MODEL = 'sentence-transformers/all-MiniLM-L6-v2'


class WebsiteGemini(GeminiClient):
    last_error = None

    def _request(self, action, payload, deadline):
        try:
            return super()._request(action, payload, deadline)
        except ProviderError as exc:
            self.last_error = exc.code
            raise


def approved_document(job):
    profile = job['content']
    scope = Scope(job['tenant_id'], PROFILE, job['version_id'], job['profile_version'],
                  job['generation'], 'approved_profile', 'Approved profile', MODEL)
    source_hash = digest(canonical(profile))
    chunks, seen = [], set()
    blocks = [('Profile', '\n\n'.join(filter(None, [profile['displayName'], profile['headline']])))]
    blocks += [(section['title'], '\n\n'.join(fact['text'] for fact in section['facts']))
               for section in profile['sections']]
    for section, text in blocks:
        section = normalize(section)
        # Preserve paragraph boundaries and only split parents that exceed admission limits.
        pending = ''
        parts = []
        for paragraph in normalize(text).split('\n\n'):
            for part in split_block(paragraph, 4000):
                if pending and len(pending) + len(part) + 2 > 4000:
                    parts.append(pending)
                    pending = ''
                pending = pending + '\n\n' + part if pending else part
        if pending:
            parts.append(pending)
        for text in parts:
            identity = digest(json.dumps([CHUNKING_VERSION, section, text], ensure_ascii=False).encode())
            if identity in seen:
                continue
            seen.add(identity)
            chunks.append({'text': text, 'metadata': {**asdict(scope),
                'chunk_id': f'{scope.document_id}:{identity[:32]}', 'section': section,
                'content_hash': digest(text.encode()), 'source_content_hash': source_hash,
                'pipeline_version': PIPELINE_VERSION, 'chunking_version': CHUNKING_VERSION,
                'extractor_version': EXTRACTOR_VERSION}})
    return {'pipeline_version': PIPELINE_VERSION, 'source_content_hash': source_hash, 'chunks': chunks}


def run(request):
    client = IndexClient(os.environ['RAG_KB_URL'], os.environ['RAG_KB_API_KEY'], attempts=1)
    operation = request['operation']
    if operation == 'publish':
        batch = form_batch([approved_document(request)], tenant_id=request['tenant_id'],
            profile_id=PROFILE, profile_version=request['profile_version'], generation=request['generation'],
            embedding_model=MODEL, subject=request['content']['displayName'], approved=True)
        client.submit(batch)
        return {'snapshot': batch.batch_id, 'embedding_model': MODEL}
    if operation == 'purge':
        code, receipt = client._request('/v1/purge', canonical({
            'tenant_id': request['tenant_id'], 'profile_id': PROFILE, 'generation': request['generation']}))
        if code != 200 or receipt.get('status') != 'purged' or receipt.get('profile_id') != PROFILE:
            raise ValueError('purge_not_acknowledged')
        return {'purged': True}
    if operation == 'chat':
        key = os.getenv('GEMINI_API_KEY')
        if not key and os.getenv('GEMINI_API_KEY_FILE'):
            key = Path(os.environ['GEMINI_API_KEY_FILE']).read_text().strip()
        scope = RetrievalScope(**request['scope'])
        provider = WebsiteGemini(api_key=key)
        result = answer(client, provider, scope, request['question'])
        public = {k: result[k] for k in ('status', 'answer', 'citations', 'profile_version')}
        if result['status'] in ('service_unavailable', 'generation_timeout'):
            public['_diagnostic'] = provider.last_error or 'rag_validation_or_retrieval_unavailable'
        return public
    raise ValueError('invalid_operation')


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(1_100_001)
        if len(raw) > 1_100_000:
            raise ValueError('input_too_large')
        result = run(json.loads(raw))
        print(json.dumps(result))
    except Exception:
        # Never send provider URLs, credentials, document contents or tracebacks to the browser/logs.
        print(json.dumps({'error': 'rag_operation_failed'}))
        sys.exit(1)
