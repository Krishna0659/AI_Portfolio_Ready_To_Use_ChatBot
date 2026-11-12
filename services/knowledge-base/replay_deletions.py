"""Prepare restored state offline from a trusted, current deletion ledger."""
import json
import sys
from pathlib import Path


def replay(restored, latest):
    result = dict(restored)
    for key, state in latest.items():
        if state.get('purged') and state['generation'] >= result.get(key, {}).get('generation', 0):
            result[key] = dict(state)
    return result


if __name__ == '__main__':
    backup, latest, output = map(Path, sys.argv[1:])
    state = replay(json.loads(backup.read_text()), json.loads(latest.read_text()))
    with output.open('x') as stream:
        json.dump(state, stream, sort_keys=True)
    print('Prepared restored state with current deletion markers; keep restored service isolated')
