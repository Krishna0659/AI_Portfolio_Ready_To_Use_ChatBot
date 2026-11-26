"""Parent storage with token-bounded child search and calibrated reranking."""
import os
from functools import lru_cache
from pathlib import Path
import json
import hashlib
from fastapi import HTTPException
from execution import EmbeddingWorker


@lru_cache(maxsize=1)
def retrieval_policy():
    return json.loads(Path(__file__).with_name('retrieval_policy.json').read_text())


@lru_cache(maxsize=1)
def tokenizer():
    from transformers import AutoTokenizer
    return AutoTokenizer.from_pretrained(os.getenv('KB_MODEL_PATH','/opt/embedding-model'), local_files_only=True)


def child_records(ids, documents, metadatas, subject):
    tok = tokenizer()
    policy=retrieval_policy()
    result = []
    for record_id, text, meta in zip(ids,documents,metadatas):
        prefix = f"Profile: {subject}\nSection: {meta['section']}\n"
        prefix_tokens = len(tok.encode(prefix,add_special_tokens=True))
        size = min(policy['child_tokens'],policy['embedding_token_limit']-prefix_tokens-2)
        if size <= policy['overlap_tokens']:
            raise HTTPException(422,'section metadata exceeds embedding token budget')
        offsets = tok(text,add_special_tokens=False,return_offsets_mapping=True,verbose=False)['offset_mapping']
        start=0
        while start < len(offsets):
            end=min(start+size,len(offsets))
            child=text[offsets[start][0]:offsets[end-1][1]]
            embedding_text=prefix+child
            if len(tok.encode(embedding_text)) > policy['embedding_token_limit']:
                raise HTTPException(422,'child exceeds embedding token budget')
            result.append((f'{record_id}:child:{start}',child,{**meta,'parent_text':text,
                'parent_record_id':record_id,'child_start':start,'child_end':end,'profile_subject':subject},embedding_text))
            if end==len(offsets):
                break
            start=end-policy['overlap_tokens']
    return result


def cross_worker(requests,responses,model_path):
    from sentence_transformers import CrossEncoder
    model=CrossEncoder(model_path,max_length=512)
    while True:
        pairs, options=requests.get()
        try:
            windows,owners=[],[]
            for owner,(query,document) in enumerate(pairs):
                size=512-len(model.tokenizer.encode(query,add_special_tokens=False))-3
                if size<=48:
                    raise OverflowError('query token budget')
                offsets=model.tokenizer(document,add_special_tokens=False,return_offsets_mapping=True,verbose=False)['offset_mapping']
                for start in range(0,len(offsets),size-48):
                    end=min(start+size,len(offsets))
                    windows.append((query,document[offsets[start][0]:offsets[end-1][1]]));owners.append(owner)
                    if end==len(offsets):break
            tokens=model.tokenizer([p[0] for p in windows],[p[1] for p in windows],truncation=False,verbose=False)['input_ids']
            if any(len(t)>512 for t in tokens):
                responses.put(('too_long',None))
                continue
            scores=[float('-inf')]*len(pairs)
            for owner,score in zip(owners,model.predict(windows).tolist()):scores[owner]=max(scores[owner],score)
            responses.put(('ok',scores))
        except OverflowError:
            responses.put(('too_long',None))
        except Exception:
            responses.put(('error',None))


@lru_cache(maxsize=1)
def reranker():
    path=os.environ.get('KB_RERANKER_PATH')
    if not path or not Path(path).is_dir():
        raise HTTPException(503,'local reranker model is not configured')
    policy=retrieval_policy()
    try:
        with (Path(path)/'model.safetensors').open('rb') as stream:
            checksum=hashlib.file_digest(stream,'sha256').hexdigest()
    except OSError as exc:
        raise HTTPException(503,'reranker weights unavailable') from exc
    if checksum!=policy['weights_sha256']:
        raise HTTPException(503,'reranker weights do not match calibration')
    return EmbeddingWorker(path,timeout=45,target=cross_worker)


def rerank_parents(query,rows,top_k):
    if not rows:
        return []
    # Preserve each parent's best hybrid position before cross-encoder ranking.
    unique={}
    for row in rows:unique.setdefault(row['metadata'].get('parent_record_id',id(row)),row)
    rows=list(unique.values())
    policy=retrieval_policy()
    scores=reranker().encode([(query,'Profile: '+r['metadata'].get('profile_subject','')+'\nSection: '+r['metadata']['section']+'\n'+r['metadata'].get('parent_text',r['text'])) for r in rows]).tolist()
    if len(scores)!=len(rows):
        raise HTTPException(503,'invalid reranker result')
    import math
    if any(not isinstance(s,(int,float)) or not math.isfinite(s) for s in scores):
        raise HTTPException(503,'invalid reranker score')
    weight=policy['reranker_weight']
    k=policy['rank_fusion_k']
    fused={i:(1-weight)/(k+i+1) for i in range(len(rows))}
    for rank,i in enumerate(sorted(range(len(rows)),key=lambda i:(-scores[i],i)),1):
        fused[i]+=weight/(k+rank)
    selected,seen=[],set()
    for i in sorted(range(len(rows)),key=lambda i:(-fused[i],i)):
        if scores[i]<policy['cross_encoder_threshold']:
            continue
        row=rows[i]
        meta=row['metadata']
        identity=meta['parent_record_id']
        if identity in seen:
            continue
        seen.add(identity)
        selected.append({**row,'text':meta['parent_text'],
            'metadata':{k:v for k,v in meta.items() if k not in {'parent_text','parent_record_id','child_start','child_end','profile_subject'}}})
        if len(selected)==top_k:
            break
    return selected
