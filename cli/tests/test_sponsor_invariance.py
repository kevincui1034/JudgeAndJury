"""PINNED: sponsor integrations never move the gate's decision.

PLAN-swarmhack ground rule 2 — "sponsor API down → gate output
byte-identical to a run without it". This is the collective version of
the per-stage firewall tests, and it is the claim the whole pitch rests
on: Pioneer, Senso and Actian are evidence sources, context, and judge
transport, never judgment.

Replay (``browser_qa``) is deliberately EXCLUDED from this invariance.
It is the one sanctioned exception in the plan: a sponsor-backed
*deterministic* check that may fail the gate the same way tests_not_run
does — from a recorded exit code and a worktree digest, not model output.
Its own opt-in firewall is pinned in test_browser_qa_check.py.
"""

import subprocess

import pytest
from typer.testing import CliRunner

from proofjury.cli import app
from proofjury.session import stamp

runner = CliRunner()

#: The CONTEXT sponsors — Senso (conventions) and Actian (semantic
#: recall) — enabled and unreachable. Port 9 (discard) refuses
#: connections, so each takes its error path on a real socket.
#:
#: The judge transport is held at deterministic in BOTH arms of the
#: byte-identical comparison. That is deliberate: an LLM key being
#: configured-but-dead vs absent legitimately changes one line of CLI
#: output (the `proofjury login` discoverability hint in ux.py), which is
#: a UX difference, not a decision difference. Pioneer's own invariance —
#: unreachable endpoint falls back to the deterministic judge with the
#: same verdict — is asserted separately below.
DEAD_CONTEXT_SPONSORS = {
    "PROOFJURY_NO_LLM": "1",
    "SENSO_API_KEY": "senso-dead",
    "SENSO_API_URL": "http://127.0.0.1:9/search",
}

SPONSORS_OFF = {
    "PROOFJURY_NO_LLM": "1",
    "PROOFJURY_NO_CONVENTIONS": "1",
    "PROOFJURY_NO_SEMANTIC": "1",
}

#: Pioneer configured but unreachable.
DEAD_PIONEER = {
    "PIONEER_API_KEY": "pk-dead",
    "PROOFJURY_PIONEER_URL": "http://127.0.0.1:9/v1/chat/completions",
    "SENSO_API_KEY": "senso-dead",
    "SENSO_API_URL": "http://127.0.0.1:9/search",
}

ALL_SPONSOR_ENV = {*DEAD_CONTEXT_SPONSORS, *SPONSORS_OFF, *DEAD_PIONEER}

CONVENTIONS_ON = "[conventions]\nenabled = true\n"


@pytest.fixture(autouse=True)
def _isolated(monkeypatch, tmp_path_factory):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path_factory.mktemp("cfg")))
    # The cross-repo registry lives under the shared config home; without
    # this, arm 2 could recall arm 1 and shadow the comparison.
    monkeypatch.setenv("PROOFJURY_NO_CROSS_REPO", "1")


def _fresh_repo(tmp_path_factory, name):
    root = tmp_path_factory.mktemp(name)
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    (root / "payments.py").write_text(
        'import os\nKEY = os.environ["STRIPE_API_KEY"]\n'
    )
    (root / ".proofjury.toml").write_text(CONVENTIONS_ON)
    return root


def _guard(monkeypatch, root, env: dict):
    monkeypatch.chdir(root)
    for key in ALL_SPONSOR_ENV:
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    return runner.invoke(app, ["guard", "deploy", "--no-exec"])


def _normalize(text: str, *roots) -> str:
    for root in roots:
        text = text.replace(root.name, "REPO")
    return text


def test_blocked_output_identical_with_context_sponsors_dead(
    tmp_path_factory, monkeypatch
):
    """Two identical fresh repos so same-repo recall can't shadow it."""
    arm_dead = _fresh_repo(tmp_path_factory, "arm-dead")
    dead = _guard(monkeypatch, arm_dead, DEAD_CONTEXT_SPONSORS)

    arm_off = _fresh_repo(tmp_path_factory, "arm-off")
    off = _guard(monkeypatch, arm_off, SPONSORS_OFF)

    assert dead.exit_code == off.exit_code == 2
    assert _normalize(dead.output, arm_dead, arm_off) == _normalize(
        off.output, arm_dead, arm_off
    )


def test_unreachable_pioneer_falls_back_to_the_same_verdict(
    tmp_path_factory, monkeypatch
):
    """The judge only EXPLAINS. With Pioneer configured but unreachable
    the verdict, the failure classes and the diagnosis are the offline
    judge's — identical to a run with no LLM at all."""
    import json

    arm_dead = _fresh_repo(tmp_path_factory, "pioneer-dead")
    dead = _guard(monkeypatch, arm_dead, DEAD_PIONEER)

    arm_off = _fresh_repo(tmp_path_factory, "pioneer-off")
    off = _guard(monkeypatch, arm_off, SPONSORS_OFF)

    assert dead.exit_code == off.exit_code == 2

    def last_record(root):
        path = root / ".proofjury" / "memory.jsonl"
        return json.loads(path.read_text(encoding="utf-8").strip().splitlines()[-1])

    dead_rec, off_rec = last_record(arm_dead), last_record(arm_off)
    assert dead_rec["gate_passed"] == off_rec["gate_passed"] is False
    assert dead_rec["diagnosis"] == off_rec["diagnosis"]
    assert dead_rec["judge_model_id"] == off_rec["judge_model_id"]
    assert dead_rec["judge_model_id"].startswith("deterministic/")
    assert [c["failure_class"] for c in dead_rec["checks"]] == [
        c["failure_class"] for c in off_rec["checks"]
    ]


def test_passing_output_identical_with_every_sponsor_dead(
    tmp_path_factory, monkeypatch
):
    def clean_repo(name):
        root = tmp_path_factory.mktemp(name)
        subprocess.run(["git", "init", "-q"], cwd=root, check=True)
        (root / "svc.py").write_text("def add(a, b):\n    return a + b\n")
        (root / ".proofjury.toml").write_text(CONVENTIONS_ON)
        stamp(root, "tests", 0, ["pytest", "-q"])
        return root

    arm_dead = clean_repo("pass-dead")
    dead = _guard(monkeypatch, arm_dead, DEAD_CONTEXT_SPONSORS)

    arm_off = clean_repo("pass-off")
    off = _guard(monkeypatch, arm_off, SPONSORS_OFF)

    assert dead.exit_code == off.exit_code == 0
    assert _normalize(dead.output, arm_dead, arm_off) == _normalize(
        off.output, arm_dead, arm_off
    )


@pytest.mark.parametrize(
    "target",
    [
        "proofjury.judge.conventions.fetch_conventions",
        "proofjury.memory.semantic.get_index",
    ],
)
def test_exit_identical_when_a_sponsor_layer_raises(
    tmp_path_factory, monkeypatch, target
):
    """Not merely unreachable — actively crashing. A sponsor integration
    must never be able to take the gate down."""

    def explode(*args, **kwargs):
        raise RuntimeError(f"{target} crashed")

    monkeypatch.setattr(target, explode)
    root = _fresh_repo(tmp_path_factory, "arm-crash")
    result = _guard(monkeypatch, root, DEAD_CONTEXT_SPONSORS)
    assert result.exit_code == 2


def test_semantic_index_failure_leaves_recall_untouched(
    tmp_path_factory, monkeypatch
):
    """Indexing runs AFTER the record is appended; a failure there must
    not corrupt the run that produced it."""
    import proofjury.gate as gate_module

    def explode(*args, **kwargs):
        raise RuntimeError("index write failed")

    monkeypatch.setattr(gate_module, "_semantic_index_record", explode)
    root = _fresh_repo(tmp_path_factory, "arm-index")
    result = _guard(monkeypatch, root, DEAD_CONTEXT_SPONSORS)
    assert result.exit_code == 2
    assert (root / ".proofjury" / "memory.jsonl").is_file()
