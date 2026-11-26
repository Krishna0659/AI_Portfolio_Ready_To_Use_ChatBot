import sys,json
from pathlib import Path
sys.path.insert(0,'/workspace/services/rag');sys.path.insert(0,'/workspace/services/knowledge-base')
import numpy as np
from sentence_transformers import SentenceTransformer,CrossEncoder
from ranking import fuse,lexical
from evaluation import metrics_at_k
from statistics import mean
f=json.loads(Path('/workspace/services/rag/fixtures/retrieval-v1.json').read_text());docs=sorted(f['documents'],key=lambda d:d['id']);texts=[d['section']+'\n'+d['text'] for d in docs]
m=SentenceTransformer('/opt/embedding-model');v=m.encode(['Profile: Mira\nSection: '+t for t in texts],normalize_embeddings=True);qv=m.encode([q['query'] for q in f['questions']],normalize_embeddings=True)
c=CrossEncoder('/cache/models--cross-encoder--ms-marco-MiniLM-L-6-v2/snapshots/233902d25c440f23af6f7d6e94d2946bac0bee0a',max_length=512);scores=np.asarray(c.predict([(q['query'],'Profile: Mira\nSection: '+t) for q in f['questions'] for t in texts])).reshape(len(qv),len(texts))

trials=[]
for weight in [0,.25,.5,.75,1.]:
 orders=[]
 for i,q in enumerate(f['questions']):
  h=fuse(np.argsort(-(v@qv[i])).tolist(),lexical(q['query'],texts),k=60,dense_weight=.75)
  r={j:(1-weight)/(10+k) for k,j in enumerate(h,1)}
  for k,j in enumerate(sorted(h,key=lambda j:-scores[i,j]),1):r[j]+=weight/(10+k)
  orders.append(sorted(r,key=lambda j:(-r[j],j)))
 def measure(threshold):
  rows=[]
  for i,q in enumerate(f['questions']):
   chosen=[j for j in orders[i] if scores[i,j]>=threshold][:5]
   hits=sum(docs[j]['id'] in q['relevance'] for j in chosen)
   rank_metrics=metrics_at_k([docs[j]['id'] for j in chosen],q['relevance'],5)
   rows.append({'recall':hits/len(q['relevance']),'precision':hits/max(1,len(chosen)),'mrr':rank_metrics['mrr'],'ndcg':rank_metrics['ndcg']})
  return {k:mean(r[k] for r in rows) for k in ['recall','precision','mrr','ndcg']}
 for threshold in sorted(set(scores.flatten().tolist()+[-8.195047378540039])):
  trials.append({'reranker_weight':weight,'threshold':float(threshold),**measure(threshold)})
best=max([t for t in trials if t['recall']>=0.9722222222222222-1e-10],key=lambda t:(t['precision'],t['recall'],t['ndcg'],t['mrr'],t['reranker_weight'],t['threshold']))
print(json.dumps({'selected':best,'trials':trials,'held_out':False,'criterion':'Maximize returned-parent precision subject to macro recall >= 0.9722222222222222; then maximize nDCG/MRR; exact ties prefer pure reranking over blending; separate synthetic multi-source development set; no CV labels used'},indent=2))
