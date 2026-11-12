#!/usr/bin/env python3
"""
Retrieval evaluation script for Knowledge Base facts.
Measures Recall@1, Recall@3, and Mean Reciprocal Rank (MRR) on benchmark question fixtures.
Can run against the live KB HTTP service (localhost:8080) or in standalone offline mode.
"""

import os
import sys
import json
import math
import argparse
import urllib.request
import urllib.error
from pathlib import Path
from collections import Counter

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
PROFILE_PATH = FIXTURES_DIR / "krishna-gaur-approved-profile.json"
QUESTIONS_PATH = FIXTURES_DIR / "evaluation-questions.json"


def offline_rank(query: str, facts: list, top_k: int = 3):
    """Fallback offline TF-IDF cosine ranker for running tests without container dependencies."""
    def tokenize(text: str):
        return [w.lower().strip(".,;:?!'\"()[]{}") for w in text.split() if len(w) > 1]

    doc_tokens = [tokenize(f["text"]) for f in facts]
    df = Counter()
    for tokens in doc_tokens:
        for w in set(tokens):
            df[w] += 1
    N = len(facts)
    query_tokens = tokenize(query)

    scores = []
    for idx, tokens in enumerate(doc_tokens):
        tf = Counter(tokens)
        score = 0.0
        for w in query_tokens:
            if w in tf:
                idf = math.log((N + 1) / (df[w] + 1)) + 1.0
                score += (tf[w] / len(tokens)) * idf
        scores.append((score, facts[idx]))

    scores.sort(key=lambda x: x[0], reverse=True)
    return [fact for _, fact in scores[:top_k]]


def evaluate_retrieval(service_url: str = None, api_key: str = None):
    profile_data = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
    questions_data = json.loads(QUESTIONS_PATH.read_text(encoding="utf-8"))
    facts = profile_data["facts"]

    use_live_service = False
    if service_url:
        try:
            req = urllib.request.Request(
                f"{service_url}/health/ready",
                headers={"x-kb-api-key": api_key or os.getenv("KB_API_KEY", "")}
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                if resp.status == 200:
                    use_live_service = True
        except Exception:
            use_live_service = False

    print(f"Mode: {'Live HTTP Service (' + service_url + ')' if use_live_service else 'Standalone TF-IDF Ranker'}")
    print(f"Evaluating {len(questions_data)} benchmark questions against {len(facts)} identity facts...\n")

    hits_at_1 = 0
    hits_at_3 = 0
    rr_sum = 0.0

    print(f"{'Q#':<4} {'Question':<55} {'Expected':<20} {'Top-1 Ret':<15} {'R@1':<5} {'R@3':<5} {'RR':<5}")
    print("-" * 115)

    for i, item in enumerate(questions_data, 1):
        q = item["question"]
        expected = set(item["expected_fact_ids"])

        if use_live_service:
            body = json.dumps({
                "tenant_id": profile_data["tenant_id"],
                "profile_id": profile_data["profile_id"],
                "query": q,
                "top_k": 3
            }).encode("utf-8")
            req = urllib.request.Request(
                f"{service_url}/v1/query",
                data=body,
                headers={"Content-Type": "application/json", "x-kb-api-key": api_key}
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                res = json.load(resp)
                retrieved_ids = [r["metadata"].get("fact_id") for r in res.get("results", [])]
        else:
            top_facts = offline_rank(q, facts, top_k=3)
            retrieved_ids = [f["fact_id"] for f in top_facts]

        top_1_match = bool(retrieved_ids and retrieved_ids[0] in expected)
        top_3_match = any(fid in expected for fid in retrieved_ids[:3])

        reciprocal_rank = 0.0
        for rank, fid in enumerate(retrieved_ids, 1):
            if fid in expected:
                reciprocal_rank = 1.0 / rank
                break

        if top_1_match:
            hits_at_1 += 1
        if top_3_match:
            hits_at_3 += 1
        rr_sum += reciprocal_rank

        top_1_id = retrieved_ids[0] if retrieved_ids else "none"
        q_trunc = (q[:52] + "...") if len(q) > 55 else q
        print(f"{i:<4} {q_trunc:<55} {','.join(expected):<20} {top_1_id:<15} {('1' if top_1_match else '0'):<5} {('1' if top_3_match else '0'):<5} {reciprocal_rank:<5.2f}")

    total = len(questions_data)
    recall_1 = hits_at_1 / total
    recall_3 = hits_at_3 / total
    mrr = rr_sum / total

    print("-" * 115)
    print(f"Evaluation Summary:")
    print(f"  Recall@1 : {recall_1:.4f} ({hits_at_1}/{total})")
    print(f"  Recall@3 : {recall_3:.4f} ({hits_at_3}/{total})")
    print(f"  MRR      : {mrr:.4f}")

    return {"recall_1": recall_1, "recall_3": recall_3, "mrr": mrr}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate KB retrieval accuracy")
    parser.add_argument("--url", default=os.getenv("KB_URL", "http://localhost:8080"), help="KB service URL")
    parser.add_argument("--key", default=os.getenv("KB_API_KEY", ""), help="KB API key")
    args = parser.parse_args()

    metrics = evaluate_retrieval(service_url=args.url, api_key=args.key)
    # Target baseline: Recall@3 >= 75%
    if metrics["recall_3"] < 0.75:
        sys.exit(1)

