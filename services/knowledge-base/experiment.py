import json
from pathlib import Path
import numpy as np
import app

facts = json.loads(Path('/app/fixtures/krishna-gaur-approved-profile.json').read_text())['facts']
cases = json.loads(Path('/app/fixtures/evaluation-questions.json').read_text())
_, model = app.resources()
identity = ' '.join(f['text'] for f in facts if f['section'] == 'identity')
texts = [f"Profile: {identity}\nSection: {f['section']}\n" + ' '.join(x['text'] for x in facts if x['section'] == f['section']) for f in facts]
vectors = model.encode(texts, normalize_embeddings=True)
recalls, ranks = [], []
for case in cases:
    q = model.encode(case['question'], normalize_embeddings=True)
    ids = [facts[i]['fact_id'] for i in np.argsort(-(vectors @ q))[:3]]
    expected = set(case['expected_fact_ids'])
    recalls.append(len(expected.intersection(ids))/len(expected))
    ranks.append(next((1/r for r,f in enumerate(ids,1) if f in expected),0))
    print(ids)
print('recall', np.mean(recalls), 'mrr', np.mean(ranks))
