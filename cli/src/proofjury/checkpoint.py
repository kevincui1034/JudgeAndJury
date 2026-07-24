"""Claim-of-done checkpoints — the intent-alignment sensor (ROADMAP-intent.md).

A checkpoint is recorded when a coding agent ends a turn (Stop hook), a
commit lands (git fallback), or the user runs ``proofjury checkpoint`` —
and the worktree actually changed since the last checkpoint. Recording is
deterministic and free; guards keep pure-conversation turns out. LLM work
(classification of the user's next message, intent review of the diff)
is best-effort, BYOK, and — except opt-in active mode — runs in a
detached background worker so a turn is never slowed.

Checkpoints live in their own ``.proofjury/checkpoints.jsonl``: they are
high-volume, never enter gate recall, and never sync to the dashboard in
v1 — keeping the pinned §5 gate-record schema untouched.

Privacy invariant: raw user prompts are never written to disk. The
classifier receives prompt text via stdin/memory only; what persists is
the distilled, scrubbed outcome statement.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator, Mapping

from . import __version__
from .config import (
    checkpoint_settings,
    checkpoints_enabled,
    prefs_enabled,
    prefs_settings,
)
from .context import _git, load_config, resolve_repo_id
from .gate import scrub_text
from .judge.intent import (
    CLASSIFY_SYSTEM_PROMPT,
    REVIEW_SYSTEM_PROMPT,
    get_intent_chat,
    parse_classification,
    parse_review_findings,
)
from .memory import prefs as prefs_module
from .memory.recall import advisory_signature, rejected_advisory_signatures
from .memory.store import MemoryStore, _lock_file, _unlock_file
from .session import now_iso, worktree_digest

CHECKPOINT_SCHEMA_VERSION = "1"
DIFF_EXCERPT_MAX_LINES = 200
#: An unlabeled checkpoint older than this is never labeled by a new
#: prompt — the conversation has clearly moved on.
MAX_LABEL_AGE_HOURS = 6
#: Below this classifier confidence the outcome stays ``unknown`` —
#: conservative by design (a mislabel pollutes graduation).
CLASSIFY_MIN_CONFIDENCE = 0.6
#: How many recent checkpoints the staged-findings drain scans.
DRAIN_SCAN_RECENT = 20

_CKPT_ID_RE = re.compile(r"ckpt_(\d+)$")


# --------------------------------------------------------------------------
# store
# --------------------------------------------------------------------------


class CheckpointStore:
    """Append-mostly JSONL under ``.proofjury/`` — same locking discipline
    as MemoryStore (shared ``.proofjury/lock``), its own counter file."""

    def __init__(self, root: Path):
        self.root = Path(root)  # the .proofjury directory
        self.jsonl_path = self.root / "checkpoints.jsonl"
        self.counter_path = self.root / "ckpt-counter"
        self.lock_path = self.root / "lock"

    @contextmanager
    def _exclusive_lock(self):
        self.root.mkdir(parents=True, exist_ok=True)
        with self.lock_path.open("a+") as fh:
            _lock_file(fh)
            try:
                yield
            finally:
                _unlock_file(fh)

    def next_id(self) -> str:
        with self._exclusive_lock():
            current = 0
            if self.counter_path.is_file():
                try:
                    current = int(self.counter_path.read_text().strip() or 0)
                except ValueError:
                    current = 0
            for record in self.iter_records():
                match = _CKPT_ID_RE.match(record.get("id", ""))
                if match:
                    current = max(current, int(match.group(1)))
            current += 1
            self.counter_path.write_text(str(current))
            return f"ckpt_{current:03d}"

    def append(self, record: dict) -> None:
        line = json.dumps(record, ensure_ascii=False)
        with self._exclusive_lock():
            with self.jsonl_path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
                fh.flush()
                os.fsync(fh.fileno())

    def iter_records(self) -> Iterator[dict]:
        if not self.jsonl_path.is_file():
            return
        with self.jsonl_path.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(data, dict) and data.get("id"):
                    yield data

    def get(self, ckpt_id: str) -> dict | None:
        for record in self.iter_records():
            if record.get("id") == ckpt_id:
                return record
        return None

    def latest(self) -> dict | None:
        last = None
        for record in self.iter_records():
            last = record
        return last

    def update(self, ckpt_id: str, fields: dict) -> bool:
        """Set top-level ``fields`` on one record via atomic rewrite."""
        if not self.jsonl_path.is_file():
            return False
        with self._exclusive_lock():
            found = False
            out_lines: list[str] = []
            with self.jsonl_path.open(encoding="utf-8") as fh:
                for line in fh:
                    stripped = line.strip()
                    if not stripped:
                        continue
                    try:
                        data = json.loads(stripped)
                    except json.JSONDecodeError:
                        out_lines.append(stripped)
                        continue
                    if data.get("id") == ckpt_id:
                        data.update(fields)
                        found = True
                    out_lines.append(json.dumps(data, ensure_ascii=False))
            if not found:
                return False
            fd, tmp = tempfile.mkstemp(dir=self.root, prefix=".ckpt-")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as fh:
                    fh.write("\n".join(out_lines) + "\n")
                    fh.flush()
                    os.fsync(fh.fileno())
                os.replace(tmp, self.jsonl_path)
            finally:
                if os.path.exists(tmp):
                    os.unlink(tmp)
            return True


def get_store(root: Path) -> CheckpointStore:
    return CheckpointStore(Path(root) / ".proofjury")


# --------------------------------------------------------------------------
# sensor
# --------------------------------------------------------------------------


def _parse_iso(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _changed_files(root: Path) -> list[str]:
    status = _git(root, "status", "--porcelain", "-uall") or ""
    files: list[str] = []
    for line in status.splitlines():
        if len(line) > 3:
            path = line[3:].strip().strip('"')
            if ".proofjury" not in Path(path).parts:
                files.append(path)
    return files


def _drop_proofjury_sections(diff: str) -> str:
    parts = diff.split("diff --git ")
    kept = [parts[0]] + [
        part for part in parts[1:] if ".proofjury" not in part.split("\n", 1)[0]
    ]
    return "diff --git ".join(kept)


def _diff_since(root: Path, last: dict | None) -> tuple[str, int]:
    """(excerpt, line count) of what changed since the last checkpoint.

    Dirty worktree → ``git diff HEAD``. Clean worktree after a commit →
    the range from the last checkpoint's head (so committed work still
    checkpoints). Untracked files never appear in a diff, so their line
    counts are added separately (capped per file).
    """
    diff = _drop_proofjury_sections(_git(root, "diff", "HEAD") or "")
    if not diff.strip():
        head = (_git(root, "rev-parse", "HEAD") or "").strip()
        last_head = (last or {}).get("head_sha")
        if head and last_head and head != last_head:
            diff = _drop_proofjury_sections(
                _git(root, "diff", f"{last_head}..{head}") or ""
            )
    lines = diff.splitlines()
    count = len(lines)
    excerpt = "\n".join(lines[:DIFF_EXCERPT_MAX_LINES])
    if count > DIFF_EXCERPT_MAX_LINES:
        excerpt += f"\n… (+{count - DIFF_EXCERPT_MAX_LINES} more diff lines truncated)"
    status = _git(root, "status", "--porcelain", "-uall") or ""
    for line in status.splitlines():
        if not line.startswith("??"):
            continue
        path = root / line[3:].strip().strip('"')
        if ".proofjury" in path.parts or not path.is_file():
            continue
        try:
            count += min(
                sum(1 for _ in path.open("r", encoding="utf-8", errors="replace")),
                DIFF_EXCERPT_MAX_LINES,
            )
        except OSError:
            continue
    return excerpt, count


def record_checkpoint(
    root: Path,
    env: Mapping[str, str],
    *,
    event: str = "stop",
    task: str | None = None,
    session_id: str | None = None,
) -> dict | None:
    """Record one claim-of-done checkpoint, or None when a guard says the
    turn produced nothing checkpoint-worthy. Deterministic — no LLM."""
    root = Path(root)
    config = load_config(root)
    if not checkpoints_enabled(config, env):
        return None
    settings = checkpoint_settings(config)
    store = get_store(root)
    last = store.latest()

    digest = worktree_digest(root)
    if last is not None and last.get("digest") == digest:
        return None  # nothing changed since the last checkpoint

    hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
    recent = 0
    for record in store.iter_records():
        created = _parse_iso(record.get("created_at", ""))
        if created is not None and created >= hour_ago:
            recent += 1
    if recent >= settings["max_per_hour"]:
        return None

    excerpt, diff_lines = _diff_since(root, last)
    if diff_lines < settings["min_diff_lines"]:
        return None

    record = {
        "id": store.next_id(),
        "created_at": now_iso(),
        "repo_id": resolve_repo_id(root),
        "session_id": session_id or None,
        "event": event,
        "task": scrub_text(task, dict(env)) if task else None,
        "branch": (_git(root, "rev-parse", "--abbrev-ref", "HEAD") or "").strip() or None,
        "head_sha": (_git(root, "rev-parse", "HEAD") or "").strip() or None,
        "digest": digest,
        "changed_files": _changed_files(root),
        "diff_lines": diff_lines,
        "diff_excerpt": scrub_text(excerpt, dict(env)),
        "outcome": None,
        "findings": [],
        "checkpoint_input": None,
        "checkpoint_output": None,
        "schema_version": CHECKPOINT_SCHEMA_VERSION,
        "cli_version": __version__,
    }
    store.append(record)
    return record


# --------------------------------------------------------------------------
# classification (I2) — the next user message labels the checkpoint
# --------------------------------------------------------------------------

_NEGATION_OPENERS = (
    "no", "not", "nope", "don't", "dont", "stop", "undo", "revert",
    "instead", "actually", "wrong", "that's not", "thats not", "why did",
)


def _classification_target(store: CheckpointStore, session_id: str | None) -> dict | None:
    """The checkpoint the incoming prompt labels: the most recent
    unlabeled one — same session when known — that is still fresh."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=MAX_LABEL_AGE_HOURS)
    target = None
    for record in store.iter_records():
        if record.get("outcome") is not None:
            continue
        if session_id and record.get("session_id") not in (None, session_id):
            continue
        created = _parse_iso(record.get("created_at", ""))
        if created is None or created < cutoff:
            continue
        target = record  # file order == chronological → keep the last
    return target


def _classification_input(record: dict, prompt_text: str) -> str:
    """Classifier input. Contains the raw prompt — sent to the model,
    NEVER persisted (the persisted outcome is the distilled statement)."""
    hints = []
    lowered = prompt_text.strip().lower()
    if any(lowered.startswith(neg) for neg in _NEGATION_OPENERS):
        hints.append("message opens with a negation/redirect word")
    mentioned = [
        f for f in record.get("changed_files", []) if f and f in prompt_text
    ]
    if mentioned:
        hints.append(f"message mentions files the agent just changed: {', '.join(mentioned[:5])}")
    lines = [
        "Previous checkpoint (work the agent just claimed done):",
        f"- task: {record.get('task') or '(unknown)'}",
        f"- changed files: {', '.join(record.get('changed_files', [])[:10]) or '(none)'}",
        "",
        "The user's next message:",
        prompt_text.strip(),
        "",
        f"Deterministic hints: {'; '.join(hints) or 'none'}",
    ]
    return "\n".join(lines)


def classify_and_label(
    root: Path,
    env: Mapping[str, str],
    prompt_text: str,
    session_id: str | None,
    chat=None,
) -> dict | None:
    """Label the latest unlabeled checkpoint from the user's new message.
    Best-effort: no LLM / low confidence / any error → outcome stays
    unlabeled (``unknown`` is the honest default). Returns the outcome."""
    if not prompt_text or not prompt_text.strip():
        return None
    root = Path(root)
    config = load_config(root)
    if not checkpoints_enabled(config, env):
        return None
    store = get_store(root)
    target = _classification_target(store, session_id)
    if target is None:
        return None
    if chat is None:
        chat = get_intent_chat(env, root, config)
    if chat is None:
        return None
    try:
        content, model_id, _cost = chat(
            CLASSIFY_SYSTEM_PROMPT, _classification_input(target, prompt_text)
        )
    except Exception:
        return None
    parsed = parse_classification(content)
    if parsed is None or parsed["confidence"] < CLASSIFY_MIN_CONFIDENCE:
        return None
    label = {
        "corrected": "corrected",
        "new_task": "accepted_implicit",  # moving on = weak acceptance (locked)
        "unclear": None,
    }[parsed["kind"]]
    if label is None:
        return None
    outcome = {
        "label": label,
        "statement": scrub_text(parsed["statement"], dict(env)) if parsed["statement"] else "",
        "category": parsed["category"] if label == "corrected" else "",
        "confidence": parsed["confidence"],
        "classified_by": model_id,
        "at": now_iso(),
    }
    store.update(target["id"], {"outcome": outcome})
    if label == "corrected" and outcome["category"]:
        try:
            maybe_graduate(root, env, outcome["category"], chat=chat)
        except Exception:
            pass  # graduation is a bonus, never a failure mode
    return outcome


# --------------------------------------------------------------------------
# graduation (I4) — corrections crystallize into candidate preferences
# --------------------------------------------------------------------------

SYNTHESIZE_SYSTEM_PROMPT = (
    "Distill these correction statements from one user into a single "
    "short, durable preference sentence (third person, imperative-free, "
    'e.g. "prefers modules under a few hundred lines"). Respond as strict '
    'JSON: {"statement": "<one sentence>"}.'
)


def maybe_graduate(
    root: Path,
    env: Mapping[str, str],
    category: str,
    chat=None,
) -> dict | None:
    """≥N corrections sharing a category → synthesize ONE candidate
    preference (repo scope). Any existing pref for the category —
    candidate, active, or rejected — suppresses re-graduation."""
    if not category or category == "other":
        return None  # the catch-all never graduates
    root = Path(root)
    config = load_config(root)
    if not prefs_enabled(config, env):
        return None
    settings = prefs_settings(config)
    pref_store = prefs_module.repo_store(root)
    if prefs_module.has_pref_for_category(pref_store, category):
        return None
    corrections = [
        record
        for record in get_store(root).iter_records()
        if (record.get("outcome") or {}).get("label") == "corrected"
        and (record.get("outcome") or {}).get("category") == category
    ]
    if len(corrections) < settings["graduation_min_corrections"]:
        return None
    statements = [
        (record["outcome"].get("statement") or "").strip()
        for record in corrections
        if (record["outcome"].get("statement") or "").strip()
    ]
    if not statements:
        return None
    statement = statements[-1]  # offline fallback: the freshest correction
    if chat is not None:
        try:
            content, _model, _cost = chat(
                SYNTHESIZE_SYSTEM_PROMPT,
                "\n".join(f"- {s}" for s in statements),
            )
            parsed = json.loads(content.strip().strip("`").strip())
            if isinstance(parsed, dict) and isinstance(parsed.get("statement"), str):
                cleaned = " ".join(parsed["statement"].split())
                if cleaned:
                    statement = cleaned
        except Exception:
            pass
    return pref_store.add(
        scrub_text(statement, dict(env)),
        category,
        status="candidate",
        evidence=[record["id"] for record in corrections],
        now=now_iso(),
    )


# --------------------------------------------------------------------------
# intent review (I3) — advisory-shaped findings at the checkpoint
# --------------------------------------------------------------------------


def _review_input(root: Path, env: Mapping[str, str], record: dict) -> str:
    """Reviewer input — persisted verbatim as ``checkpoint_input`` (the
    training feature IS the runtime prompt, like advisory_input)."""
    active = prefs_module.active_prefs(root, env)
    changed = set(record.get("changed_files", []))
    recent_corrections = []
    for prior in get_store(root).iter_records():
        if prior.get("id") == record.get("id"):
            continue
        outcome = prior.get("outcome") or {}
        if outcome.get("label") != "corrected" or not outcome.get("statement"):
            continue
        if changed and not changed.intersection(prior.get("changed_files", [])):
            continue
        recent_corrections.append(outcome["statement"])
    lines = [
        f"Proofjury intent review — checkpoint {record.get('id')}",
        f"Task the user asked for: {record.get('task') or '(unknown — no tier-5 findings)'}",
        f"Changed files: {', '.join(sorted(changed)[:10]) or '(none)'}",
        "",
        "Diff since the last checkpoint:",
        record.get("diff_excerpt") or "(unavailable)",
        "",
        "Active user preferences:",
    ]
    lines += [f"- {p['statement']}" for p in active] or ["- none"]
    lines.append("")
    lines.append("Recent corrections on these files:")
    lines += [f"- {s}" for s in recent_corrections[-5:]] or ["- none"]
    return "\n".join(lines)


def run_intent_review(
    root: Path,
    env: Mapping[str, str],
    ckpt_id: str,
    chat=None,
) -> list[dict]:
    """Review one checkpoint; store findings and stage the confident ones
    for next-prompt injection. Best-effort: any error → no findings."""
    root = Path(root)
    config = load_config(root)
    if not checkpoints_enabled(config, env):
        return []
    settings = checkpoint_settings(config)
    store = get_store(root)
    record = store.get(ckpt_id)
    if record is None or record.get("findings"):
        return []
    if chat is None:
        chat = get_intent_chat(env, root, config, for_review=True)
    if chat is None:
        return []
    input_text = _review_input(root, env, record)
    try:
        content, model_id, _cost = chat(REVIEW_SYSTEM_PROMPT, input_text)
    except Exception:
        return []
    findings = parse_review_findings(content)
    # Same suppression the gate advisory surface uses: a human-rejected
    # concern signature never re-fires, at checkpoints either.
    rejected = rejected_advisory_signatures(MemoryStore(root / ".proofjury"), record["repo_id"])
    entries: list[dict] = []
    for index, finding in enumerate(findings):
        if advisory_signature(finding.concern, finding.target) in rejected:
            continue
        delivery = (
            "staged"
            if finding.confidence >= settings["auto_inject_min_confidence"]
            else "recorded"
        )
        entries.append(
            {
                "id": f"{ckpt_id}#{index}",
                "concern": scrub_text(finding.concern, dict(env)),
                "kind": "intent",
                "tier": finding.tier,
                "confidence": round(finding.confidence, 3),
                "target": finding.target,
                "delivery": delivery,
            }
        )
    store.update(
        ckpt_id,
        {
            "findings": entries,
            "checkpoint_input": scrub_text(input_text, dict(env)),
            "checkpoint_output": scrub_text(content or "", dict(env)),
        },
    )
    return entries


def drain_staged_findings(root: Path) -> tuple[str, list[tuple[str, int]]]:
    """(context text, [(ckpt_id, finding index)]) for every staged intent
    finding in recent checkpoints. Caller delivers FIRST, then marks via
    ``mark_findings_sent`` — a crash re-delivers rather than drops."""
    store = get_store(Path(root))
    recent = list(store.iter_records())[-DRAIN_SCAN_RECENT:]
    lines: list[str] = []
    pending: list[tuple[str, int]] = []
    for record in recent:
        for index, entry in enumerate(record.get("findings", [])):
            if entry.get("delivery") != "staged":
                continue
            target = f" ({entry['target']})" if entry.get("target") else ""
            lines.append(
                f"- [{record['id']}#{index}, tier {entry.get('tier')}, "
                f"confidence {entry.get('confidence', 0):.2f}]{target}: "
                f"{entry.get('concern')}"
            )
            pending.append((record["id"], index))
    if not lines:
        return "", []
    text = (
        "Proofjury intent review of your last completed work (advisory "
        "context only — the user's request always wins):\n" + "\n".join(lines)
    )
    return text, pending


def mark_findings_sent(root: Path, pending: list[tuple[str, int]]) -> None:
    store = get_store(Path(root))
    for ckpt_id, index in pending:
        record = store.get(ckpt_id)
        if record is None:
            continue
        findings = record.get("findings", [])
        if 0 <= index < len(findings):
            findings[index]["delivery"] = "sent"
            store.update(ckpt_id, {"findings": findings})


# --------------------------------------------------------------------------
# background worker spawn
# --------------------------------------------------------------------------


def spawn_worker(
    root: Path,
    args: list[str],
    stdin_text: str | None,
    env: Mapping[str, str],
) -> None:
    """Detached ``python -m proofjury intent-worker …``. The hook returns
    immediately; the worker owns any LLM latency. Prompt text travels via
    the worker's stdin — memory only, never argv (visible in ps), never a
    file (the raw-prompt privacy invariant)."""
    process = subprocess.Popen(
        [sys.executable, "-m", "proofjury", "intent-worker", *args],
        cwd=root,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=dict(env),
        start_new_session=True,
    )
    try:
        if process.stdin is not None:
            if stdin_text:
                process.stdin.write(stdin_text.encode("utf-8", errors="replace"))
            process.stdin.close()
    except (BrokenPipeError, OSError):
        pass
