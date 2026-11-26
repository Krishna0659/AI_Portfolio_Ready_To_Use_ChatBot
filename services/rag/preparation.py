"""RAG preparation only: no credentials, embeddings, storage or publication."""
from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unicodedata
from observability import observed

PIPELINE_VERSION = "rag-prep-v2"
EXTRACTOR_VERSION = "rag-extract-v2"
CHUNKING_VERSION = "section-parents-4000-v2"
MAX_BYTES = 10 * 1024 * 1024
MAX_TEXT = 200_000
MAX_CHUNKS = 500
MAX_CHUNK = 4000
FORMATS = {"pdf", "docx", "html", "md", "txt"}
ANSWER_STATUSES = {"answered", "insufficient_evidence", "profile_unavailable",
                   "retrieval_timeout", "generation_timeout", "service_unavailable"}


class PreparationError(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFC", text)
    if any(unicodedata.category(c) == "Cc" and c not in "\n\r\t" for c in text):
        raise PreparationError("unsafe_text")
    return "\n".join(re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()).strip()


@dataclass(frozen=True)
class Scope:
    # Supplied by an authenticated caller, never extracted from document text.
    tenant_id: str
    profile_id: str
    document_id: str
    document_version: int
    generation: int
    source_type: str
    source_label: str
    embedding_model: str

    def __post_init__(self):
        for value in (self.tenant_id, self.profile_id, self.document_id):
            if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", value):
                raise PreparationError("invalid_scope")
        for value in (self.document_version, self.generation):
            if type(value) is not int or value < 1:
                raise PreparationError("invalid_version")
        for value in (self.source_type, self.source_label, self.embedding_model):
            if not isinstance(value, str) or not value.strip() or len(value) > 200 or normalize(value) != value:
                raise PreparationError("invalid_metadata")


@observed('extraction')
def extract(data: bytes, kind: str, timeout: float = 15) -> dict:
    if kind not in FORMATS:
        raise PreparationError("unsupported_format")
    if not isinstance(data, bytes) or not data or len(data) > MAX_BYTES:
        raise PreparationError("input_size")
    if not 0 < timeout <= 30:
        raise PreparationError("invalid_timeout")
    # The child receives no inherited provider/application credentials or working files.
    # Production additionally requires the OS network/memory sandbox described in README.
    with tempfile.TemporaryDirectory(prefix="rag-extract-") as work:
        try:
            result = subprocess.run(
                [sys.executable, "-I", str(Path(__file__).with_name("extract_worker.py")), kind],
                input=data, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                env={}, cwd=work, timeout=timeout, check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise PreparationError("extraction_timeout") from exc
        except OSError as exc:
            raise PreparationError("extractor_unavailable") from exc
    if result.returncode:
        raise PreparationError("invalid_or_unsafe_document")
    try:
        document = json.loads(result.stdout)
        blocks = document["blocks"]
        if not isinstance(document["title"], str) or not isinstance(blocks, list) or not blocks:
            raise ValueError()
        total = 0
        for block in blocks:
            if set(block) != {"section", "text"}:
                raise ValueError()
            block["section"] = normalize(block["section"])
            block["text"] = normalize(block["text"])
            total += len(block["text"]) + len(block["section"])
        if not any(b["text"] for b in blocks) or total > MAX_TEXT or len(blocks) > 10_000:
            raise ValueError()
    except (ValueError, TypeError, KeyError) as exc:
        raise PreparationError("invalid_extraction") from exc
    return {**document, "source_content_hash": digest(data), "extractor_version": EXTRACTOR_VERSION}


def split_block(text: str, limit: int):
    """Only split an oversized paragraph/list item, and never cut a token."""
    while len(text) > limit:
        boundary = text.rfind(" ", 0, limit + 1)
        if boundary < 1:
            raise PreparationError("oversized_identifier")
        yield text[:boundary]
        text = text[boundary:].lstrip()
    if text:
        yield text


@observed('preparation')
def prepare(data: bytes, kind: str, scope: Scope) -> dict:
    if not isinstance(scope, Scope):
        raise PreparationError("invalid_scope")
    document = extract(data, kind)
    chunks, seen = [], set()
    section, pending = "", ""

    def flush():
        nonlocal pending
        if not pending:
            return
        content_hash = digest(pending.encode())
        identity = digest(json.dumps([CHUNKING_VERSION, section, pending], ensure_ascii=False).encode())
        if identity not in seen:
            seen.add(identity)
            metadata = {**asdict(scope), "chunk_id": f"{scope.document_id}:{identity[:32]}",
                        "section": section, "content_hash": content_hash,
                        "source_content_hash": document["source_content_hash"],
                        "pipeline_version": PIPELINE_VERSION, "chunking_version": CHUNKING_VERSION,
                        "extractor_version": EXTRACTOR_VERSION}
            chunks.append({"text": pending, "metadata": metadata})
            if len(chunks) > MAX_CHUNKS:
                raise PreparationError("too_many_chunks")
        pending = ""

    for block in document["blocks"]:
        next_section = block["section"] or "Document"
        if len(next_section) > 500:
            raise PreparationError("section_size")
        if next_section != section:
            flush()
            section = next_section
        for part in split_block(block["text"], MAX_CHUNK):
            if pending and len(pending) + 2 + len(part) > MAX_CHUNK:
                flush()
            pending = pending + "\n\n" + part if pending else part
    flush()
    if not chunks:
        raise PreparationError("empty_document")
    return {"title": document["title"], "source_content_hash": document["source_content_hash"],
            "pipeline_version": PIPELINE_VERSION, "chunks": chunks}
