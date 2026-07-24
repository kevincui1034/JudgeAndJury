"""Learned user preferences — the durable output of intent corrections.

Two scopes, two files (ROADMAP-intent.md I4):
- repo:  ``.proofjury/preferences.jsonl`` — "this project uses Tailwind"
- user:  ``${XDG_CONFIG_HOME:-~/.config}/proofjury/preferences.jsonl`` —
  "prefers small files", follows the user across repos

Lifecycle: ``candidate`` (synthesized when ≥N corrections share a
category) → ``active`` (ONLY by explicit ``proofjury prefs approve``) or
``rejected`` (suppresses re-graduation of that category+scope forever,
mirroring rejected advisory signatures). Only active preferences are ever
injected into an agent's context. Statements are distilled and scrubbed —
never raw transcript text; evidence is checkpoint-record-id pointers.

Personal-only by locked decision: preferences never enter committed
files; team conventions will be a separate human-authored surface.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Iterator, Mapping

from ..config import config_path

SCOPES = ("repo", "user")
STATUSES = ("candidate", "active", "rejected")

_PREF_ID_RE = re.compile(r"pref_(\d+)$")


def user_prefs_path(env: Mapping[str, str] | None = None) -> Path:
    return config_path(env).with_name("preferences.jsonl")


def repo_prefs_path(root: Path) -> Path:
    return Path(root) / ".proofjury" / "preferences.jsonl"


class PrefStore:
    """One scope's preference file. Atomic rewrite on update; append is a
    read-rewrite too (the files are tiny — tens of lines, not thousands)."""

    def __init__(self, path: Path, scope: str):
        self.path = Path(path)
        self.scope = scope

    def _read(self) -> list[dict]:
        if not self.path.is_file():
            return []
        out: list[dict] = []
        try:
            for line in self.path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(data, dict) and data.get("id"):
                    out.append(data)
        except OSError:
            return []
        return out

    def _write(self, prefs: list[dict]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=".prefs-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                for pref in prefs:
                    fh.write(json.dumps(pref, ensure_ascii=False) + "\n")
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, self.path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def list(self) -> list[dict]:
        return self._read()

    def get(self, pref_id: str) -> dict | None:
        for pref in self._read():
            if pref.get("id") == pref_id:
                return pref
        return None

    def _next_id(self, prefs: list[dict]) -> str:
        max_n = 0
        for pref in prefs:
            match = _PREF_ID_RE.match(str(pref.get("id", "")))
            if match:
                max_n = max(max_n, int(match.group(1)))
        return f"pref_{max_n + 1:03d}"

    def add(
        self,
        statement: str,
        category: str,
        *,
        status: str = "candidate",
        evidence: list[str] | None = None,
        now: str = "",
    ) -> dict:
        prefs = self._read()
        pref = {
            "id": self._next_id(prefs),
            "statement": " ".join(str(statement).split()),
            "category": category,
            "scope": self.scope,
            "status": status,
            "evidence": list(evidence or []),
            "created_at": now,
            "updated_at": now,
        }
        prefs.append(pref)
        self._write(prefs)
        return pref

    def set_status(self, pref_id: str, status: str, now: str = "") -> bool:
        if status not in STATUSES:
            return False
        prefs = self._read()
        for pref in prefs:
            if pref.get("id") == pref_id:
                pref["status"] = status
                pref["updated_at"] = now
                self._write(prefs)
                return True
        return False

    def remove(self, pref_id: str) -> bool:
        prefs = self._read()
        kept = [p for p in prefs if p.get("id") != pref_id]
        if len(kept) == len(prefs):
            return False
        self._write(kept)
        return True

    def add_evidence(self, pref_id: str, checkpoint_id: str, now: str = "") -> bool:
        prefs = self._read()
        for pref in prefs:
            if pref.get("id") == pref_id:
                evidence = pref.setdefault("evidence", [])
                if checkpoint_id not in evidence:
                    evidence.append(checkpoint_id)
                pref["updated_at"] = now
                self._write(prefs)
                return True
        return False


def repo_store(root: Path) -> PrefStore:
    return PrefStore(repo_prefs_path(root), "repo")


def user_store(env: Mapping[str, str] | None = None) -> PrefStore:
    return PrefStore(user_prefs_path(env), "user")


def iter_all(root: Path, env: Mapping[str, str] | None = None) -> Iterator[dict]:
    """Repo prefs first (they take precedence in rendering), then user."""
    yield from repo_store(root).list()
    yield from user_store(env).list()


def active_prefs(root: Path, env: Mapping[str, str] | None = None) -> list[dict]:
    return [p for p in iter_all(root, env) if p.get("status") == "active"]


def has_pref_for_category(store: PrefStore, category: str) -> bool:
    """Any pref (any status) already covering ``category`` in this scope —
    a rejected one suppresses re-graduation; an existing candidate/active
    one means there is nothing new to synthesize."""
    return any(p.get("category") == category for p in store.list())


def render_for_injection(prefs: list[dict]) -> str:
    """The context block agents receive. Statements only — no ids, no
    evidence, no lifecycle noise; the agent needs the preference, not the
    bookkeeping."""
    if not prefs:
        return ""
    lines = [
        "Proofjury — learned preferences for this user/repo (apply them "
        "unless the user's current request says otherwise):"
    ]
    for pref in prefs:
        lines.append(f"- {pref.get('statement')}")
    return "\n".join(lines)
