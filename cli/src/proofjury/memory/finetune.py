"""Fine-tune the judge on Proofjury's own labeled records.

The thesis, made executable: every gate run persists the model's INPUT
verbatim (``advisory_input``, ``checkpoint_input``) alongside the outcome
a human later labeled. Prompt and training feature are the same string by
design — so building a supervised dataset is a projection of the memory
store, not an ETL project.

What gets paired:

- **advisory** — ``advisory_input`` → the findings a human CONFIRMED,
  with rejected ones dropped. This teaches the reviewer to emit the
  findings that survived human review and stay quiet otherwise, which is
  precisely the signal a base model lacks.
- **checkpoint** — ``checkpoint_input`` → the checkpoint's outcome label
  and intent category.

Only labeled rows are emitted; an unlabeled record is an unanswered
question, not training data.

**Scrub safety.** Every field read here is the PERSISTED form, which
gate.py and checkpoint.py already ran through ``scrub_text`` before
writing. Raw prompts never touch disk, so they cannot reach a dataset
built from disk. Tests pin this by asserting the builder reads no field
that is not part of the persisted schema.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable, Mapping

import httpx

from ..judge.advisory import ADVISORY_SYSTEM_PROMPT
from ..judge.intent import REVIEW_SYSTEM_PROMPT
from .schema import MemoryRecord

TIMEOUT_SECONDS = 30.0

#: Pioneer's training API (PLAN-swarmhack H2). Overridable with
#: PIONEER_TRAINING_URL — confirm against the live account at H0.
PIONEER_TRAINING_URL = "https://api.pioneer.ai/v1/felix/training-jobs"
PIONEER_DOCS_URL = "https://docs.pioneer.ai/"

#: Human verdicts on an advisory finding. Anything else (None) means the
#: finding was never reviewed and carries no training signal.
ADVISORY_LABELS = ("confirmed", "rejected")

#: Checkpoint outcomes with a definite signal. "unclear" is deliberately
#: excluded: training a classifier on its own hedges entrenches them.
CHECKPOINT_LABELS = ("corrected", "new_task")

KIND_ADVISORY = "advisory"
KIND_CHECKPOINT = "checkpoint"


def _confirmed_findings_completion(advisories: list[dict]) -> str:
    """The reply the advisory judge SHOULD have produced: confirmed
    findings only, in the same strict-JSON shape the prompt asks for.

    An all-rejected record is not discarded — it becomes an explicit
    empty-findings example, which is how a reviewer learns restraint.
    """
    findings = []
    for entry in advisories:
        if entry.get("label") != "confirmed":
            continue
        findings.append(
            {
                "concern": entry.get("concern", ""),
                "kind": entry.get("kind", "discovery"),
                "tier": entry.get("tier", 4),
                "confidence": entry.get("confidence", 0.0),
                "grounded_in": entry.get("grounded_in", []) or [],
                "target": entry.get("target"),
            }
        )
    return json.dumps({"findings": findings}, ensure_ascii=False)


def _row(kind: str, label: str, system: str, user: str, assistant: str) -> dict:
    return {
        "kind": kind,
        "label": label,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
            {"role": "assistant", "content": assistant},
        ],
    }


def advisory_pairs(records: Iterable[MemoryRecord]) -> list[dict]:
    """One training row per record carrying at least one labeled advisory."""
    rows: list[dict] = []
    for record in records:
        if not record.advisory_input:
            continue
        labeled = [
            entry
            for entry in record.advisories
            if entry.get("label") in ADVISORY_LABELS
        ]
        if not labeled:
            continue
        confirmed = sum(1 for e in labeled if e.get("label") == "confirmed")
        rows.append(
            _row(
                KIND_ADVISORY,
                "confirmed" if confirmed else "rejected",
                ADVISORY_SYSTEM_PROMPT,
                record.advisory_input,
                _confirmed_findings_completion(record.advisories),
            )
        )
    return rows


def checkpoint_pairs(checkpoints: Iterable[dict]) -> list[dict]:
    """One training row per checkpoint with a persisted input and a
    definite outcome label."""
    rows: list[dict] = []
    for record in checkpoints:
        prompt = record.get("checkpoint_input")
        outcome = record.get("outcome") or {}
        label = outcome.get("label")
        if not prompt or label not in CHECKPOINT_LABELS:
            continue
        completion = json.dumps(
            {
                "label": label,
                "category": outcome.get("category") or "",
                "statement": outcome.get("statement") or "",
            },
            ensure_ascii=False,
        )
        rows.append(_row(KIND_CHECKPOINT, label, REVIEW_SYSTEM_PROMPT, prompt, completion))
    return rows


def build_dataset(store, ckpt_store=None) -> list[dict]:
    """Training rows from labeled memory + checkpoint records.

    Each row is ``{"kind", "label", "messages"}``; only ``messages`` is
    written to the JSONL (see ``write_jsonl``) — the other two exist so
    the CLI can report counts per label without re-deriving them.
    """
    rows = advisory_pairs(store.iter_records() if store is not None else [])
    if ckpt_store is not None:
        rows += checkpoint_pairs(ckpt_store.iter_records())
    return rows


def dataset_stats(rows: list[dict]) -> dict:
    """``{kind: {label: count}}`` plus a ``total``."""
    stats: dict = {"total": len(rows)}
    for row in rows:
        slot = stats.setdefault(row.get("kind", "?"), {})
        label = row.get("label", "?")
        slot[label] = slot.get(label, 0) + 1
    return stats


def write_jsonl(rows: list[dict], path: Path) -> Path:
    """Write the dataset in chat-SFT JSONL (one ``messages`` object/line)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps({"messages": row["messages"]}, ensure_ascii=False) + "\n")
    return path


def submit(
    dataset_path: Path,
    env: Mapping[str, str],
    *,
    base_model: str | None = None,
    poster=None,
) -> str | None:
    """Start a Pioneer fine-tune from ``dataset_path``; return the job ref.

    Returns None when no key is configured or the call fails — a failed
    submit must never take a CLI process down with a traceback. ``poster``
    is the injection point used by tests.
    """
    api_key = env.get("PIONEER_API_KEY")
    if not api_key:
        return None
    url = env.get("PIONEER_TRAINING_URL") or PIONEER_TRAINING_URL
    payload = {
        "training_file": Path(dataset_path).read_text(encoding="utf-8"),
        "method": "sft",
    }
    if base_model:
        payload["base_model"] = base_model
    headers = {"X-API-Key": api_key, "Content-Type": "application/json"}
    try:
        data = (poster or _post)(url, headers, payload)
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    for key in ("job_id", "id", "training_job_id", "job"):
        value = data.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _post(url: str, headers: dict, payload: dict) -> object:
    with httpx.Client(timeout=TIMEOUT_SECONDS) as client:
        response = client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        return response.json()
