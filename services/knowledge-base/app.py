from __future__ import annotations

import hashlib
import json
import os
import threading
from pathlib import Path
from typing import Literal

import chromadb
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, field_validator
from sentence_transformers import SentenceTransformer

DATA_DIR = Path(os.getenv("KB_DATA_DIR", "/data"))
STATE_PATH = DATA_DIR / "index-state.json"
COLLECTION_NAME = os.getenv("KB_COLLECTION", "portfolioai-approved-v1")
MODEL_NAME = os.getenv("KB_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
API_KEY = os.getenv("KB_API_KEY", "change-me")
MAX_FACTS = int(os.getenv("KB_MAX_FACTS", "2000"))

app = FastAPI(title="PortfolioAI Knowledge Base", version="1.0.0")
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
    if not x_kb_api_key or x_kb_api_key != API_KEY or API_KEY == "change-me":
        raise HTTPException(status_code=401, detail="invalid knowledge-base credentials")


def load_state() -> dict[str, dict[str, int]]:
    if not STATE_PATH.exists():
        return {}
    return json.loads(STATE_PATH.read_text(encoding="utf-8"))


def save_state(state: dict[str, dict[str, int]]) -> None:
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, sort_keys=True), encoding="utf-8")
    tmp.replace(STATE_PATH)


def resources():
    global client, collection, embedder
    if client is None:
        client = chromadb.HttpClient(host=os.getenv("CHROMA_HOST", "chroma"), port=int(os.getenv("CHROMA_PORT", "8000")))
        collection = client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine", "contract_version": "approved-profile-v1", "embedding_model": MODEL_NAME},
        )
    if embedder is None:
        embedder = SentenceTransformer(MODEL_NAME)
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


@app.post("/v1/index")
def index(req: IndexRequest, _: None = Depends(require_key)):
    key = f"{req.tenant_id}:{req.profile_id}"
    with lock:
        state = load_state()
        current = state.get(key)
        if current and req.generation <= current["generation"]:
            if req.generation < current["generation"] or req.profile_version < current["profile_version"]:
                raise HTTPException(status_code=409, detail="stale profile generation")
        col, model = resources()
        ids = [f"{req.tenant_id}:{req.profile_id}:{req.profile_version}:{fact.fact_id}" for fact in req.facts]
        documents = [fact.text for fact in req.facts]
        metadata = [
            {
                "tenant_id": req.tenant_id,
                "profile_id": req.profile_id,
                "profile_version": req.profile_version,
                "generation": req.generation,
                "section": fact.section,
                "source_label": fact.source_label or "approved-profile",
                "content_hash": hashlib.sha256(fact.text.encode()).hexdigest(),
                "embedding_model": req.embedding_model,
                "contract_version": req.contract_version,
            }
            for fact in req.facts
        ]
        vectors = model.encode(documents, normalize_embeddings=True).tolist()
        col.delete(where={"$and": [{"tenant_id": req.tenant_id}, {"profile_id": req.profile_id}]})
        col.upsert(ids=ids, documents=documents, metadatas=metadata, embeddings=vectors)
        state[key] = {"profile_version": req.profile_version, "generation": req.generation, "count": len(ids)}
        save_state(state)
        return {"status": "indexed", **state[key], "profile_id": req.profile_id}


@app.post("/v1/purge")
def purge(req: PurgeRequest, _: None = Depends(require_key)):
    key = f"{req.tenant_id}:{req.profile_id}"
    with lock:
        state = load_state()
        current = state.get(key)
        if current and req.generation < current["generation"]:
            raise HTTPException(status_code=409, detail="stale purge generation")
        col, _ = resources()
        col.delete(where={"$and": [{"tenant_id": req.tenant_id}, {"profile_id": req.profile_id}]})
        state.pop(key, None)
        save_state(state)
        return {"status": "purged", "profile_id": req.profile_id}


@app.post("/v1/query")
def query(req: QueryRequest, _: None = Depends(require_key)):
    col, model = resources()
    vector = model.encode([req.query], normalize_embeddings=True).tolist()
    result = col.query(
        query_embeddings=vector,
        n_results=req.top_k,
        where={"$and": [{"tenant_id": req.tenant_id}, {"profile_id": req.profile_id}]},
        include=["documents", "metadatas", "distances"],
    )
    rows = []
    for doc, meta, distance in zip(result["documents"][0], result["metadatas"][0], result["distances"][0]):
        rows.append({"text": doc, "metadata": meta, "distance": distance})
    return {"results": rows}
