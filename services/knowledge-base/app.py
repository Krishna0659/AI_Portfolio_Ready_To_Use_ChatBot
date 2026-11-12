from __future__ import annotations

import hashlib
import json
import os
import threading
import hmac
from functools import wraps
from pathlib import Path
from typing import Literal

import chromadb
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from starlette.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from sentence_transformers import SentenceTransformer

DATA_DIR = Path(os.getenv("KB_DATA_DIR", "/data"))
STATE_PATH = DATA_DIR / "index-state.json"
COLLECTION_NAME = os.getenv("KB_COLLECTION", "portfolioai-approved-v1")
MODEL_NAME = os.getenv("KB_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
API_KEY = os.getenv("KB_API_KEY", "change-me")
MAX_FACTS = int(os.getenv("KB_MAX_FACTS", "2000"))
GRANTS = json.loads(os.getenv("KB_CALLER_GRANTS", "{}"))


class BodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        body = bytearray()
        while True:
            message = await receive()
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
        await self.app(scope, replay, send)

app = FastAPI(title="PortfolioAI Knowledge Base", version="1.0.0")
app.add_middleware(BodyLimit)
lock = threading.RLock()
client: chromadb.HttpClient | None = None
collection = None
embedder: SentenceTransformer | None = None


class Fact(BaseModel):
    section: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=4000)
    source_label: str | None = Field(default=None, max_length=200)
    fact_id: str = Field(min_length=1, max_length=120)


class IndexRequest(BaseModel):
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


class QueryRequest(BaseModel):
    tenant_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,100}$")
    profile_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,100}$")
    query: str = Field(min_length=1, max_length=1000)
    top_k: int = Field(default=5, ge=1, le=20)


def require_key(x_kb_api_key: str | None = Header(default=None)) -> None:
    if not x_kb_api_key or not hmac.compare_digest(x_kb_api_key.encode(), API_KEY.encode()) or API_KEY == "change-me":
        raise HTTPException(status_code=401, detail="invalid knowledge-base credentials")


async def require_scope(request: Request, x_kb_api_key: str | None = Header(default=None)):
    digest = hashlib.sha256((x_kb_api_key or '').encode()).hexdigest()
    grant = GRANTS.get(digest)
    if not grant:
        raise HTTPException(status_code=401, detail="invalid caller credentials")
    operation = request.url.path.rsplit('/', 1)[-1]
    data = dict(request.query_params) if request.method == 'GET' else await request.json()
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="expected object")
    allowed_profiles = grant.get('profiles', {})
    profiles = allowed_profiles.get(data.get('tenant_id'), [])
    if operation not in grant.get('operations', []) or (data.get('profile_id') not in profiles and '*' not in profiles):
        raise HTTPException(status_code=403, detail="caller scope denied")


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


def serialized(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        with lock:
            return fn(*args, **kwargs)
    return wrapped


def cleanup_snapshots(col, tenant_id, profile_id, snapshot):
    """Caller holds the write lock; only remove records outside the active snapshot."""
    where = {"$and": [{"tenant_id": tenant_id}, {"profile_id": profile_id}]}
    offset = 0
    while True:
        page = col.get(where=where, limit=200, offset=offset, include=['metadatas'])
        if not page['ids']:
            return
        stale = [record_id for record_id, meta in zip(page['ids'], page['metadatas'])
                 if meta.get('snapshot') != snapshot]
        if stale:
            col.delete(ids=stale)
        offset += len(page['ids']) - len(stale)


def finish_index(col, req, current):
    try:
        cleanup_snapshots(col, req.tenant_id, req.profile_id, current['snapshot'])
        pending = False
    except Exception:
        # Activation is already committed. Exact replay retries cleanup.
        pending = True
    return {"status": "indexed", **current, "profile_id": req.profile_id, "cleanup_pending": pending}


def resources():
    global client, collection, embedder
    if client is None:
        client = chromadb.HttpClient(host=os.getenv("CHROMA_HOST", "chroma"), port=int(os.getenv("CHROMA_PORT", "8000")))
        collection = client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine", "contract_version": "approved-profile-v1", "embedding_model": MODEL_NAME},
        )
    if embedder is None:
        embedder = SentenceTransformer(os.getenv("KB_MODEL_PATH", MODEL_NAME))
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
    with lock:
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
        col, model = resources()
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
        vectors = model.encode(documents, normalize_embeddings=True).tolist()
        col.upsert(ids=ids, documents=documents, metadatas=metadata, embeddings=vectors)
        if len(col.get(ids=ids, include=[])["ids"]) != len(ids):
            raise HTTPException(status_code=503, detail="incomplete staged index")
        state[key] = {"profile_version": req.profile_version, "generation": req.generation, "count": len(ids), "snapshot": digest}
        save_state(state)
        return finish_index(col, req, state[key])


@app.get("/v1/status", dependencies=[Depends(require_scope)])
def status(tenant_id: str, profile_id: str):
    key = f"{tenant_id}:{profile_id}"
    with lock:
        state = load_state()
        current = state.get(key)
        if not current:
            raise HTTPException(status_code=404, detail="profile index state not found")
        return {"status": "ok", "tenant_id": tenant_id, "profile_id": profile_id, **current}


@app.post("/v1/purge", dependencies=[Depends(require_scope)])
def purge(req: PurgeRequest):
    key = f"{req.tenant_id}:{req.profile_id}"
    with lock:
        state = load_state()
        current = state.get(key)
        if current and req.generation < current["generation"]:
            raise HTTPException(status_code=409, detail="stale purge generation")
        state[key] = {"generation": req.generation, "profile_version": current.get("profile_version", 0) if current else 0, "purged": True, "count": 0}
        save_state(state)
        col, _ = resources()
        col.delete(where={"$and": [{"tenant_id": req.tenant_id}, {"profile_id": req.profile_id}]})
        return {"status": "purged", "profile_id": req.profile_id}


@app.post("/v1/query", dependencies=[Depends(require_scope)])
@serialized
def query(req: QueryRequest):
    current = load_state().get(f"{req.tenant_id}:{req.profile_id}")
    if not current or current.get("purged"):
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
        n_results=req.top_k,
        where={"$and": filters},
        include=["documents", "metadatas", "distances"],
    )
    rows = []
    for doc, meta, distance in zip(result["documents"][0], result["metadatas"][0], result["distances"][0]):
        rows.append({"text": doc, "metadata": meta, "distance": distance})
    return {"results": rows}
