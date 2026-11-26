"""Isolated real-model reranker and semantic-filter ablation, no generator calls."""
import json
from pathlib import Path
from statistics import mean
import numpy as np
from sentence_transformers import SentenceTransformer, CrossEncoder
from hierarchy import build_hierarchy, calibrated_threshold
import sys
sys.path.insert(0, str(Path(__file__).parents[1]/'knowledge-base'))
from ranking import lexical


def main():
    docs = json.loads(Path(__file__).with_name('fixtures').joinpath('general-calibration-v1.json').read_text())['documents']
    config = json.loads(Path('/workspace/.local/general-calibration.json').read_text(encoding='utf-8-sig'))['selected']
    model = SentenceTransformer('/opt/embedding-model')
    cross = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2', max_length=512)
    parents, children = build_hierarchy(docs, model.tokenizer, child_tokens=config['child_tokens'], overlap_tokens=config['overlap_tokens'])
    texts = [c['section']+'\n'+c['text'] for c in children]
    vectors = model.encode(texts, normalize_embeddings=True)
    section_vectors = model.encode([d['section'] for d in docs], normalize_embeddings=True)
    cases = [(d['split'], q, a, d['section']) for d in docs for q,a in d['qa']+[[d['negative'],None]]]
    queries = model.encode([c[1] for c in cases], normalize_embeddings=True)
    # Score all pairs once, avoiding different model outputs between ablations.
    cross_scores = np.asarray(cross.predict([(c[1],t) for c in cases for t in texts])).reshape(len(cases),len(texts))
    variants = []
    for filter_sections, expand_query in [(False,False),(True,False),(False,True)]:
        rows = []
        for i,(split,query,expected,section) in enumerate(cases):
            allowed = set(range(len(texts)))
            if filter_sections:
                top_sections = np.argsort(-(section_vectors @ queries[i]))[:2]
                names = {docs[j]['section'] for j in top_sections}
                allowed = {j for j,c in enumerate(children) if c['section'] in names}
            # Expansion preserves the original query; section labels add no facts.
            searches = [(query,queries[i])]
            if expand_query:
                nearest = int(np.argmax(section_vectors @ queries[i]))
                expanded = query+' '+docs[nearest]['section']
                searches.append((expanded,model.encode(expanded,normalize_embeddings=True)))
            fused = {}
            for search, vector in searches:
                dense = sorted(allowed,key=lambda j:-float(vectors[j]@vector))[:20]
                sparse = [j for j in lexical(search,texts) if j in allowed][:20]
                for ranking,weight in [(dense,config['dense_weight']),(sparse,1-config['dense_weight'])]:
                    for rank,j in enumerate(ranking,1):
                        fused[j]=fused.get(j,0)+weight/(config['rrf_k']+rank)
            candidates=sorted(fused,key=lambda j:(-fused[j],j))[:20]
            ranked = sorted(candidates,key=lambda j:-float(cross_scores[i,j]))
            rows.append({'split':split,'query':query,'answerable':expected is not None,
                'candidates':[{'score':float(cross_scores[i,j]),'relevant':bool(expected and expected.lower() in children[j]['text'].lower() and children[j]['section']==section),
                    'child':j,'parent_id':children[j]['parent_id']} for j in ranked]})
        threshold = calibrated_threshold([(c['score'],c['relevant']) for r in rows if r['split']=='calibration' for c in r['candidates']])
        summaries = {}
        for split in ['calibration','validation']:
            selected = [r for r in rows if r['split']==split]
            positive,negative=[],[]
            for r in selected:
                accepted = [c for c in r['candidates'] if c['score']>=threshold['threshold']][:3]
                r['accepted']=accepted
                r['expanded_parent_ids']=list(dict.fromkeys(c['parent_id'] for c in accepted))
                if r['answerable']:
                    positive.append({'recall':float(any(c['relevant'] for c in accepted)),
                        'precision':sum(c['relevant'] for c in accepted)/len(accepted) if accepted else 0})
                else:
                    negative.append(not accepted)
            summaries[split]={'answer_span_recall':mean(r['recall'] for r in positive),
                'returned_child_precision':mean(r['precision'] for r in positive),
                'unanswerable_rejection_rate':mean(negative)}
        variants.append({'semantic_top2_section_filter':filter_sections,'semantic_query_expansion':expand_query,'calibrated_threshold':threshold, 'summary':summaries,'cases':rows})
    print(json.dumps({'model':'cross-encoder/ms-marco-MiniLM-L-6-v2','variants':variants,
        'limitations':['Small synthetic development corpus; validation was previously inspected.',
        'This stage uses isolated hybrid candidates; no running database is queried.',
        'Threshold calibrated on relevant pairs; semantic relevance does not guarantee answerability.',
        'Parent IDs deduplicated; expanded parent text answer quality is not measured.',
        'Query expansion uses nearest semantic section, not a generative rewriter. No production settings changed.']},indent=2))

if __name__ == '__main__':
    main()
