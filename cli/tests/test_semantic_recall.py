"""Semantic memory over an embedded vector DB (PLAN-swarmhack H3).

Runs with NO key and NO network: the index logic is exercised through
the dependency-free JsonlBackend + a deterministic embedder, so what is
pinned here is Proofjury's behavior, not Actian's.

The load-bearing assertions are the authority rules — semantic hits are
additive context that can re-rank and surface priors but can never
strong-match, never resurrect a false positive, and never change recall
at all when the layer is absent.
"""

import hashlib

import pytest

from proofjury import config
from proofjury.checks.base import CheckResult, Evidence
from proofjury.memory.recall import recall, strong_match
from proofjury.memory.schema import MemoryRecord
from proofjury.memory.semantic import (
    DEFAULT_DSN,
    HashEmbedder,
    JsonlBackend,
    SemanticIndex,
    get_index,
    record_document,
    vector_dsn,
    vector_path,
)
from proofjury.memory.store import MemoryStore
from proofjury.session import worktree_digest


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


class SynonymEmbedder:
    """Maps configured concept groups to identical vectors.

    Stands in for a real embedding model: it makes "payment key unset"
    and "missing STRIPE_API_KEY" neighbours, which bag-of-words hashing
    cannot do. The point is to prove the PLUMBING delivers the demo, with
    the semantics supplied by whatever model runs in production.
    """

    def __init__(self, groups: list[list[str]], dim: int = 32):
        self.groups = groups
        self.dim = dim

    def embed(self, text: str) -> list[float]:
        low = (text or "").lower()
        for i, group in enumerate(self.groups):
            if any(phrase in low for phrase in group):
                vec = [0.0] * self.dim
                vec[i % self.dim] = 1.0
                return vec
        digest = hashlib.sha1(low.encode()).digest()
        vec = [0.0] * self.dim
        vec[digest[0] % self.dim] = 1.0
        vec[digest[1] % self.dim] += 0.5
        return vec


def _record(record_id, classes, evidence="", *, resolution=None, diagnosis="d",
            created_at="2026-07-01T00:00:00Z", repo_id="demo-repo"):
    return MemoryRecord(
        id=record_id,
        repo_id=repo_id,
        created_at=created_at,
        action_intercepted="deploy",
        agent_source="unknown",
        context_ref=f".proofjury/runs/{record_id}/",
        checks=[
            {
                "name": "env_vars",
                "type": "deterministic",
                "passed": False,
                "failure_class": cls,
                "evidence": evidence,
            }
            for cls in classes
        ],
        gate_passed=False,
        diagnosis=diagnosis,
        judge_input="",
        judge_output="",
        proof_refs=[],
        recalled_from=None,
        judge_model_id="deterministic/proofjury-v1",
        resolution=resolution,
    )


def _failure(cls="missing_env_var", detail="STRIPE_API_KEY", file="payments.py", line=14):
    return CheckResult(
        name="env_vars",
        passed=False,
        failure_class=cls,
        evidence=[Evidence(file=file, line=line, detail=detail)],
    )


def _store_with(tmp_path, records):
    store = MemoryStore(tmp_path / ".proofjury")
    for record in records:
        store.append(record)
    return store


def _index(tmp_path, embedder=None):
    return SemanticIndex(
        JsonlBackend(tmp_path / ".proofjury" / "vector" / "index.jsonl"),
        embedder or HashEmbedder(),
    )


# --------------------------------------------------------------------------
# index round-trip
# --------------------------------------------------------------------------


def test_index_round_trip(tmp_path):
    index = _index(tmp_path)
    record = _record("chk_001", ["missing_env_var"], "STRIPE_API_KEY (payments.py:14) unset")
    assert index.index_record(record) is True
    assert index.candidates("STRIPE_API_KEY payments unset", k=5) == ["chk_001"]


def test_index_persists_across_instances(tmp_path):
    _index(tmp_path).index_record(
        _record("chk_001", ["missing_env_var"], "STRIPE_API_KEY (payments.py:14)")
    )
    reopened = _index(tmp_path)
    assert reopened.candidates("STRIPE_API_KEY payments", k=5) == ["chk_001"]


def test_record_document_uses_persisted_scrubbed_fields_only(tmp_path):
    record = _record(
        "chk_001",
        ["missing_env_var"],
        "STRIPE_API_KEY (payments.py:14) unset",
        diagnosis="Blocking deploy — STRIPE_API_KEY unset.",
    )
    record.advisories = [{"concern": "No retry on the webhook send."}]
    doc = record_document(record)
    assert "Blocking deploy" in doc
    assert "STRIPE_API_KEY (payments.py:14) unset" in doc
    assert "No retry on the webhook send." in doc


def test_empty_document_is_not_indexed(tmp_path):
    index = _index(tmp_path)
    assert index.index_text("chk_empty", "   ") is False
    assert index.candidates("anything", k=5) == []


def test_indexing_errors_are_swallowed(tmp_path):
    class Broken:
        def embed(self, text):
            raise RuntimeError("embedding service down")

    index = SemanticIndex(JsonlBackend(tmp_path / "v.jsonl"), Broken())
    assert index.index_record(_record("chk_001", ["missing_env_var"], "x")) is False
    assert index.candidates("x", k=5) == []


def test_corrections_are_indexed_separately_from_records(tmp_path):
    index = _index(tmp_path)
    index.index_record(_record("chk_001", ["missing_env_var"], "STRIPE_API_KEY unset"))
    index.index_correction("ckpt_9", "wants large files split into small modules", ["a.py"])

    # Gate recall must never be handed a correction id.
    assert "correction:ckpt_9" not in index.candidates("split files modules", k=10)
    assert index.correction_candidates("split files into small modules", k=5) == ["ckpt_9"]


# --------------------------------------------------------------------------
# invariance: no semantic layer → recall is unchanged
# --------------------------------------------------------------------------


def test_recall_identical_without_semantic_ids(tmp_path):
    records = [
        _record("chk_001", ["missing_env_var"], "STRIPE_API_KEY (payments.py:14)"),
        _record("chk_002", ["missing_env_var"], "DATABASE_URL (db.py:3)",
                created_at="2026-07-02T00:00:00Z"),
    ]
    store = _store_with(tmp_path, records)
    failures = [_failure()]

    baseline = [r.id for r in recall(store, "demo-repo", failures)]
    assert [r.id for r in recall(store, "demo-repo", failures, semantic_ids=None)] == baseline
    assert [r.id for r in recall(store, "demo-repo", failures, semantic_ids=[])] == baseline


def test_get_index_none_without_actian_library(tmp_path, scrubbed_env):
    """No Actian install → None, which is what makes everything degrade."""
    assert get_index(tmp_path, scrubbed_env, {}) is None


def test_get_index_none_when_disabled(tmp_path, scrubbed_env):
    assert (
        get_index(
            tmp_path,
            scrubbed_env,
            {"semantic": {"enabled": False}},
            backend=JsonlBackend(tmp_path / "v.jsonl"),
            embedder=HashEmbedder(),
        )
        is None
    )


def test_get_index_none_without_embedder(tmp_path, scrubbed_env):
    assert (
        get_index(tmp_path, scrubbed_env, {}, backend=JsonlBackend(tmp_path / "v.jsonl"))
        is None
    )


def test_env_kill_switch(tmp_path):
    assert config.semantic_enabled({}, {"PROOFJURY_NO_SEMANTIC": "1"}) is False
    assert config.semantic_enabled({}, {}) is True


def test_get_index_with_injected_parts(tmp_path, scrubbed_env):
    index = get_index(
        tmp_path,
        scrubbed_env,
        {},
        backend=JsonlBackend(tmp_path / "v.jsonl"),
        embedder=HashEmbedder(),
    )
    assert isinstance(index, SemanticIndex)


# --------------------------------------------------------------------------
# authority rules
# --------------------------------------------------------------------------


def test_semantic_never_resurrects_a_false_positive(tmp_path):
    """EXCLUDED_RESOLUTIONS wins over the vector door."""
    store = _store_with(
        tmp_path,
        [
            _record(
                "chk_001",
                ["missing_env_var"],
                "STRIPE_API_KEY (payments.py:14)",
                resolution={"status": "false_positive"},
            )
        ],
    )
    priors = recall(store, "demo-repo", [_failure()], semantic_ids=["chk_001"])
    assert priors == []


def test_semantic_only_prior_is_context_never_authority(tmp_path):
    """A prior with NO shared failure class can be surfaced by meaning,
    but must never short-circuit the judge."""
    store = _store_with(
        tmp_path,
        [
            _record("chk_001", ["lockfile_drift"], "package-lock.json (package.json:1)"),
        ],
    )
    failures = [_failure()]

    assert recall(store, "demo-repo", failures) == []  # invisible without semantics

    priors = recall(store, "demo-repo", failures, semantic_ids=["chk_001"])
    assert [p.id for p in priors] == ["chk_001"]
    # The gate's short-circuit guard: class sets differ, so no deterministic
    # citation and the judge still runs.
    assert strong_match(failures, priors[0]) is False


def test_semantic_only_sorts_below_every_class_matched_prior(tmp_path):
    store = _store_with(
        tmp_path,
        [
            _record("chk_001", ["missing_env_var"], "DATABASE_URL (db.py:3)"),
            _record("chk_002", ["unfinished_work"], "TODO (app.py:2)"),
        ],
    )
    priors = recall(
        store, "demo-repo", [_failure()], semantic_ids=["chk_002", "chk_001"]
    )
    assert [p.id for p in priors] == ["chk_001", "chk_002"]


def test_semantic_hit_promotes_a_class_matched_prior_above_token_score(tmp_path):
    """The demo: the differently-worded prior outranks one that merely
    shares an evidence token."""
    store = _store_with(
        tmp_path,
        [
            # Shares the STRIPE_API_KEY token — wins on the heuristic path.
            _record("chk_001", ["missing_env_var"], "STRIPE_API_KEY (payments.py:14)"),
            # Same mistake, different words — no shared token at all.
            _record("chk_002", ["missing_env_var"], "PAYMENT_SECRET (billing.py:9)"),
        ],
    )
    failures = [_failure()]

    assert [p.id for p in recall(store, "demo-repo", failures)][0] == "chk_001"
    promoted = recall(store, "demo-repo", failures, semantic_ids=["chk_002"])
    assert [p.id for p in promoted][0] == "chk_002"
    assert {p.id for p in promoted} == {"chk_001", "chk_002"}


def test_noisy_class_demotion_still_beats_semantic_promotion(tmp_path):
    """Label-informed trust is ranked above semantic similarity: a class
    the human repeatedly called a false positive stays demoted."""
    store = _store_with(
        tmp_path,
        [
            _record("chk_001", ["tests_not_run"], "no test run (a.py:1)",
                    resolution={"status": "false_positive"}),
            _record("chk_002", ["tests_not_run"], "no test run (b.py:1)",
                    resolution={"status": "false_positive"}),
            _record("chk_003", ["tests_not_run"], "no test run (c.py:1)",
                    created_at="2026-07-03T00:00:00Z"),
            _record("chk_004", ["missing_env_var"], "STRIPE_API_KEY (payments.py:14)",
                    created_at="2026-07-04T00:00:00Z"),
        ],
    )
    failures = [_failure(), _failure("tests_not_run", "no test run", "c.py", 1)]
    priors = recall(store, "demo-repo", failures, semantic_ids=["chk_003"])
    # chk_003's only class is noisy → demoted below the trusted chk_004,
    # even though semantics promoted it within its trust tier.
    assert [p.id for p in priors][0] == "chk_004"


def test_semantic_cannot_promote_a_passing_record(tmp_path):
    store = _store_with(tmp_path, [_record("chk_001", ["missing_env_var"], "x")])
    passed = _record("chk_002", ["missing_env_var"], "y")
    passed.gate_passed = True
    store.append(passed)
    priors = recall(store, "demo-repo", [_failure()], semantic_ids=["chk_002"])
    assert [p.id for p in priors] == ["chk_001"]


def test_semantic_cannot_pull_in_another_repo(tmp_path):
    store = _store_with(
        tmp_path,
        [_record("chk_001", ["missing_env_var"], "x", repo_id="other-repo")],
    )
    assert recall(store, "demo-repo", [_failure()], semantic_ids=["chk_001"]) == []


# --------------------------------------------------------------------------
# H3 acceptance: index -> candidates -> recall, end to end
# --------------------------------------------------------------------------


def test_differently_worded_failure_recalls_the_prior_end_to_end(tmp_path):
    """The stage's whole point: a new failure phrased "payment key unset"
    recalls the old "missing STRIPE_API_KEY" record — which class+token
    heuristics alone rank BELOW a record that merely shares a file
    anchor. Runs the real path: index the record, query the index, feed
    the ids to recall.
    """
    embedder = SynonymEmbedder([["stripe_api_key", "payment key", "payment secret"]])
    index = SemanticIndex(
        JsonlBackend(tmp_path / ".proofjury" / "vector" / "index.jsonl"), embedder
    )

    prior = _record(
        "chk_001",
        ["missing_env_var"],
        "STRIPE_API_KEY (payments.py:14) unset",
        diagnosis="Blocking deploy — STRIPE_API_KEY referenced but unset.",
    )
    # Distractor: no semantic relation, but it SHARES the file anchor with
    # the new failure, so token scoring ranks it first.
    distractor = _record(
        "chk_002",
        ["missing_env_var"],
        "OTHER_VAR (billing.py:9) unset",
        diagnosis="Blocking deploy — OTHER_VAR unset.",
        created_at="2026-07-02T00:00:00Z",
    )
    store = _store_with(tmp_path, [prior, distractor])
    index.index_record(prior)
    index.index_record(distractor)

    new_failure = _failure(detail="payment key unset", file="billing.py", line=9)
    query = "env_vars missing_env_var: payment key unset (billing.py:9)"

    # Heuristic-only recall puts the token-sharing distractor first.
    assert [p.id for p in recall(store, "demo-repo", [new_failure])][0] == "chk_002"

    candidate_ids = index.candidates(query, k=5)
    assert "chk_001" in candidate_ids

    priors = recall(store, "demo-repo", [new_failure], semantic_ids=candidate_ids)
    assert [p.id for p in priors][0] == "chk_001"


# --------------------------------------------------------------------------
# the index must never look like a code change
# --------------------------------------------------------------------------


def test_vector_dir_never_enters_the_worktree_digest(tmp_repo):
    """If the index shifted the digest, every gate run would re-arm
    tests_not_run against itself."""
    tmp_repo.write("svc.py", "x = 1\n")
    (tmp_repo.root / ".proofjury").mkdir(parents=True, exist_ok=True)
    before = worktree_digest(tmp_repo.root)

    index = SemanticIndex(
        JsonlBackend(tmp_repo.root / ".proofjury" / "vector" / "index.jsonl"),
        HashEmbedder(),
    )
    index.index_record(_record("chk_001", ["missing_env_var"], "STRIPE_API_KEY"))

    assert (tmp_repo.root / ".proofjury" / "vector" / "index.jsonl").is_file()
    assert worktree_digest(tmp_repo.root) == before


def test_vector_scratch_dir_lives_under_proofjury(tmp_path):
    assert vector_path(tmp_path) == tmp_path / ".proofjury" / "vector"


def test_vector_dsn_default_and_overrides():
    """Actian's client takes an ADDRESS, not a directory. H0 wrote down
    ACTIAN_VECTOR_PATH before that was known, so it stays an alias."""
    assert vector_dsn({}) == DEFAULT_DSN == "localhost:6574"
    assert vector_dsn({"ACTIAN_VECTOR_URL": "10.0.0.5:6574"}) == "10.0.0.5:6574"
    assert vector_dsn({"ACTIAN_VECTOR_PATH": "10.0.0.9:6574"}) == "10.0.0.9:6574"
    # The documented name wins when both are set.
    assert (
        vector_dsn({"ACTIAN_VECTOR_URL": "a:1", "ACTIAN_VECTOR_PATH": "b:2"}) == "a:1"
    )


def test_actian_point_ids_are_stable_and_reversible():
    """Actian keys points by integer but Proofjury ids are strings, so the
    id is hashed and the original rides in the payload."""
    from proofjury.memory.semantic import _point_id

    assert _point_id("chk_012") == _point_id("chk_012")  # idempotent upserts
    assert _point_id("chk_012") != _point_id("chk_013")
    assert 0 < _point_id("chk_012") < 2**63


def test_open_actian_backend_none_without_client():
    from proofjury.memory.semantic import open_actian_backend

    assert open_actian_backend("localhost:6574") is None


# --------------------------------------------------------------------------
# config
# --------------------------------------------------------------------------


def test_semantic_settings_defaults_and_overrides():
    assert config.semantic_settings(None)["top_k"] == 5
    assert config.semantic_settings({"semantic": {"top_k": 12}})["top_k"] == 12
    # Malformed values fall back rather than crashing the gate.
    assert config.semantic_settings({"semantic": {"top_k": 0}})["top_k"] == 5
    assert config.semantic_settings({"semantic": {"top_k": "many"}})["top_k"] == 5
    assert config.semantic_settings({"semantic": "nope"})["enabled"] is True


@pytest.mark.parametrize("k", [1, 3])
def test_top_k_bounds_candidates(tmp_path, k):
    index = _index(tmp_path)
    for i in range(6):
        index.index_record(_record(f"chk_{i:03d}", ["missing_env_var"], "STRIPE_API_KEY unset"))
    assert len(index.candidates("STRIPE_API_KEY unset", k=k)) <= k
