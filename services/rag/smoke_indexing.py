"""Disposable offline smoke: real HTTP, Chroma persistence and bundled KB embeddings.

Run in the existing KB runtime; no production service or profile is contacted.
"""
import hashlib
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'knowledge-base'))
import chromadb
from chromadb.config import Settings
import uvicorn
import app
from execution import EmbeddingWorker
from indexing import IndexClient, form_batch
from test_indexing import document


def main():
    with tempfile.TemporaryDirectory(prefix='rag-smoke-') as directory:
        app.DATA_DIR = Path(directory)
        app.STATE_PATH = app.DATA_DIR / 'state.json'
        db = chromadb.PersistentClient(path=str(app.DATA_DIR / 'chroma'), settings=Settings(anonymized_telemetry=False))
        collection = db.get_or_create_collection('rag-phase2-smoke')
        model = EmbeddingWorker(os.environ.get('KB_MODEL_PATH', '/opt/embedding-model'))
        app.resources = lambda: (collection, model)
        app.GRANTS = {hashlib.sha256(b'synthetic-smoke-key').hexdigest():
            {'profiles': {'t': ['p']}, 'operations': ['index', 'status']}}
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        server = uvicorn.Server(uvicorn.Config(app.app, log_level='error', access_log=False))
        thread = threading.Thread(target=lambda: server.run(sockets=[listener]), daemon=True)
        thread.start()
        try:
            for _ in range(100):
                if server.started:
                    break
                time.sleep(0.05)
            if not server.started:
                raise RuntimeError('test HTTP server failed to start')
            client = IndexClient(f'http://127.0.0.1:{listener.getsockname()[1]}', 'synthetic-smoke-key')
            def build(generation):
                docs = [document('resume', embedding_model=app.MODEL_NAME, generation=generation),
                        document('projects', text='Implemented synthetic retrieval with Python and SQL.',
                                 embedding_model=app.MODEL_NAME, generation=generation)]
                return form_batch(docs, tenant_id='t', profile_id='p', profile_version=generation,
                                  generation=generation, embedding_model=app.MODEL_NAME, approved=True)
            first = build(1)
            assert client.submit(first)['status'] == 'indexed'
            assert collection.count() == 2
            assert client.submit(first)['writes'] == 0
            records = collection.get(include=['metadatas', 'documents'])
            expected = {c['metadata']['chunk_id']: c for c in json.loads(first.payload)['chunks']}
            for text, meta in zip(records['documents'], records['metadatas']):
                chunk = expected[meta['chunk_id']]
                assert text == chunk['text']
                assert all(meta[k] == v for k, v in chunk['metadata'].items())
            second = build(2)
            original = client._request
            def lose_receipt(path, payload=None):
                result = original(path, payload)
                return (0, {}) if payload is not None else result
            client._request = lose_receipt
            receipt = client.submit(second)
            assert receipt['reconciled'] and receipt['writes'] == 1
            assert collection.count() == 2
            assert app.load_state()['t:p']['snapshot'] == second.batch_id
            assert all(m['generation'] == 2 for m in collection.get(include=['metadatas'])['metadatas'])
            if '--parent-quality' in sys.argv:
                from retrieval import RetrievalScope,retrieve
                client._request=original
                app.GRANTS[hashlib.sha256(b'synthetic-smoke-key').hexdigest()]['operations'].append('query')
                text=('Database backups are retained for fourteen days. Restore requests require operator approval. '
                      'Operators log each restore and check the restored data before resuming service. ')*18
                doc=document('operations',text=text,embedding_model=app.MODEL_NAME,generation=3)
                batch=form_batch([doc],tenant_id='t',profile_id='p',profile_version=3,generation=3,
                                 embedding_model=app.MODEL_NAME,approved=True)
                receipt=client.submit(batch)
                receipt=app.load_state()['t:p']
                assert receipt['parent_count']==1 and receipt['count']>1
                scope=RetrievalScope('t','p',3,3,app.MODEL_NAME,batch.batch_id)
                result=retrieve(client,scope,'How long are database backups retained?',top_k=3)
                assert result['status']=='retrieved',result['status']
                assert len(result['results'])==1 and result['results'][0]['text']==text
                assert result['results'][0]['metadata']['chunk_id']==doc['chunks'][0]['metadata']['chunk_id']
                stored=collection.get(include=['metadatas'])['metadatas']
                assert all(m['parent_text']==text for m in stored)
                spans=sorted((m['child_start'],m['child_end']) for m in stored)
                assert max(end for _,end in spans)>512
                assert all(a[1]-b[0]==12 for a,b in zip(spans,spans[1:]))
                import numpy as np
                records=collection.get(include=['documents','metadatas','embeddings'])
                inputs=[f"Profile: \nSection: {m['section']}\n{t}" for t,m in zip(records['documents'],records['metadatas'])]
                regenerated=model.encode(inputs,normalize_embeddings=True)
                vectors=np.asarray(records['embeddings'])
                assert vectors.shape==(receipt['count'],384) and np.isfinite(vectors).all()
                assert np.allclose(vectors,regenerated,atol=1e-6)
                assert np.allclose(np.linalg.norm(vectors,axis=1),1,atol=1e-5)
                print(json.dumps({'passed':True,'stored_children':receipt['count'],'parents_returned':1,
                    'overlap_tokens':12,'real_chroma':True,'real_reranker':True,'exact_parent_restored':True,
                    'embedding_dimensions':384,'stored_vectors_match_regeneration':True,'normalized_vectors':True}))
            elif '--full-quality' in sys.argv:
                from answer_evaluation import evaluate_answers
                from evaluation import synthetic_documents
                from retrieval import RetrievalScope
                from gemini import GeminiClient
                root = Path(__file__).with_name('fixtures')
                corpus = json.loads((root/'retrieval-v1.json').read_text())
                dataset_name = sys.argv[sys.argv.index('--quality-dataset')+1] if '--quality-dataset' in sys.argv else 'answers-v1'
                if dataset_name not in {'answers-v1', 'hard-answers-v1'}:
                    raise ValueError('unknown quality dataset')
                dataset = json.loads((root/(dataset_name+'.json')).read_text())
                client._request = original
                app.GRANTS[hashlib.sha256(b'synthetic-smoke-key').hexdigest()] = {
                    'profiles': {'rag-evaluation': ['synthetic-v1']}, 'operations': ['index', 'status', 'query']}
                generation = 0
                def transport(case):
                    nonlocal generation
                    generation += 1
                    items = corpus['documents'] + case.get('extra_evidence', [])
                    docs, _ = synthetic_documents({**corpus, 'documents':items}, app.MODEL_NAME)
                    for doc in docs:
                        for chunk in doc['chunks']:
                            chunk['metadata']['generation'] = generation
                    batch = form_batch(docs, tenant_id='rag-evaluation', profile_id='synthetic-v1',
                        profile_version=generation, generation=generation, embedding_model=app.MODEL_NAME,
                        subject='Mira', approved=True)
                    client.submit(batch)
                    return client, RetrievalScope('rag-evaluation','synthetic-v1',generation,generation,app.MODEL_NAME,batch.batch_id)
                report=evaluate_answers(GeminiClient(),corpus,dataset,transport_factory=transport)
                report['retrieval_policy']=app.retrieval_policy()
                print(json.dumps(report,indent=2))
            elif '--resume-quality' in sys.argv:
                from quality_check import evaluate_resume
                client._request = original
                app.GRANTS[hashlib.sha256(b'synthetic-smoke-key').hexdigest()]['operations'].append('query')
                print(json.dumps(evaluate_resume(client, collection, model, app.MODEL_NAME), indent=2))
            elif '--evaluate' in sys.argv:
                from evaluation import synthetic_documents, evaluate
                from retrieval import RetrievalScope
                dataset = json.loads(Path(__file__).with_name('fixtures').joinpath('retrieval-v1.json').read_text())
                documents, chunk_ids = synthetic_documents(dataset, app.MODEL_NAME)
                app.GRANTS[hashlib.sha256(b'synthetic-smoke-key').hexdigest()] = {
                    'profiles': {'rag-evaluation': ['synthetic-v1']}, 'operations': ['index', 'status', 'query']}
                client._request = original
                evaluation_batch = form_batch(documents, tenant_id='rag-evaluation', profile_id='synthetic-v1',
                    profile_version=1, generation=1, embedding_model=app.MODEL_NAME, subject='Mira', approved=True)
                client.submit(evaluation_batch)
                scope = RetrievalScope('rag-evaluation', 'synthetic-v1', 1, 1, app.MODEL_NAME, evaluation_batch.batch_id)
                print(json.dumps(evaluate(client, scope, dataset, chunk_ids), indent=2))
            else:
                print(json.dumps({'status': 'passed', 'chunks': 2, 'generations': 2,
                                  'exact_replay': True, 'lost_receipt_reconciled': True,
                                  'real_chroma': True, 'real_embeddings': True}))
        finally:
            server.should_exit = True
            thread.join(timeout=10)
            listener.close()
            model.close()
            from parent_retrieval import reranker
            if reranker.cache_info().currsize:
                reranker().close()


if __name__ == '__main__':
    main()
