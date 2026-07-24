"""Live Actian VectorAI DB round-trip.

Skipped unless a server is actually reachable, so the default suite stays
hermetic — but this is the test that would have caught every bug the
hand-written binding had. Run it with:

    docker run -d --name vectorai -p 6573-6575:6573-6575 \
      -e ACTIAN_VECTORAI_ACCEPT_EULA=YES actian/vectorai:latest
    pip install -e 'cli[semantic]'
    pytest cli/tests/test_actian_live.py

What it pins about the real SDK (all verified against 1.0.2):
- the client is LAZY: `collections`/`points` raise until connect() runs
- point ids must be int or a valid UUID — a bare "chk_012" is a 422
- search hits expose .id / .score / .payload
"""

import socket

import pytest

from proofjury.memory.semantic import (
    HashEmbedder,
    SemanticIndex,
    open_actian_backend,
    vector_dsn,
)
from proofjury.memory.schema import MemoryRecord


def _server_up(dsn: str) -> bool:
    host, _, port = dsn.partition(":")
    try:
        with socket.create_connection((host, int(port or 6574)), timeout=1):
            return True
    except OSError:
        return False


DSN = vector_dsn({})
pytestmark = pytest.mark.skipif(
    not _server_up(DSN), reason=f"no Actian VectorAI DB at {DSN}"
)


def _record(record_id: str, evidence: str, diagnosis: str) -> MemoryRecord:
    return MemoryRecord(
        id=record_id,
        repo_id="live-test",
        created_at="2026-07-24T12:00:00Z",
        action_intercepted="deploy",
        agent_source="claude",
        context_ref=f".proofjury/runs/{record_id}/",
        checks=[
            {
                "name": "env_vars",
                "type": "deterministic",
                "passed": False,
                "failure_class": "missing_env_var",
                "evidence": evidence,
            }
        ],
        gate_passed=False,
        diagnosis=diagnosis,
        judge_input="",
        judge_output="",
        proof_refs=[],
        recalled_from=None,
        judge_model_id="deterministic/proofjury-v1",
        resolution=None,
    )


@pytest.fixture
def index():
    backend = open_actian_backend(DSN)
    assert backend is not None, "server is up but open_actian_backend returned None"
    return SemanticIndex(backend, HashEmbedder())


def test_index_and_recall_round_trip(index):
    a = _record("chk_001", "STRIPE_API_KEY (payments.py:14) unset", "STRIPE_API_KEY unset.")
    b = _record("chk_002", "DATABASE_URL (db.py:3) unset", "DATABASE_URL unset.")
    assert index.index_record(a) is True
    assert index.index_record(b) is True

    hits = index.candidates("STRIPE_API_KEY payments unset", k=5)
    assert "chk_001" in hits


def test_reindexing_is_idempotent(index):
    """A record re-pushed after a label change must not duplicate its point
    — that is what the deterministic id hash buys."""
    record = _record("chk_dup", "TOKEN (a.py:1) unset", "TOKEN unset.")
    index.index_record(record)
    first = index.candidates("TOKEN a unset", k=10)
    index.index_record(record)
    second = index.candidates("TOKEN a unset", k=10)
    assert first.count("chk_dup") == 1
    assert second.count("chk_dup") == 1


def test_corrections_never_leak_into_gate_recall(index):
    index.index_correction("ckpt_live", "wants files split into small modules", ["a.py"])
    gate = index.candidates("split files into small modules", k=10)
    assert all(not h.startswith("correction:") for h in gate)
    assert "ckpt_live" in index.correction_candidates(
        "split files into small modules", k=5
    )


def test_string_ids_are_rejected_by_the_server(index):
    """Pins WHY _point_id hashes: Actian requires an int or a valid UUID,
    so a bare record id like "chk_012" is a 422. If a future SDK relaxes
    this, the hash could be dropped — this test is the tripwire."""
    from actian_vectorai import PointStruct

    with pytest.raises(Exception) as exc:
        index.backend._client.points.upsert(  # type: ignore[attr-defined]
            "proofjury_memory",
            [PointStruct(id="chk_not_a_uuid", vector=[0.1] * 128, payload={})],
        )
    assert "UUID" in str(exc.value) or "422" in str(exc.value)


def test_client_must_be_connected_first():
    """The SDK is lazy — this is the bug the hand-written binding had."""
    from actian_vectorai import VectorAIClient

    client = VectorAIClient(DSN)
    with pytest.raises(Exception):
        _ = client.collections  # not connected yet
    client.connect()
    assert client.is_connected
    assert client.health_check()
    client.close()
