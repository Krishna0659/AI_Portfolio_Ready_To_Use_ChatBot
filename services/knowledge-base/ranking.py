"""Bounded per-profile BM25 and reciprocal rank fusion (k=60)."""
import math
import re
from collections import Counter

STOP = set('a an the is are was were what which who does do has have his her their and or of in on to for with'.split())

def tokens(text):
    return [t for t in re.findall(r'\w+', text.lower()) if t not in STOP]

def lexical(query, documents):
    counts = [Counter(tokens(doc)) for doc in documents]
    lengths = [sum(c.values()) for c in counts]
    average = sum(lengths) / max(len(counts), 1) or 1
    scores = [0.0] * len(counts)
    for term in set(tokens(query)):
        frequency = sum(term in c for c in counts)
        idf = math.log(1 + (len(counts) - frequency + 0.5) / (frequency + 0.5))
        for i, count in enumerate(counts):
            tf = count[term]
            scores[i] += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * lengths[i] / average))
    return sorted((i for i, score in enumerate(scores) if score > 0), key=lambda i: (-scores[i], i))

def fuse(dense_ids, lexical_ids, k=60, dense_weight=.5):
    scores = {}
    for ranking,weight in ((dense_ids,dense_weight),(lexical_ids,1-dense_weight)):
        for rank, record_id in enumerate(dict.fromkeys(ranking), 1):
            scores[record_id] = scores.get(record_id, 0) + weight / (k + rank)
    return sorted(scores, key=lambda record_id: (-scores[record_id], record_id))
