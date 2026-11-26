"""Fail-closed release report; this command never deploys or changes services."""
import argparse
import json
import math
from pathlib import Path

REQUIRED = ('unit_and_contract_tests', 'live_generation', 'live_langsmith', 'isolated_extraction',
            'clean_build', 'persistent_http_chroma', 'load_and_timeout_drill', 'rollback_drill',
            'security_review', 'backup_restore')


def assess(evidence, retrieval, answers):
    failures = []
    for gate in REQUIRED:
        value = evidence.get('gates', {}).get(gate)
        if not isinstance(value, dict) or value.get('passed') is not True or not isinstance(value.get('evidence'), str) or not value['evidence'].strip():
            failures.append(gate)
    def threshold(value, bound, lower=True):
        return type(value) in (int,float) and math.isfinite(value) and value >= 0 and (value >= bound if lower else value <= bound)
    hybrid = retrieval.get('summary', {}).get('hybrid', {})
    if retrieval.get('k') != 3 or retrieval.get('rrf_k') != 60 or any(not threshold(hybrid.get(k), .90) or hybrid[k] > 1 for k in ('mrr_at_k','recall_at_k')):
        failures.append('retrieval_quality')
    if not threshold(retrieval.get('questions'), 100) or retrieval.get('held_out') is not True:
        failures.append('held_out_retrieval_dataset')
    baseline = evidence.get('retrieval_baseline', {})
    if not isinstance(retrieval.get('dataset_sha256'), str) or baseline.get('dataset_sha256') != retrieval['dataset_sha256']:
        failures.append('retrieval_baseline_dataset_mismatch')
    for metric in ('mrr_at_k', 'recall_at_k'):
        floor = baseline.get(metric)
        if not threshold(floor, 0) or not threshold(hybrid.get(metric), floor-.02):
            failures.append('retrieval_regression_'+metric)
    cases = answers.get('cases', [])
    if not isinstance(cases, list) or answers.get('completed') is not True or answers.get('real_provider') is not True or answers.get('held_out') is not True or not threshold(len(cases), 100):
        failures.append('held_out_live_answer_evaluation')
    scores = answers.get('metrics', {})
    valid_cases = isinstance(cases, list) and bool(cases) and all(isinstance(c,dict) and
        isinstance(c.get('case_id'),str) and c.get('expected_status') in {'answered','insufficient_evidence'} and
        c.get('status') in {'answered','insufficient_evidence'} and
        all(type(c.get(k)) is bool for k in ('correct_status','correct_citations','supported')) and
        c['correct_status'] == (c['status']==c['expected_status']) and
        threshold(c.get('latency_ms'),0) for c in cases)
    if not valid_cases or len({c['case_id'] for c in cases}) != len(cases):
        failures.append('invalid_answer_cases')
    else:
        negative = [c for c in cases if c['expected_status']=='insufficient_evidence']
        recomputed = {'answer_accuracy':sum(c['correct_status'] and c['correct_citations'] and c['supported'] for c in cases)/len(cases),
                      'citation_correctness':sum(c['correct_citations'] for c in cases)/len(cases),
                      'unsupported_claim_rate':sum(not c['supported'] for c in cases)/len(cases),
                      'abstention_accuracy':sum(c['correct_status'] for c in negative)/max(1,len(negative)),
                      'p95_latency_ms':sorted(c['latency_ms'] for c in cases)[math.ceil(.95*len(cases))-1]}
        if len(negative) < 20 or any(not threshold(scores.get(k),0) or abs(scores[k]-v)>1e-9 for k,v in recomputed.items()):
            failures.append('answer_metrics_not_reproducible')
    for name, target, lower in [('answer_accuracy',.90,True), ('citation_correctness',1,True),
                               ('unsupported_claim_rate',0,False), ('abstention_accuracy',.95,True),
                               ('p95_latency_ms',10000,False)]:
        if not threshold(scores.get(name), target, lower) or (name != 'p95_latency_ms' and scores[name] > 1):
            failures.append(name)
    return {'release_ready':not failures, 'failed_gates':failures,
            'hosting_authorized':False, 'note':'Evidence review does not authorize deployment.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('evidence', type=Path)
    parser.add_argument('retrieval', type=Path)
    parser.add_argument('answers', type=Path)
    args = parser.parse_args()
    try:
        report = assess(*(json.loads(path.read_text(encoding='utf-8-sig')) for path in (args.evidence,args.retrieval,args.answers)))
    except (OSError, ValueError, TypeError, AttributeError, KeyError):
        report = {'release_ready':False, 'failed_gates':['invalid_evidence_files'], 'hosting_authorized':False}
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report['release_ready'] else 1)
