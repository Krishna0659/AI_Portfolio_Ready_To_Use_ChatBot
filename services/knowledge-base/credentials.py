"""Local operator credential provisioning; hashes only in the hot-reloaded grants."""
import argparse
import hashlib
import json
import os
import secrets
from pathlib import Path


def read_grants():
    path = Path(os.getenv('KB_DATA_DIR', '/data')) / 'caller-grants.json'
    grants = json.loads(path.read_text()) if path.exists() else json.loads(os.getenv('KB_CALLER_GRANTS', '{}'))
    if not isinstance(grants, dict):
        raise ValueError('invalid grants')
    for digest, grant in grants.items():
        if not isinstance(digest, str) or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
            raise ValueError('invalid credential hash')
        if not isinstance(grant, dict) or not isinstance(grant.get('profiles'), dict) or not isinstance(grant.get('operations'), list):
            raise ValueError('invalid grant')
        if not all(isinstance(t, str) and isinstance(p, list) and all(isinstance(i, str) for i in p) for t, p in grant['profiles'].items()):
            raise ValueError('invalid scopes')
    return grants


def write_grants(grants):
    path = Path(os.getenv('KB_DATA_DIR', '/data')) / 'caller-grants.json'
    tmp = path.with_suffix('.tmp')
    with tmp.open('w') as stream:
        json.dump(grants, stream, sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    tmp.replace(path)


def main():
    parser = argparse.ArgumentParser(description='Run one operator at a time; never print raw caller keys.')
    parser.add_argument('--tenant')
    parser.add_argument('--profile', action='append')
    parser.add_argument('--operation', action='append', choices=['query', 'index', 'purge', 'status', 'reconcile'])
    parser.add_argument('--key-file', type=Path)
    parser.add_argument('--revoke-hash')
    args = parser.parse_args()
    grants = read_grants()
    if args.revoke_hash:
        grants.pop(args.revoke_hash, None)
        write_grants(grants)
        print('Caller revoked; effective on the next request')
        return
    if not all((args.tenant, args.profile, args.operation, args.key_file)):
        parser.error('provisioning requires tenant, profile, operation and key-file')
    key = secrets.token_urlsafe(32)
    descriptor = os.open(args.key_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        stream.write(key)
    digest = hashlib.sha256(key.encode()).hexdigest()
    grants[digest] = {'profiles': {args.tenant: args.profile}, 'operations': args.operation}
    write_grants(grants)
    print('Credential hash:', digest)


if __name__ == '__main__':
    main()
