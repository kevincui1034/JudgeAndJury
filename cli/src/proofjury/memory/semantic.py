"""Semantic memory — recall by MEANING, on an embedded local vector DB.

Recall today is heuristic: failure-class overlap, then shared evidence
tokens (env-var names, file:line anchors), then recency. That misses the
case this module exists for — the same underlying mistake described in
different words ("payment key unset" vs "missing STRIPE_API_KEY").

Actian VectorAI DB is the store because it runs LOCAL and portable: the
Community Edition listens on localhost, so vectors never leave the
machine and the same client works from a laptop to a CI runner. Analysis
stays local; the only network hop is the embedding call, which reuses the
already-configured judge transport (H1) and sends the same scrubbed text
the judge already sees.

Note the client takes an ADDRESS (``localhost:6574``), not a directory —
VectorAI DB is a local server process, not a file-backed embedded store.

Authority rules (enforced in ``recall.py``, asserted in tests):

- Semantic hits are ADDITIVE context. They can surface a prior the
  class-filter missed and re-rank one it found, but they never
  strong-match on their own — ``strong_match`` independently requires an
  identical failure-class set, which a semantic-only hit cannot satisfy.
- ``EXCLUDED_RESOLUTIONS`` still applies: a human-judged false positive
  never returns through the vector door.

Everything degrades: no Actian library, no embedding key, or any error →
``get_index`` returns None and recall behaves exactly as it did before
this module existed.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
from typing import Iterable, Mapping, Protocol, Sequence, runtime_checkable

import httpx

from .schema import MemoryRecord

TIMEOUT_SECONDS = 10.0
DEFAULT_EMBED_MODEL = "text-embedding-3-small"

#: Actian VectorAI DB Community Edition's default local address.
DEFAULT_DSN = "localhost:6574"

#: Local scratch dir under .proofjury/ (offline fallback backend only).
VECTOR_DIRNAME = "vector"

_CHAT_SUFFIX = "/chat/completions"
_EMBED_SUFFIX = "/embeddings"

#: Document kinds in the index — kept in the id namespace so one store can
#: serve both gate records and checkpoint corrections without collisions.
KIND_RECORD = "record"
KIND_CORRECTION = "correction"


# --------------------------------------------------------------------------
# backend
# --------------------------------------------------------------------------


@runtime_checkable
class VectorBackend(Protocol):
    """Minimal surface Proofjury needs from a vector store."""

    def upsert(self, doc_id: str, vector: Sequence[float], metadata: dict) -> None:
        ...

    def search(self, vector: Sequence[float], k: int) -> list[tuple[str, float]]:
        ...


def open_actian_backend(dsn: str) -> VectorBackend | None:
    """Connect to Actian VectorAI DB at ``dsn`` (``host:port``).

    THIS IS THE ONE ACTIAN-SPECIFIC FUNCTION. Everything else in this
    module is written against the ``VectorBackend`` protocol and is
    tested without the SDK.

    Returns None when the client library is not installed or the server
    is not reachable — which is what makes the whole feature degrade to
    today's heuristic recall rather than break the gate.
    """
    try:
        from actian_vectorai import VectorAIClient  # type: ignore[import-not-found]
    except Exception:
        return None
    try:
        client = VectorAIClient(dsn)
        # REQUIRED: the client is lazy — `collections`/`points` raise
        # ConnectionError (503) until connect() has run. Verified against
        # actian-vectorai-client 1.0.x.
        client.connect()
        client.health_check()
        return _ActianBackend(client)
    except Exception:
        return None


def _point_id(doc_id: str) -> int:
    """Stable unsigned 63-bit id for a Proofjury record id.

    Actian point ids must be an integer or a valid UUID — a plain string
    like "chk_012" is rejected with 422 ("String ID must be a valid
    UUID"), verified against a live server. Hashing keeps upserts
    idempotent for the same record, and the original string rides along
    in the payload so search results map back exactly.
    """
    return int.from_bytes(hashlib.sha1(doc_id.encode("utf-8")).digest()[:8], "big") >> 1


class _ActianBackend:  # pragma: no cover — exercised only with the SDK present
    """Adapter from the Actian client to the ``VectorBackend`` protocol.

    The collection is created lazily on first upsert because its vector
    size must match the embedder actually in use (1536 for
    text-embedding-3-small, 128 for the offline HashEmbedder) — there is
    no correct dimension to guess at connect time.
    """

    COLLECTION = "proofjury_memory"

    def __init__(self, client):
        self._client = client
        self._ready = False

    def _ensure_collection(self, size: int, force: bool = False) -> None:
        """Create the collection once, on first use.

        Checked with exists() rather than create-and-swallow: blanket
        swallowing logged a server-side error on EVERY call after the
        first, and would equally have hidden a genuine create failure —
        which then surfaces later as a confusing CollectionNotFound on
        upsert. Creation races benignly (two gates starting at once both
        create), so an "already exists" failure is tolerated.

        ``force`` skips the exists() probe. That matters because exists()
        can LIE: after a server restart it answered True while the very
        next upsert 404'd, so the recovery path must attempt creation
        rather than trust it.
        """
        if self._ready and not force:
            return
        from actian_vectorai import Distance, VectorParams  # type: ignore

        if force or not self._client.collections.exists(self.COLLECTION):
            try:
                self._client.collections.create(
                    self.COLLECTION,
                    vectors_config=VectorParams(size=size, distance=Distance.Cosine),
                )
            except Exception:
                # Already there (a race, or the stale-exists case) — fine.
                # The caller retries the real operation and surfaces any
                # genuine failure at its best-effort boundary.
                pass
        self._ready = True

    # KNOWN LIMITATION (measured, not theorised): if the server restarts
    # while this client is alive, the collection is gone and every later
    # call 404s. Neither re-creating nor client.connect() recovers it — the
    # channel and the server's collection state are both stale. It is left
    # unhandled on purpose: each gate run builds a fresh client, so this
    # only bites a long-lived process, and the caller's best-effort
    # boundary already degrades it to "no semantic recall" with no crash
    # and no change to the verdict.

    def upsert(self, doc_id: str, vector: Sequence[float], metadata: dict) -> None:
        from actian_vectorai import PointStruct  # type: ignore

        vector = list(vector)
        self._ensure_collection(len(vector))
        payload = {**metadata, "doc_id": doc_id}
        self._client.points.upsert(
            self.COLLECTION,
            [PointStruct(id=_point_id(doc_id), vector=vector, payload=payload)],
        )

    def search(self, vector: Sequence[float], k: int) -> list[tuple[str, float]]:
        vector = list(vector)
        self._ensure_collection(len(vector))
        hits = self._client.points.search(self.COLLECTION, vector=vector, limit=k)
        out: list[tuple[str, float]] = []
        for hit in hits:
            doc_id = (getattr(hit, "payload", None) or {}).get("doc_id")
            if doc_id:
                out.append((str(doc_id), float(getattr(hit, "score", 0.0) or 0.0)))
        return out


# --------------------------------------------------------------------------
# embedding
# --------------------------------------------------------------------------


@runtime_checkable
class Embedder(Protocol):
    def embed(self, text: str) -> list[float]:
        ...


class HttpEmbedder:
    """OpenAI-compatible ``/embeddings`` over the resolved judge transport.

    The URL and auth headers are derived from the judge adapter, so a
    Pioneer key (H1) embeds through Pioneer and a ``PROOFJURY_*_URL``
    test override applies here too.
    """

    def __init__(self, url: str, headers: dict, model: str):
        self.url = url
        self.headers = headers
        self.model = model

    def embed(self, text: str) -> list[float]:
        with httpx.Client(timeout=TIMEOUT_SECONDS) as client:
            response = client.post(
                self.url,
                headers={"Content-Type": "application/json", **self.headers},
                json={"model": self.model, "input": text},
            )
            response.raise_for_status()
            data = response.json()
        return [float(x) for x in data["data"][0]["embedding"]]


def embedder_from_judge(
    env: Mapping[str, str], root: Path | None, model: str | None = None
) -> Embedder | None:
    """Build an embedder from the configured judge provider, or None.

    Anthropic has no OpenAI-compatible embeddings endpoint, so it yields
    None (and indexing is simply skipped) rather than a broken client.
    """
    try:
        from .. import config as config_module
        from ..judge import _ADAPTERS

        resolved = config_module.resolve_judge(env)
        if resolved is None:
            return None
        adapter = _ADAPTERS.get(resolved["provider"])
        if adapter is None:
            return None
        judge = adapter(api_key=resolved["api_key"], model=resolved["model"], root=root)
        endpoint = getattr(judge, "endpoint", "") or ""
        if not endpoint.endswith(_CHAT_SUFFIX):
            return None  # e.g. Anthropic's /v1/messages — no embeddings API
        url = endpoint[: -len(_CHAT_SUFFIX)] + _EMBED_SUFFIX
        return HttpEmbedder(url, judge._auth_headers(), model or DEFAULT_EMBED_MODEL)
    except Exception:
        return None


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


# --------------------------------------------------------------------------
# documents
# --------------------------------------------------------------------------


def record_document(record: MemoryRecord) -> str:
    """The text embedded for a gate record: diagnosis + failure evidence
    + advisory concerns — the semantic content of what went wrong.

    Sourced from the PERSISTED (already scrubbed) fields only, so nothing
    unscrubbed can reach the index or the embedding endpoint.
    """
    parts: list[str] = []
    if record.diagnosis:
        parts.append(record.diagnosis)
    for check in record.failed_checks():
        cls = check.get("failure_class") or ""
        evidence = str(check.get("evidence") or "")
        parts.append(f"{check.get('name', '')} {cls}: {evidence}".strip())
    for entry in record.advisories:
        concern = entry.get("concern")
        if concern:
            parts.append(str(concern))
    return "\n".join(p for p in parts if p).strip()


# --------------------------------------------------------------------------
# index
# --------------------------------------------------------------------------


class SemanticIndex:
    """Embeds documents into a vector backend and retrieves candidates."""

    def __init__(self, backend: VectorBackend, embedder: Embedder):
        self.backend = backend
        self.embedder = embedder

    # -- write ----------------------------------------------------------

    def index_text(self, doc_id: str, text: str, metadata: dict | None = None) -> bool:
        """Embed and upsert one document. Best-effort: False on any error."""
        if not text or not text.strip():
            return False
        try:
            vector = self.embedder.embed(text)
            if not vector:
                return False
            self.backend.upsert(doc_id, vector, dict(metadata or {}))
            return True
        except Exception:
            return False

    def index_record(self, record: MemoryRecord) -> bool:
        """Index one gate record under its own id."""
        return self.index_text(
            record.id,
            record_document(record),
            {"kind": KIND_RECORD, "repo_id": record.repo_id, "record_id": record.id},
        )

    def index_correction(
        self, checkpoint_id: str, statement: str, changed_files: Iterable[str] = ()
    ) -> bool:
        """Index a checkpoint correction statement so 'recent corrections
        on these files' can be answered by meaning, not just by path."""
        return self.index_text(
            f"{KIND_CORRECTION}:{checkpoint_id}",
            statement,
            {
                "kind": KIND_CORRECTION,
                "checkpoint_id": checkpoint_id,
                "changed_files": list(changed_files),
            },
        )

    # -- read -----------------------------------------------------------

    def candidates(self, query_text: str, k: int = 5) -> list[str]:
        """Record ids semantically close to ``query_text`` (best-effort).

        Correction documents are filtered out — this feeds gate recall,
        which deals in gate records.
        """
        if not query_text or not query_text.strip():
            return []
        try:
            vector = self.embedder.embed(query_text)
            if not vector:
                return []
            hits = self.backend.search(vector, k)
        except Exception:
            return []
        out: list[str] = []
        for doc_id, _score in hits:
            if doc_id.startswith(f"{KIND_CORRECTION}:"):
                continue
            if doc_id not in out:
                out.append(doc_id)
        return out

    def correction_candidates(self, query_text: str, k: int = 5) -> list[str]:
        """Checkpoint ids whose correction statements match by meaning."""
        if not query_text or not query_text.strip():
            return []
        try:
            vector = self.embedder.embed(query_text)
            if not vector:
                return []
            hits = self.backend.search(vector, k)
        except Exception:
            return []
        prefix = f"{KIND_CORRECTION}:"
        return [doc_id[len(prefix):] for doc_id, _ in hits if doc_id.startswith(prefix)]


# --------------------------------------------------------------------------
# factory
# --------------------------------------------------------------------------


def vector_dsn(env: Mapping[str, str] | None = None) -> str:
    """Where Actian VectorAI DB is listening (``host:port``).

    Defaults to the Community Edition's local port. ``ACTIAN_VECTOR_URL``
    is the override; ``ACTIAN_VECTOR_PATH`` is accepted as an alias
    because that is the name PLAN-swarmhack H0 wrote down before the
    client turned out to take an address rather than a directory.
    """
    env = os.environ if env is None else env
    return env.get("ACTIAN_VECTOR_URL") or env.get("ACTIAN_VECTOR_PATH") or DEFAULT_DSN


def vector_path(root: Path, env: Mapping[str, str] | None = None) -> Path:
    """Local scratch dir for semantic-layer state under ``.proofjury/``.

    The vector data itself lives in the Actian server; this is only for
    the offline JsonlBackend fallback. Kept under ``.proofjury/`` so it is
    excluded from the worktree digest like the rest of the gate's state.
    """
    return Path(root) / ".proofjury" / VECTOR_DIRNAME


def get_index(
    root: Path,
    env: Mapping[str, str] | None = None,
    repo_config: dict | None = None,
    *,
    backend: VectorBackend | None = None,
    embedder: Embedder | None = None,
) -> SemanticIndex | None:
    """A ready SemanticIndex, or None — the universal degradation point.

    None whenever semantic recall is disabled, the Actian library is
    absent, or no embedding transport is configured. Callers treat None
    as "no semantic layer" and fall back to heuristic recall unchanged.
    ``backend``/``embedder`` are injection points for tests.
    """
    try:
        from .. import config as config_module

        env = os.environ if env is None else env
        if not config_module.semantic_enabled(repo_config, env):
            return None
        settings = config_module.semantic_settings(repo_config)

        if embedder is None:
            embedder = embedder_from_judge(env, Path(root) / ".proofjury",
                                           settings["embed_model"])
        if embedder is None:
            return None

        if backend is None:
            backend = open_actian_backend(vector_dsn(env))
        if backend is None:
            return None

        return SemanticIndex(backend, embedder)
    except Exception:
        return None


# --------------------------------------------------------------------------
# a dependency-free backend, used by tests and available as a fallback
# --------------------------------------------------------------------------


class JsonlBackend:
    """Brute-force cosine backend over a JSONL file.

    Not a competitor to Actian — it exists so the index logic is testable
    without the SDK installed, and so ``proofjury memory reindex`` can be
    demonstrated on a machine that has not run H0 yet. Linear scan: fine
    for the thousands of records a single repo accumulates, which is
    exactly the scale at which an embedded ANN index like Actian's starts
    to matter.
    """

    def __init__(self, path: Path):
        self.path = Path(path)
        self._docs: dict[str, tuple[list[float], dict]] = {}
        self._load()

    def _load(self) -> None:
        if not self.path.is_file():
            return
        try:
            with self.path.open(encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    data = json.loads(line)
                    self._docs[str(data["id"])] = (
                        [float(x) for x in data["vector"]],
                        data.get("metadata") or {},
                    )
        except (OSError, ValueError, KeyError):
            self._docs = {}

    def _flush(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            for doc_id, (vector, metadata) in self._docs.items():
                fh.write(
                    json.dumps({"id": doc_id, "vector": vector, "metadata": metadata})
                    + "\n"
                )
        os.replace(tmp, self.path)

    def upsert(self, doc_id: str, vector: Sequence[float], metadata: dict) -> None:
        self._docs[str(doc_id)] = ([float(x) for x in vector], dict(metadata))
        self._flush()

    def search(self, vector: Sequence[float], k: int) -> list[tuple[str, float]]:
        scored = [
            (doc_id, _cosine(vector, vec)) for doc_id, (vec, _m) in self._docs.items()
        ]
        scored.sort(key=lambda item: (item[1], item[0]), reverse=True)
        return [(doc_id, score) for doc_id, score in scored[:k] if score > 0.0]


class HashEmbedder:
    """Deterministic, offline, dependency-free embedding by token hashing.

    A bag-of-words projection into a fixed-width vector: documents sharing
    vocabulary land near each other. Good enough to prove the wiring and
    to run CI with no key and no network; a real embedding model is what
    makes "payment key unset" match "missing STRIPE_API_KEY".
    """

    def __init__(self, dim: int = 128):
        self.dim = dim

    def embed(self, text: str) -> list[float]:
        vector = [0.0] * self.dim
        for token in _tokens(text):
            digest = hashlib.sha1(token.encode("utf-8")).digest()
            index = int.from_bytes(digest[:4], "big") % self.dim
            sign = 1.0 if digest[4] % 2 == 0 else -1.0
            vector[index] += sign
        return vector


def _tokens(text: str) -> list[str]:
    return [t for t in "".join(
        c.lower() if c.isalnum() else " " for c in (text or "")
    ).split() if len(t) > 1]
