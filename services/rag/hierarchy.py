"""Isolated token-window experiment; does not mutate the active index.

Pass the embedding model's tokenizer so size and overlap use actual tokens.
Parents are contiguous source sections; children never cross section boundaries.
"""
import hashlib


def build_hierarchy(blocks, tokenizer, *, child_tokens, overlap_tokens):
    if type(child_tokens) is not int or type(overlap_tokens) is not int:
        raise ValueError('integer token sizes required')
    if not 0 < overlap_tokens < child_tokens:
        raise ValueError('overlap must be positive and smaller than child size')
    parents, children = [], []
    for block in blocks:
        section, text = block['section'], block['text']
        if not text.strip():
            continue
        parent_id = hashlib.sha256((section+'\0'+text).encode()).hexdigest()
        parents.append({'id': parent_id, 'section': section, 'text': text})
        encoded = tokenizer(text, add_special_tokens=False, return_offsets_mapping=True)
        offsets = encoded['offset_mapping']
        start = 0
        while start < len(offsets):
            end = min(start + child_tokens, len(offsets))
            lo, hi = offsets[start][0], offsets[end-1][1]
            children.append({'id': f'{parent_id}:{start}:{end}', 'parent_id': parent_id,
                             'section': section, 'text': text[lo:hi],
                             'token_start': start, 'token_end': end})
            if end == len(offsets):
                break
            start = end-overlap_tokens
    return parents, children


def calibrated_threshold(scored_labels):
    """Choose maximum F1 on calibration pairs; ties favor precision.

    Raw cross-encoder scores are model-specific, not probabilities. Evaluate the
    returned threshold on separate held-out documents before adopting it.
    """
    import math
    if not scored_labels or {label for _, label in scored_labels} != {False, True}:
        raise ValueError('positive and negative calibration labels required')
    if any(not math.isfinite(score) for score, _ in scored_labels):
        raise ValueError('finite scores required')
    candidates = sorted({score for score, _ in scored_labels})
    candidates.append(math.nextafter(candidates[-1], math.inf))
    results = []
    positives = sum(label for _, label in scored_labels)
    for threshold in candidates:
        selected = [label for score, label in scored_labels if score >= threshold]
        tp = sum(selected)
        precision = tp / len(selected) if selected else 0
        recall = tp / positives
        f1 = 2*precision*recall/(precision+recall) if precision+recall else 0
        results.append({'threshold': threshold, 'precision': precision, 'recall': recall, 'f1': f1})
    return max(results, key=lambda row: (row['f1'], row['precision'], row['threshold']))


def recall_preserving_threshold(cases):
    """Highest cutoff preserving every calibration question's best relevant hit.

    Only calibration cases may be supplied. Relevance is not answerability;
    generation must still abstain on context that does not support the question.
    """
    import math
    if not cases or any(c['split']!='calibration' for c in cases):
        raise ValueError('calibration cases only')
    floors=[]
    for case in cases:
        if not case['answerable']:
            continue
        scores=[c['score'] for c in case['candidates'][:3] if c['relevant']]
        if not scores or any(not math.isfinite(s) for s in scores):
            raise ValueError('candidate retrieval must cover every calibration answer')
        floors.append(max(scores))
    if not floors:
        raise ValueError('answerable calibration cases required')
    return min(floors)
