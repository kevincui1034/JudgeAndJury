"""Surgical, comment-preserving edits to ``.proofjury.toml``.

The dashboard writes a row; THIS MACHINE writes the file. A config patch
arrives as a label event and is applied here, locally, by the CLI.

Two invariants make that safe:

1. **Allowlist.** Only tables that govern an already-non-blocking surface
   may be edited from the web. The read-only set is exactly the set that
   could weaken the gate — ``[actions]`` (which checks run), ``[hook]``
   (whether the gate fires at all), ``[commands]`` (how checks run),
   ``[env]`` (what environment env_vars is evaluated against) — so a
   stolen web session can never turn the gate off, only tune advice.
2. **Never retroactive.** Records are immutable snapshots of a completed
   run. Config feeds FUTURE runs only; no patch can change a past verdict.

The file is edited line-by-line rather than parsed and re-rendered:
``.proofjury.toml`` ships ~95 lines of user-facing documentation comments
(hooks.py PROOFJURY_TOML_TEMPLATE), and a tomllib -> re-render round trip
would delete every one of them.
"""

from __future__ import annotations

import hashlib
import re
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import _atomic_write, _toml_scalar

#: Tables a dashboard may patch. Each governs a surface that is already
#: incapable of blocking: advisory findings, impact context, recall,
#: semantic search, conventions, checkpoints, preferences.
EDITABLE_TABLES = frozenset(
    {
        "advisory",
        "impact",
        "memory",
        "semantic",
        "conventions",
        "checkpoint",
        "prefs",
    }
)

#: Explicitly NOT editable — these decide whether/how the gate runs.
LOCAL_ONLY_TABLES = frozenset(
    {"commands", "env", "actions", "hook", "session", "checks"}
)


@dataclass
class PatchResult:
    applied: bool
    reason: str = ""
    new_hash: str = ""


def file_hash(root: Path) -> str:
    try:
        return hashlib.sha256((Path(root) / ".proofjury.toml").read_bytes()).hexdigest()
    except OSError:
        return ""


def _render_value(value: Any) -> str:
    if isinstance(value, list):
        return "[" + ", ".join(_toml_scalar(v) for v in value) + "]"
    return _toml_scalar(value)


def _clamp(table: str, key: str, value: Any) -> Any:
    """Apply the same bounds the Python readers apply, so a web value can
    never put the file into a state config.py would silently reject."""
    if table in ("advisory", "checkpoint") and key.endswith("_confidence"):
        try:
            return min(1.0, max(0.0, float(value)))
        except (TypeError, ValueError):
            return None
    if table == "advisory" and key == "tiers":
        if not isinstance(value, list):
            return None
        kept = [t for t in value if isinstance(t, int) and t in (4, 5)]
        # An empty list mutes the entire advisory surface — almost certainly
        # not what a click meant, so refuse rather than silently disable it.
        return kept or None
    return value


def _set_in_section(lines: list[str], table: str, key: str, rendered: str) -> list[str]:
    """Replace ``key = ...`` inside ``[table]``, uncommenting a templated
    default if that is how it appears; insert after the header when absent;
    append the whole table when the header is missing."""
    header_re = re.compile(rf"^\s*\[{re.escape(table)}\]\s*$")
    key_re = re.compile(rf"^(\s*)#?\s*{re.escape(key)}\s*=")

    start = next((i for i, l in enumerate(lines) if header_re.match(l)), None)
    if start is None:
        # New table. Keep [hook] last — proofjury init appends detected
        # deploy patterns to the end of that section.
        hook_at = next(
            (i for i, l in enumerate(lines) if re.match(r"^\s*\[hook\]\s*$", l)), None
        )
        block = ["", f"[{table}]", f"{key} = {rendered}"]
        if hook_at is None:
            return lines + block
        return lines[:hook_at] + block + [""] + lines[hook_at:]

    end = len(lines)
    for i in range(start + 1, len(lines)):
        if lines[i].lstrip().startswith("["):
            end = i
            break

    for i in range(start + 1, end):
        if key_re.match(lines[i]):
            indent = key_re.match(lines[i]).group(1)
            lines[i] = f"{indent}{key} = {rendered}"
            return lines
    return lines[: start + 1] + [f"{key} = {rendered}"] + lines[start + 1 :]


def _unset_in_section(lines: list[str], table: str, key: str) -> list[str]:
    header_re = re.compile(rf"^\s*\[{re.escape(table)}\]\s*$")
    key_re = re.compile(rf"^\s*{re.escape(key)}\s*=")
    start = next((i for i, l in enumerate(lines) if header_re.match(l)), None)
    if start is None:
        return lines
    end = len(lines)
    for i in range(start + 1, len(lines)):
        if lines[i].lstrip().startswith("["):
            end = i
            break
    return [
        l for i, l in enumerate(lines) if not (start < i < end and key_re.match(l))
    ]


def apply_patch(root: Path, payload: dict) -> PatchResult:
    """Apply one ``config_patch`` event. Never raises."""
    table = str(payload.get("table") or "")
    if table in LOCAL_ONLY_TABLES:
        return PatchResult(False, f"[{table}] is local-only and cannot be set remotely")
    if table not in EDITABLE_TABLES:
        return PatchResult(False, f"[{table}] is not an editable table")

    path = Path(root) / ".proofjury.toml"
    try:
        raw = path.read_bytes()
    except OSError:
        return PatchResult(False, ".proofjury.toml not found")

    current = hashlib.sha256(raw).hexdigest()
    base = payload.get("base_hash")
    if base and base != current:
        # The local file moved since the dashboard read it. Refuse rather
        # than clobber a local edit; the conflict is reported upward.
        return PatchResult(False, "base_hash mismatch — local file changed")

    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return PatchResult(False, ".proofjury.toml is not valid UTF-8")

    lines = text.split("\n")
    changed = False

    for key, value in (payload.get("set") or {}).items():
        clamped = _clamp(table, str(key), value)
        if clamped is None:
            continue  # out of bounds — skip this key, keep the rest
        lines = _set_in_section(lines, table, str(key), _render_value(clamped))
        changed = True

    for key in payload.get("unset") or []:
        lines = _unset_in_section(lines, table, str(key))
        changed = True

    if not changed:
        return PatchResult(False, "no applicable keys in patch")

    updated = "\n".join(lines)
    # Belt-and-braces: a corrupt file makes context.load_config return {},
    # which would silently reset every knob to its default. Never ship an
    # edit we cannot parse back.
    try:
        tomllib.loads(updated)
    except tomllib.TOMLDecodeError as exc:
        return PatchResult(False, f"patch produced invalid TOML ({exc})")

    try:
        _atomic_write(path, updated)
    except OSError as exc:
        return PatchResult(False, f"could not write .proofjury.toml ({exc})")

    return PatchResult(True, new_hash=hashlib.sha256(updated.encode()).hexdigest())
