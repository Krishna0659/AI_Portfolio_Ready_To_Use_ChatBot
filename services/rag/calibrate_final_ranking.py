"""Explicit development-set rank calibration; no hidden validation selection."""
import json
from pathlib import Path
import sys
import numpy as np
from statistics import mean
from itertools import product
from sentence_transformers import SentenceTransformer,CrossEncoder
sys.path.insert(0,str(Path(__file__).parents[1]/'knowledge-base'))
from ranking import lexical,fuse


def main():
    fixture=json.loads(Path(__file__).with_name('fixtures').joinpath('retrieval-v1.json').read_text())
    docs=sorted(fixture['documents'],key=lambda d:d['id'])
    texts=[d['section']+'\n'+d['text'] for d in docs]
    model=SentenceTransformer('/opt/embedding-model')
    vectors=model.encode(['Profile: Mira\nSection: '+t for t in texts],normalize_embeddings=True)
    queries=model.encode([q['query'] for q in fixture['questions']],normalize_embeddings=True)
    cross=CrossEncoder('/cache/models--cross-encoder--ms-marco-MiniLM-L-6-v2/snapshots/233902d25c440f23af6f7d6e94d2946bac0bee0a',max_length=512)
    scores=np.asarray(cross.predict([(q['query'],t) for q in fixture['questions'] for t in texts])).reshape(len(queries),len(docs))
    # Include the already-labelled calibration half of the general corpus.
    general=json.loads(Path('/workspace/.local/reranker-hybrid-calibration.json').read_text(encoding='utf-8-sig'))
    positives=[c['score'] for r in general['variants'][0]['cases'] if r['split']=='calibration' for c in r['candidates'] if c['relevant']]
    positives.extend(float(scores[i,j]) for i,q in enumerate(fixture['questions']) for j,d in enumerate(docs) if d['id'] in q['relevance'])
    threshold=min(positives)
    trials=[]
    for dense_weight,rrf_k,weight in product([.25,.5,.75,1.],[10,30,60],[0,.25,.5,.75,1.]):
        cases=[]
        for i,q in enumerate(fixture['questions']):
            hybrid=fuse(np.argsort(-(vectors@queries[i])).tolist(),lexical(q['query'],texts),k=rrf_k,dense_weight=dense_weight)
            cross_order=sorted(hybrid,key=lambda j:-scores[i,j])
            combined={j:(1-weight)/(10+r) for r,j in enumerate(hybrid,1)}
            for r,j in enumerate(cross_order,1):
                combined[j]+=weight/(10+r)
            chosen=[j for j in sorted(combined,key=lambda j:(-combined[j],j)) if scores[i,j]>=threshold][:3]
            labels=q['relevance']
            hits=[docs[j]['id'] in labels for j in chosen]
            cases.append({'id':q['id'],'recall':sum(hits)/len(labels),
                'mrr':next((1/r for r,v in enumerate(hits,1) if v),0),
                'precision':sum(hits)/3})
        trials.append({'dense_weight':dense_weight,'rrf_k':rrf_k,'reranker_weight':weight,**{m:mean(c[m] for c in cases) for m in ['recall','mrr','precision']}})
    selected=max(trials,key=lambda r:(round(r['recall'],12),round(r['mrr'],12),round(r['precision'],12),-abs(r['reranker_weight']-.5),-abs(r['dense_weight']-.5),-abs(r['rrf_k']-60)))
    assert np.isfinite(threshold)
    print(json.dumps({'threshold':threshold,'selected':selected,'trials':trials,
        'calibration_sets':['general-calibration-v1 calibration half','synthetic-retrieval-v1'],
        'held_out':False,'objective':'preserve labelled positive pairs; maximize macro recall then MRR; numerical ties use balanced rank fusion',
        'limitation':'Existing development fixtures, not independent validation. Abstention still requires generation.'},indent=2))

if __name__=='__main__':
    main()
