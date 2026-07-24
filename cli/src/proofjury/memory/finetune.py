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
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping

import httpx

from ..judge.advisory import ADVISORY_SYSTEM_PROMPT
from ..judge.intent import REVIEW_SYSTEM_PROMPT
from .schema import MemoryRecord

TIMEOUT_SECONDS = 30.0
UPLOAD_TIMEOUT_SECONDS = 120.0  # a dataset PUT is a body, not a control call

#: Pioneer's API root. Note there is NO ``/v1`` on the training surface —
#: ``/v1/felix/training-jobs`` 404s, ``/felix/training-jobs`` is the real
#: route (confirmed against the live account's ``/openapi.json``).
#: Overridable with PIONEER_API_BASE for a mock server in tests.
PIONEER_API_BASE = "https://api.pioneer.ai"
PIONEER_DOCS_URL = "https://docs.pioneer.ai/"

#: Training happens in three calls, not one: reserve a presigned URL, PUT
#: the file to it, then ask the API to ingest it. Only then can a job
#: reference the dataset BY NAME — the training endpoint takes dataset
#: references, never inline file content.
UPLOAD_URL_PATH = "/felix/datasets/upload/url"
UPLOAD_PROCESS_PATH = "/felix/datasets/upload/process"
TRAINING_JOBS_PATH = "/felix/training-jobs"
BASELINE_MODELS_PATH = "/felix/baseline-models"

#: ``training_algorithm`` on the wire. 'grpo'/'dpo' also exist but need
#: preference data this dataset does not carry.
TRAINING_ALGORITHM = "sft"

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


@dataclass
class SubmitResult:
    """Outcome of a submit attempt.

    ``error`` exists because the old contract — return None on any
    failure — made a wrong URL indistinguishable from a bad key, and the
    CLI then blamed the key. Every failure now says which of the three
    calls failed and why.
    """

    job_ref: str | None = None
    dataset: dict | None = None
    error: str | None = None


class _ApiError(Exception):
    """Internal: carries a human-readable reason to the SubmitResult."""


def _base(env: Mapping[str, str]) -> str:
    return (env.get("PIONEER_API_BASE") or PIONEER_API_BASE).rstrip("/")


def _headers(api_key: str) -> dict:
    return {"X-API-Key": api_key, "Content-Type": "application/json"}


def _request(method: str, url: str, headers: dict, *, json=None, content=None) -> object:
    timeout = UPLOAD_TIMEOUT_SECONDS if content is not None else TIMEOUT_SECONDS
    with httpx.Client(timeout=timeout) as client:
        response = client.request(method, url, headers=headers, json=json, content=content)
        response.raise_for_status()
        if not response.content:
            return {}
        try:
            return response.json()
        except ValueError:
            return {}


def list_base_models(env: Mapping[str, str], *, requester=None) -> list[dict]:
    """Base models this account may tune. Empty list on any failure —
    listing options must never be the thing that breaks the command."""
    api_key = env.get("PIONEER_API_KEY")
    if not api_key:
        return []
    try:
        data = (requester or _request)(
            "GET", _base(env) + BASELINE_MODELS_PATH, _headers(api_key)
        )
    except Exception:
        return []
    if isinstance(data, dict):
        data = data.get("data") or data.get("models") or data.get("baseline_models") or []
    return [m for m in data if isinstance(m, dict)] if isinstance(data, list) else []


def upload_dataset(
    dataset_path: Path,
    env: Mapping[str, str],
    *,
    dataset_name: str,
    requester=None,
) -> dict:
    """Register ``dataset_path`` with Pioneer; return a DatasetReference.

    Three calls, because the training endpoint takes references rather
    than file content: reserve a presigned URL, PUT the bytes to it, then
    ask the API to ingest what landed. The PUT goes to object storage, so
    it carries no API key — signing the URL IS the authorization.
    """
    api_key = env.get("PIONEER_API_KEY")
    if not api_key:
        raise _ApiError("no PIONEER_API_KEY configured")
    call = requester or _request
    base = _base(env)
    path = Path(dataset_path)

    reserved = call(
        "POST",
        base + UPLOAD_URL_PATH,
        _headers(api_key),
        json={
            "dataset_name": dataset_name,
            "format": "jsonl",
            "filename": path.name,
            "type": "training",  # 'evaluation' datasets are not trainable
            "generation_type": "upload",
            "visibility": "private",
        },
    )
    if not isinstance(reserved, dict):
        raise _ApiError(f"unexpected reply from {UPLOAD_URL_PATH}")
    presigned = reserved.get("presigned_url")
    dataset_id = reserved.get("dataset_id")
    if not presigned or not dataset_id:
        raise _ApiError(f"{UPLOAD_URL_PATH} returned no presigned_url/dataset_id")

    call(
        "PUT",
        presigned,
        {"Content-Type": "application/octet-stream"},
        content=path.read_bytes(),
    )
    call("POST", base + UPLOAD_PROCESS_PATH, _headers(api_key), json={"dataset_id": dataset_id})

    return {
        "name": reserved.get("dataset_name") or dataset_name,
        "version": reserved.get("version_number"),
        "dataset_id": dataset_id,
    }


def submit(
    dataset_path: Path,
    env: Mapping[str, str],
    *,
    base_model: str,
    model_name: str,
    requester=None,
) -> SubmitResult:
    """Upload ``dataset_path`` and start a Pioneer fine-tune on it.

    ``base_model`` and ``model_name`` are required by the API, so they are
    required here too rather than being silently dropped from the payload.
    Never raises — a failed submit reports through ``SubmitResult.error``
    so the dataset the user just built is never lost to a traceback.
    """
    if not env.get("PIONEER_API_KEY"):
        return SubmitResult(error="no PIONEER_API_KEY configured")
    if not base_model:
        return SubmitResult(error="a base model is required (--base-model)")

    call = requester or _request
    try:
        dataset = upload_dataset(
            dataset_path, env, dataset_name=model_name, requester=requester
        )
    except Exception as exc:
        return SubmitResult(error=f"dataset upload failed: {_reason(exc)}")

    reference = {"name": dataset["name"]}
    if dataset.get("version") is not None:
        reference["version"] = str(dataset["version"])
    url = env.get("PIONEER_TRAINING_URL") or _base(env) + TRAINING_JOBS_PATH
    try:
        data = call(
            "POST",
            url,
            _headers(env["PIONEER_API_KEY"]),
            json={
                "model_name": model_name,
                "datasets": [reference],
                "base_model": base_model,
                "training_algorithm": TRAINING_ALGORITHM,
            },
        )
    except Exception as exc:
        return SubmitResult(dataset=dataset, error=f"training job failed: {_reason(exc)}")

    if isinstance(data, dict):
        for key in ("job_id", "id", "training_job_id", "job"):
            value = data.get(key)
            if isinstance(value, str) and value:
                return SubmitResult(job_ref=value, dataset=dataset)
    return SubmitResult(
        dataset=dataset, error="training job accepted but returned no job id"
    )


def _reason(exc: Exception) -> str:
    """A message that names the actual fault — an HTTP status and body
    beat 'could not start the fine-tune'."""
    if isinstance(exc, httpx.HTTPStatusError):
        body = (exc.response.text or "").strip()[:200]
        return f"HTTP {exc.response.status_code} from {exc.request.url}: {body}"
    return f"{type(exc).__name__}: {exc}"
