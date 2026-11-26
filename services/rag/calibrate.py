"""Offline retrieval-only calibration. Never calls generation or the running KB."""
import json
from pathlib import Path
import sys
from statistics import mean
import numpy as np
from sentence_transformers import SentenceTransformer
from hierarchy import build_hierarchy
sys.path.insert(0, str(Path(__file__).parents[1]/'knowledge-base'))
from ranking import lexical


def main():
    dataset = json.loads(Path(__file__).with_name('fixtures').joinpath('general-calibration-v1.json').read_text())
    docs = dataset['documents']
    assert len(docs) == 10 and sum(len(d['qa']) for d in docs) == 20
    model = SentenceTransformer('/opt/embedding-model')
    cases = [(d['split'], q, a, d['section']) for d in docs for q, a in d['qa']]
    query_vectors = model.encode([q for _, q, _, _ in cases], normalize_embeddings=True)
    measurements = []
    for size, overlap in [(32,8), (48,12), (96,24), (192,32)]:
        parents, children = build_hierarchy(docs, model.tokenizer, child_tokens=size, overlap_tokens=overlap)
        texts = [c['section']+'\n'+c['text'] for c in children]
        assert max(len(model.tokenizer.encode(t)) for t in texts) <= model.max_seq_length
        vectors = model.encode(texts, normalize_embeddings=True)
        rankings = []
        for i, (_, q, _, _) in enumerate(cases):
            dense = np.argsort(-(vectors @ query_vectors[i])).tolist()[:20]
            rankings.append((dense, lexical(q, texts)[:20]))
        for constant in [10,30,60,100]:
            for weight in [.25,.5,.75,1.0]:
                scores = {'calibration': [], 'validation': []}
                for case, (dense, sparse) in zip(cases, rankings):
                    split, query, expected, section = case
                    fused = {}
                    for ranking, w in [(dense,weight),(sparse,1-weight)]:
                        for rank, idx in enumerate(ranking,1):
                            fused[idx] = fused.get(idx,0)+w/(constant+rank)
                    selected = sorted(fused, key=lambda i: (-fused[i],i))[:3]
                    relevant = [expected.lower() in children[i]['text'].lower() and children[i]['section']==section for i in selected]
                    scores[split].append({'recall': float(any(relevant)), 'precision': sum(relevant)/3,
                        'mrr': next((1/r for r,v in enumerate(relevant,1) if v),0)})
                measurements.append({'child_tokens':size,'overlap_tokens':overlap,'rrf_k':constant,'dense_weight':weight,
                    **{split:{metric:mean(r[metric] for r in rows) for metric in ['recall','precision','mrr']} for split,rows in scores.items()}})
    # Validation is excluded from parameter selection.
    best = max(measurements, key=lambda r:(r['calibration']['recall'],r['calibration']['mrr'],r['calibration']['precision']))
    print(json.dumps({'dataset':dataset['version'],'qa_pairs':30,'answerable':20,'unanswerable':10,
        'selected_on':'calibration_documents_only','selected':best,'experiments':measurements,
        'limitations':['Small synthetic corpus; exploratory only.', 'Unanswerable cases authored but not scored without a calibrated rejection model.',
        'Recall is answer-span coverage, precision is relevant child fraction; neither is RAGAS.',
        'No generation, cross-encoder, semantic filtering or query rewriting evaluated.']},indent=2))

if __name__ == '__main__':
    main()
