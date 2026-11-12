from __future__ import annotations

import hashlib
import json
import os
import threading
import hmac
import asyncio
import time
import shutil
from functools import wraps
from pathlib import Path
from typing import Literal

import chromadb
import httpx
from chroma_transport import configure_transport
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from starlette.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from execution import EmbeddingWorker, acquire, deadline, remaining
from credentials import read_grants
from ranking import lexical, fuse
from quotas import check_storage, TenantRateLimit

DATA_DIR = Path(os.getenv("KB_DATA_DIR", "/data"))
STATE_PATH = DATA_DIR / "index-state.json"
COLLECTION_NAME = os.getenv("KB_COLLECTION", "portfolioai-approved-v1")
MODEL_NAME = os.getenv("KB_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
API_KEY = os.getenv("KB_API_KEY", "change-me")
MAX_FACTS = int(os.getenv("KB_MAX_FACTS", "2000"))
GRANTS = json.loads(os.getenv("KB_CALLER_GRANTS", "{}"))
tenant_rate_limit = TenantRateLimit()


class BodyLimit:
    def __init__(self, app):
        self.app = app
        self.active = 0
        self.max_active = 16
        self.body_timeout = 10
        self.request_timeout = 60

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        if self.active >= self.max_active:
            return await JSONResponse({'detail': 'service busy'}, status_code=503, headers={'Retry-After': '1'})(scope, receive, send)
        self.active += 1
        try:
            await self.handle(scope, receive, send)
        finally:
            self.active -= 1

    async def handle(self, scope, receive, send):
        body = bytearray()
        body_deadline = time.monotonic() + self.body_timeout
        while True:
            try:
                message = await asyncio.wait_for(receive(), timeout=max(0, body_deadline - time.monotonic()))
            except asyncio.TimeoutError:
                return await JSONResponse({'detail': 'request body timed out'}, status_code=408)(scope, receive, send)
            if message['type'] == 'http.disconnect':
                return
            body.extend(message.get('body', b''))
            if len(body) > 1_048_576:
                return await JSONResponse({'detail': 'request exceeds 1 MiB'}, status_code=413)(scope, receive, send)
            if not message.get('more_body', False):
                break
        delivered = False
        async def replay():
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
        token = deadline.set(time.monotonic() + self.request_timeout)
        started = False
        async def tracked_send(message):
            nonlocal started
            if message['type'] == 'http.response.start':
                started = True
            await send(message)
        try:
            await asyncio.wait_for(self.app(scope, replay, tracked_send), timeout=self.request_timeout)
        except asyncio.TimeoutError:
            if not started:
                await JSONResponse({'detail': 'operation deadline exceeded; check status before retrying'}, status_code=504)(scope, replay, send)
        finally:
            deadline.reset(token)

app = FastAPI(title="PortfolioAI Knowledge Base", version="1.0.0")
app.add_middleware(BodyLimit)


@app.exception_handler(httpx.TransportError)
async def transport_unavailable(request, exc):
    return JSONResponse({'detail': 'knowledge base temporarily unavailable; retry the same operation payload'},
                        status_code=503, headers={'Retry-After': '1'})


lock = threading.RLock()
client: chromadb.HttpClient | None = None
collection = None
embedder: EmbeddingWorker | None = None


class Fact(BaseModel):
    section: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=4000)
    source_label: str | None = Field(default=None, max_length=200)
    fact_id: str = Field(min_length=1, max_length=120)


class IndexRequest(BaseModel):
    subject: str = Field(default="", max_length=120)
    operation: Literal["index"] = "index"
    tenant_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,100}$")
    profile_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,100}$")
    profile_version: int = Field(ge=1)
    generation: int = Field(ge=1)
    contract_version: Literal["approved-profile-v1"] = "approved-profile-v1"
    embedding_model: str = Field(default=MODEL_NAME, min_length=1, max_length=200)
    facts: list[Fact] = Field(min_length=1, max_length=MAX_FACTS)

    @field_validator("facts")
    @classmethod
    def unique_fact_ids(cls, facts: list[Fact]) -> list[Fact]:
        ids = [fact.fact_id for fact in facts]
        if len(ids) != len(set(ids)):
            raise ValueError("fact_id values must be unique")
        return facts


class PurgeRequest(BaseModel):
    operation: Literal["purge"] = "purge"
    tenant_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,100}$")
    profile_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,100}$")
    generation: int = Field(ge=1)


class ReconcileRequest(BaseModel):
    tenant_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,100}$")
    profile_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,100}$")


class QueryRequest(BaseModel):
    mode: Literal['dense', 'hybrid'] = 'dense'
    tenant_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,100}$")
    profile_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,100}$")
    query: str = Field(min_length=1, max_length=1000)
    top_k: int = Field(default=5, ge=1, le=20)


def require_key(x_kb_api_key: str | None = Header(default=None)) -> None:
    if not x_kb_api_key or not hmac.compare_digest(x_kb_api_key.encode(), API_KEY.encode()) or API_KEY == "change-me":
        raise HTTPException(status_code=401, detail="invalid knowledge-base credentials")


async def require_scope(request: Request, x_kb_api_key: str | None = Header(default=None)):
    digest = hashlib.sha256((x_kb_api_key or '').encode()).hexdigest()
    try:
        grants = read_grants() if (DATA_DIR / 'caller-grants.json').exists() else GRANTS
    except (OSError, ValueError):
        raise HTTPException(503, 'caller authorization configuration unavailable')
    grant = grants.get(digest)
    if not grant:
        raise HTTPException(status_code=401, detail="invalid caller credentials")
    operation = request.url.path.rsplit('/', 1)[-1]
    try:
        data = dict(request.query_params) if request.method == 'GET' else await request.json()
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=422, detail="invalid JSON body")
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="expected object")
    if not isinstance(data.get('tenant_id'), str) or not isinstance(data.get('profile_id'), str):
        raise HTTPException(status_code=422, detail="tenant_id and profile_id must be strings")
    allowed_profiles = grant.get('profiles', {})
    profiles = allowed_profiles.get(data.get('tenant_id'), [])
    if operation not in grant.get('operations', []) or (data.get('profile_id') not in profiles and '*' not in profiles):
        raise HTTPException(status_code=403, detail="caller scope denied")
    tenant_rate_limit.check(data['tenant_id'], operation)


def load_state() -> dict[str, dict[str, int]]:
    if not STATE_PATH.exists():
        return {}
    return json.loads(STATE_PATH.read_text(encoding="utf-8"))


def save_state(state: dict[str, dict[str, int]]) -> None:
    tmp = STATE_PATH.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as stream:
        json.dump(state, stream, sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    tmp.replace(STATE_PATH)
    if os.name != 'nt':
        directory = os.open(DATA_DIR, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)


def serialized(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        with acquire(lock):
            return fn(*args, **kwargs)
    return wrapped


def cleanup_snapshots(col, tenant_id, profile_id, snapshot, generation=None):
    """Caller holds the write lock; only remove records outside the active snapshot."""
    where = {"$and": [{"tenant_id": tenant_id}, {"profile_id": profile_id}]}
    offset = 0
    for _ in range(50):
        page = col.get(where=where, limit=200, offset=offset, include=['metadatas'])
        if not page['ids']:
            return False
        stale = [record_id for record_id, meta in zip(page['ids'], page['metadatas'])
                 if (meta.get('snapshot') != snapshot if snapshot is not None
                     else meta.get('generation') != generation)]
        if stale:
            col.delete(ids=stale)
        offset += len(page['ids']) - len(stale)
    return True


def finish_index(col, req, current):
    try:
        pending = cleanup_snapshots(col, req.tenant_id, req.profile_id, current['snapshot'])
    except Exception:
        # Activation is already committed. Exact replay retries cleanup.
        pending = True
    return {"status": "indexed", **current, "profile_id": req.profile_id, "cleanup_pending": pending}


@serialized
def resources():
    global client, collection, embedder
    if client is None:
        configure_transport()
        try:
            client = chromadb.HttpClient(host=os.getenv("CHROMA_HOST", "chroma"), port=int(os.getenv("CHROMA_PORT", "8000")))
        except Exception as exc:
            raise HTTPException(status_code=503, detail="knowledge base connection unavailable", headers={'Retry-After': '1'}) from exc
    if collection is None:
        collection = client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine", "contract_version": "approved-profile-v1", "embedding_model": MODEL_NAME},
        )
    if embedder is None:
        embedder = EmbeddingWorker(os.getenv("KB_MODEL_PATH", MODEL_NAME))
    return collection, embedder


@app.get("/health/live")
def live():
    return {"status": "live"}


@app.get("/health/ready")
def ready(_: None = Depends(require_key)):
    try:
        col, _ = resources()
        col.count()
        return {"status": "ready", "collection": COLLECTION_NAME, "embedding_model": MODEL_NAME}
    except Exception as exc:
        raise HTTPException(status_code=503, detail="knowledge base is not ready") from exc


@app.post("/v1/index", dependencies=[Depends(require_scope)])
def index(req: IndexRequest):
    key = f"{req.tenant_id}:{req.profile_id}"
    with acquire(lock):
        state = load_state()
        current = state.get(key)
        digest = hashlib.sha256(json.dumps(req.model_dump(), sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        if req.embedding_model != MODEL_NAME:
            raise HTTPException(status_code=409, detail="embedding model mismatch")
        if current and current.get("purged") and req.generation <= current["generation"]:
            raise HTTPException(status_code=409, detail="stale profile generation after purge")
        if current and req.generation <= current["generation"]:
            if req.generation < current["generation"] or req.profile_version < current["profile_version"]:
                raise HTTPException(status_code=409, detail="stale profile generation")
            if current.get("snapshot") != digest:
                raise HTTPException(status_code=409, detail="generation payload conflict; use a new generation")
            col, _ = resources()
            return finish_index(col, req, current)
        if current and req.profile_version < current["profile_version"]:
            raise HTTPException(status_code=409, detail="stale profile version")
        staged = (current or {}).get('pending')
        if staged and (req.generation < staged['generation'] or
                       (req.generation == staged['generation'] and staged['snapshot'] != digest)):
            raise HTTPException(409, 'pending generation payload conflict')
        check_storage(state, req.tenant_id, req.profile_id, len(req.facts))
        check_disk_space()
        col, model = resources()
        if staged:
            # Remove only IDs belonging to the recorded interrupted stage.
            col.delete(where={'$and': [{'tenant_id': req.tenant_id}, {'profile_id': req.profile_id}, {'snapshot': staged['snapshot']}]})
        state[key] = {**(current or {'generation': 0, 'profile_version': 0, 'count': 0}),
                      'pending': {'generation': req.generation, 'snapshot': digest}}
        save_state(state)
        ids = [f"{req.tenant_id}:{req.profile_id}:{digest}:{fact.fact_id}" for fact in req.facts]
        documents = [fact.text for fact in req.facts]
        metadata = [
            {
                "tenant_id": req.tenant_id,
                "profile_id": req.profile_id,
                "profile_version": req.profile_version,
                "generation": req.generation,
                "snapshot": digest,
                "fact_id": fact.fact_id,
                "section": fact.section,
                "source_label": fact.source_label or "approved-profile",
                "content_hash": hashlib.sha256(fact.text.encode()).hexdigest(),
                "embedding_model": req.embedding_model,
                "contract_version": req.contract_version,
            }
            for fact in req.facts
        ]
        embedding_inputs = [f"Profile: {req.subject}\nSection: {fact.section}\n{fact.text}" for fact in req.facts]
        vectors = model.encode(embedding_inputs, normalize_embeddings=True).tolist()
        col.upsert(ids=ids, documents=documents, metadatas=metadata, embeddings=vectors)
        if len(col.get(ids=ids, include=[])["ids"]) != len(ids):
            raise HTTPException(status_code=503, detail="incomplete staged index")
        remaining()
        state[key] = {"profile_version": req.profile_version, "generation": req.generation, "count": len(ids), "snapshot": digest}
        save_state(state)
        return finish_index(col, req, state[key])


def check_disk_space():
    # Reserve headroom for state/tombstone writes. This is admission control,
    # not a filesystem quota or a guarantee against other disk writers.
    paths = [DATA_DIR]
    if os.getenv('KB_CHROMA_DATA_DIR'):
        paths.append(Path(os.environ['KB_CHROMA_DATA_DIR']))
    try:
        if any(shutil.disk_usage(path).free < 512 * 1024 * 1024 for path in paths):
            raise HTTPException(507, 'insufficient storage headroom')
    except OSError as exc:
        raise HTTPException(503, 'storage capacity unavailable') from exc


@app.post('/v1/reconcile', dependencies=[Depends(require_scope)])
@serialized
def reconcile(req: ReconcileRequest):
    current = load_state().get(f'{req.tenant_id}:{req.profile_id}')
    if not current:
        # Missing state could mean a lost state file; never guess which data to delete.
        raise HTTPException(404, 'profile index state not found')
    if not current.get('purged') and not current.get('snapshot') and 'generation' not in current:
        raise HTTPException(503, 'profile index state incomplete')
    col, _ = resources()
    if current.get('pending') and current.get('generation') == 0:
        col.delete(where={'$and': [{'tenant_id': req.tenant_id}, {'profile_id': req.profile_id},
                                 {'snapshot': current['pending']['snapshot']}]})
        pending = False
    elif current.get('purged'):
        col.delete(where={'$and': [{'tenant_id': req.tenant_id}, {'profile_id': req.profile_id}]})
        pending = False
    else:
        pending = cleanup_snapshots(col, req.tenant_id, req.profile_id,
                                    current.get('snapshot'), current.get('generation'))
    return {'status': 'reconciled', 'cleanup_pending': pending}


@app.get("/v1/status", dependencies=[Depends(require_scope)])
def status(tenant_id: str, profile_id: str):
    key = f"{tenant_id}:{profile_id}"
    with acquire(lock):
        state = load_state()
        current = state.get(key)
        if not current:
            raise HTTPException(status_code=404, detail="profile index state not found")
        return {"status": "ok", "tenant_id": tenant_id, "profile_id": profile_id, **current}


@app.post("/v1/purge", dependencies=[Depends(require_scope)])
def purge(req: PurgeRequest):
    key = f"{req.tenant_id}:{req.profile_id}"
    with acquire(lock):
        state = load_state()
        current = state.get(key)
        if current and req.generation < max(current["generation"], current.get('pending', {}).get('generation', 0)):
            raise HTTPException(status_code=409, detail="stale purge generation")
        # Existing profiles can always be withdrawn, even if limits were lowered.
        if current is None:
            check_storage(state, req.tenant_id, req.profile_id, None)
        state[key] = {"generation": req.generation, "profile_version": current.get("profile_version", 0) if current else 0, "purged": True, "count": 0}
        save_state(state)
        col, _ = resources()
        col.delete(where={"$and": [{"tenant_id": req.tenant_id}, {"profile_id": req.profile_id}]})
        return {"status": "purged", "profile_id": req.profile_id}


@app.post("/v1/query", dependencies=[Depends(require_scope)])
@serialized
def query(req: QueryRequest):
    current = load_state().get(f"{req.tenant_id}:{req.profile_id}")
    if not current or current.get("purged") or current.get('generation') == 0:
        return {"results": []}
    filters = [{"tenant_id": req.tenant_id}, {"profile_id": req.profile_id}]
    if current.get("snapshot"):
        filters.append({"snapshot": current["snapshot"]})
    else:
        filters.append({"generation": current["generation"]})
    col, model = resources()
    vector = model.encode([req.query], normalize_embeddings=True).tolist()
    result = col.query(
        query_embeddings=vector,
        n_results=20 if req.mode == 'hybrid' else req.top_k,
        where={"$and": filters},
        include=["documents", "metadatas", "distances"],
    )
    rows = []
    for doc, meta, distance in zip(result["documents"][0], result["metadatas"][0], result["distances"][0]):
        rows.append({"text": doc, "metadata": meta, "distance": distance})
    if req.mode == 'hybrid':
        corpus = col.get(where={"$and": filters}, limit=MAX_FACTS + 1, include=['documents', 'metadatas'])
        if len(corpus['ids']) > MAX_FACTS:
            raise HTTPException(status_code=503, detail='profile exceeds hybrid retrieval limit')
        ranked = lexical(req.query, [meta['section'] + ' ' + doc for meta, doc in zip(corpus['metadatas'], corpus['documents'])])[:20]
        ordered = fuse(result['ids'][0], [corpus['ids'][i] for i in ranked])
        records = {record_id: {'text': doc, 'metadata': meta, 'distance': None}
            for record_id, doc, meta in zip(corpus['ids'], corpus['documents'], corpus['metadatas'])}
        for record_id, row in zip(result['ids'][0], rows):
            records[record_id] = row
        rows = [records[record_id] for record_id in ordered[:req.top_k]]
    return {"results": rows}
