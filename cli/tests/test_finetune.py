"""Fine-tuning the judge on our own labeled records (PLAN-swarmhack H2).

The thesis under test: because every judge INPUT is persisted verbatim
next to the outcome a human labeled, building a supervised dataset is a
projection of the memory store. What is pinned here is pair shape, label
filtering, and — most importantly — that the builder can only ever read
persisted (already scrubbed) fields, so a raw prompt cannot reach a
dataset.
"""

import json

from typer.testing import CliRunner

from proofjury.checkpoint import CheckpointStore
from proofjury.cli import app
from proofjury.judge.advisory import ADVISORY_SYSTEM_PROMPT
from proofjury.memory.finetune import (
    advisory_pairs,
    build_dataset,
    checkpoint_pairs,
    dataset_stats,
    submit,
    write_jsonl,
)
from proofjury.memory.schema import MemoryRecord
from proofjury.memory.store import MemoryStore

runner = CliRunner()


def _advisory(concern="No retry on the webhook send.", label=None, **kw):
    entry = {
        "id": "chk_001#0",
        "concern": concern,
        "kind": "discovery",
        "tier": 4,
        "confidence": 0.8,
        "grounded_in": [],
        "target": "notifications.py:12",
        "judge_model_id": "pioneer/gpt-4.1",
        "delivery": "injected",
        "label": label,
        "retraction": None,
    }
    entry.update(kw)
    return entry


def _record(record_id="chk_001", advisory_input="ADVISORY PROMPT", advisories=None):
    return MemoryRecord(
        id=record_id,
        repo_id="demo-repo",
        created_at="2026-07-01T00:00:00Z",
        action_intercepted="deploy",
        agent_source="unknown",
        context_ref=f".proofjury/runs/{record_id}/",
        checks=[],
        gate_passed=False,
        diagnosis="d",
        judge_input="",
        judge_output="",
        proof_refs=[],
        recalled_from=None,
        judge_model_id="pioneer/gpt-4.1",
        resolution=None,
        advisories=advisories if advisories is not None else [],
        advisory_input=advisory_input,
    )


def _checkpoint(ckpt_id="ckpt_001", prompt="REVIEW PROMPT", label="corrected",
                category="size", statement="wants smaller files"):
    return {
        "id": ckpt_id,
        "repo_id": "demo-repo",
        "checkpoint_input": prompt,
        "outcome": (
            {"label": label, "category": category, "statement": statement}
            if label is not None
            else None
        ),
    }


# --------------------------------------------------------------------------
# advisory pairs
# --------------------------------------------------------------------------


def test_advisory_pair_shape():
    rows = advisory_pairs([_record(advisories=[_advisory(label="confirmed")])])
    assert len(rows) == 1
    row = rows[0]
    assert row["kind"] == "advisory"
    assert row["label"] == "confirmed"
    roles = [m["role"] for m in row["messages"]]
    assert roles == ["system", "user", "assistant"]
    assert row["messages"][0]["content"] == ADVISORY_SYSTEM_PROMPT
    assert row["messages"][1]["content"] == "ADVISORY PROMPT"
    completion = json.loads(row["messages"][2]["content"])
    assert completion["findings"][0]["concern"] == "No retry on the webhook send."


def test_rejected_findings_are_dropped_from_the_completion():
    """The target is what the judge SHOULD have said — a rejected finding
    is exactly what it should not have said."""
    rows = advisory_pairs(
        [
            _record(
                advisories=[
                    _advisory("keep me", label="confirmed"),
                    _advisory("drop me", label="rejected"),
                ]
            )
        ]
    )
    completion = json.loads(rows[0]["messages"][2]["content"])
    concerns = [f["concern"] for f in completion["findings"]]
    assert concerns == ["keep me"]


def test_all_rejected_becomes_an_empty_findings_example():
    """Restraint is trainable: this is the row that teaches silence."""
    rows = advisory_pairs([_record(advisories=[_advisory("noise", label="rejected")])])
    assert len(rows) == 1
    assert rows[0]["label"] == "rejected"
    assert json.loads(rows[0]["messages"][2]["content"]) == {"findings": []}


def test_unlabeled_records_are_excluded():
    assert advisory_pairs([_record(advisories=[_advisory(label=None)])]) == []
    assert advisory_pairs([_record(advisories=[])]) == []


def test_record_without_advisory_input_is_excluded():
    assert advisory_pairs(
        [_record(advisory_input="", advisories=[_advisory(label="confirmed")])]
    ) == []


# --------------------------------------------------------------------------
# checkpoint pairs
# --------------------------------------------------------------------------


def test_checkpoint_pair_shape():
    rows = checkpoint_pairs([_checkpoint()])
    assert len(rows) == 1
    assert rows[0]["kind"] == "checkpoint"
    assert rows[0]["label"] == "corrected"
    assert rows[0]["messages"][1]["content"] == "REVIEW PROMPT"
    completion = json.loads(rows[0]["messages"][2]["content"])
    assert completion == {
        "label": "corrected",
        "category": "size",
        "statement": "wants smaller files",
    }


def test_unclear_and_unlabeled_checkpoints_are_excluded():
    """"unclear" is a hedge; training on it entrenches hedging."""
    assert checkpoint_pairs([_checkpoint(label="unclear")]) == []
    assert checkpoint_pairs([_checkpoint(label=None)]) == []
    assert checkpoint_pairs([_checkpoint(prompt=None)]) == []


def test_new_task_checkpoints_are_kept():
    rows = checkpoint_pairs([_checkpoint(label="new_task", category="", statement="")])
    assert [r["label"] for r in rows] == ["new_task"]


# --------------------------------------------------------------------------
# scrub safety
# --------------------------------------------------------------------------


def test_dataset_reads_only_persisted_fields(tmp_path):
    """A raw prompt never reaches disk, so a dataset built from disk
    cannot contain one. Round-tripping through the real store proves the
    builder sees only what was persisted: every piece of free text in a
    row must be traceable to the stored record (or to the system prompt,
    which is a constant, not data).
    """
    store = MemoryStore(tmp_path / ".proofjury")
    store.append(
        _record(
            advisory_input="SCRUBBED [REDACTED] PROMPT",
            advisories=[_advisory(concern="webhook has no retry", label="confirmed")],
        )
    )

    rows = build_dataset(store)
    persisted = json.dumps(
        [r.to_dict() for r in MemoryStore(tmp_path / ".proofjury").iter_records()]
    )
    system, user, assistant = rows[0]["messages"]

    assert system["content"] == ADVISORY_SYSTEM_PROMPT  # constant, not data
    assert user["content"] == "SCRUBBED [REDACTED] PROMPT"
    assert user["content"] in persisted
    for finding in json.loads(assistant["content"])["findings"]:
        assert finding["concern"] in persisted


# --------------------------------------------------------------------------
# assembly + stats + write
# --------------------------------------------------------------------------


def test_build_dataset_combines_both_surfaces(tmp_path):
    store = MemoryStore(tmp_path / ".proofjury")
    store.append(_record(advisories=[_advisory(label="confirmed")]))
    ckpt = CheckpointStore(tmp_path / ".proofjury")
    ckpt.append(_checkpoint())

    rows = build_dataset(store, ckpt)
    assert {r["kind"] for r in rows} == {"advisory", "checkpoint"}
    assert dataset_stats(rows) == {
        "total": 2,
        "advisory": {"confirmed": 1},
        "checkpoint": {"corrected": 1},
    }


def test_build_dataset_without_checkpoint_store(tmp_path):
    store = MemoryStore(tmp_path / ".proofjury")
    store.append(_record(advisories=[_advisory(label="confirmed")]))
    assert len(build_dataset(store, None)) == 1


def test_write_jsonl_emits_messages_only(tmp_path):
    rows = advisory_pairs([_record(advisories=[_advisory(label="confirmed")])])
    path = write_jsonl(rows, tmp_path / "out" / "ft.jsonl")
    lines = path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    parsed = json.loads(lines[0])
    assert set(parsed) == {"messages"}  # no bookkeeping keys leak into training
    assert len(parsed["messages"]) == 3


# --------------------------------------------------------------------------
# submit
# --------------------------------------------------------------------------


def test_submit_posts_with_api_key_and_returns_job_ref(tmp_path):
    dataset = tmp_path / "ft.jsonl"
    dataset.write_text('{"messages": []}\n', encoding="utf-8")
    seen = {}

    def poster(url, headers, payload):
        seen.update(url=url, headers=headers, payload=payload)
        return {"job_id": "job_abc123"}

    ref = submit(dataset, {"PIONEER_API_KEY": "pk-1"}, poster=poster)
    assert ref == "job_abc123"
    assert seen["headers"]["X-API-Key"] == "pk-1"
    assert seen["payload"]["method"] == "sft"
    assert '{"messages": []}' in seen["payload"]["training_file"]


def test_submit_without_key_returns_none(tmp_path):
    dataset = tmp_path / "ft.jsonl"
    dataset.write_text("{}\n", encoding="utf-8")
    called = []
    assert submit(dataset, {}, poster=lambda *a: called.append(a)) is None
    assert called == []


def test_submit_is_firewalled_against_api_errors(tmp_path):
    dataset = tmp_path / "ft.jsonl"
    dataset.write_text("{}\n", encoding="utf-8")

    def boom(url, headers, payload):
        raise RuntimeError("500")

    assert submit(dataset, {"PIONEER_API_KEY": "pk-1"}, poster=boom) is None


def test_submit_url_is_env_overridable(tmp_path):
    dataset = tmp_path / "ft.jsonl"
    dataset.write_text("{}\n", encoding="utf-8")
    seen = {}
    submit(
        dataset,
        {"PIONEER_API_KEY": "k", "PIONEER_TRAINING_URL": "http://127.0.0.1:9/train"},
        poster=lambda url, h, p: seen.update(url=url) or {"id": "job_x"},
    )
    assert seen["url"] == "http://127.0.0.1:9/train"


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def test_cli_dry_run_writes_dataset_and_reports_counts(tmp_repo, monkeypatch):
    monkeypatch.chdir(tmp_repo.root)
    store = MemoryStore(tmp_repo.root / ".proofjury")
    store.append(_record(advisories=[_advisory(label="confirmed")]))

    result = runner.invoke(app, ["memory", "finetune", "--dry-run"])
    assert result.exit_code == 0
    assert "nothing submitted" in result.stdout
    dataset = tmp_repo.root / ".proofjury" / "finetune.jsonl"
    assert dataset.is_file()
    assert len(dataset.read_text(encoding="utf-8").strip().splitlines()) == 1


def test_cli_fails_cleanly_with_no_labeled_records(tmp_repo, monkeypatch):
    monkeypatch.chdir(tmp_repo.root)
    result = runner.invoke(app, ["memory", "finetune", "--dry-run"])
    assert result.exit_code == 1
    assert "no labeled records" in result.output


def test_cli_custom_output_path(tmp_repo, monkeypatch):
    monkeypatch.chdir(tmp_repo.root)
    store = MemoryStore(tmp_repo.root / ".proofjury")
    store.append(_record(advisories=[_advisory(label="confirmed")]))
    target = tmp_repo.root / "custom" / "ds.jsonl"

    result = runner.invoke(app, ["memory", "finetune", "--dry-run", "-o", str(target)])
    assert result.exit_code == 0
    assert target.is_file()


def test_cli_live_submit_without_key_fails_but_keeps_the_dataset(tmp_repo, monkeypatch):
    monkeypatch.chdir(tmp_repo.root)
    monkeypatch.delenv("PIONEER_API_KEY", raising=False)
    store = MemoryStore(tmp_repo.root / ".proofjury")
    store.append(_record(advisories=[_advisory(label="confirmed")]))

    result = runner.invoke(app, ["memory", "finetune"])
    assert result.exit_code == 1
    assert (tmp_repo.root / ".proofjury" / "finetune.jsonl").is_file()
