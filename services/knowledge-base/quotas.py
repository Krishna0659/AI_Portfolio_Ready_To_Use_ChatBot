"""Single-process tenant admission limits; no external services required."""
import math
import threading
import time

from fastapi import HTTPException

MAX_TENANT_PROFILES = 1000  # Includes tombstones so deleted IDs cannot grow state forever.
MAX_TENANT_FACTS = 10_000


def check_storage(state, tenant_id, profile_id, new_count):
    key = f'{tenant_id}:{profile_id}'
    entries = {k: v for k, v in state.items() if k.startswith(tenant_id + ':')}
    if key not in entries and len(entries) >= MAX_TENANT_PROFILES:
        raise HTTPException(409, 'tenant profile quota exceeded')
    used = sum(v.get('count', 0) for k, v in entries.items()
               if k != key and not v.get('purged'))
    if new_count is not None and used + new_count > MAX_TENANT_FACTS:
        raise HTTPException(409, 'tenant active fact quota exceeded')


class TenantRateLimit:
    # Per-minute refill and burst. Maintenance has independent capacity so
    # exhausting indexing/query tokens does not prevent withdrawal or status.
    policies = {'query': (120, 20), 'index': (10, 10), 'maintenance': (60, 10)}

    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.buckets = {}
        self.lock = threading.Lock()

    def check(self, tenant_id, operation):
        group = operation if operation in ('query', 'index') else 'maintenance'
        rate, capacity = self.policies[group]
        key = (tenant_id, group)
        with self.lock:
            now = self.clock()
            tokens, previous = self.buckets.get(key, (capacity, now))
            tokens = min(capacity, tokens + max(0, now - previous) * rate / 60)
            if tokens < 1:
                self.buckets[key] = (tokens, now)
                retry = max(1, math.ceil((1 - tokens) * 60 / rate))
                raise HTTPException(429, 'tenant request rate exceeded', headers={'Retry-After': str(retry)})
            self.buckets[key] = (tokens - 1, now)
