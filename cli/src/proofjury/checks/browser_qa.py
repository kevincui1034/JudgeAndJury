"""browser_qa_not_run / browser_qa_failed — did a browser QA pass run
against THIS worktree?

Same session-marker mechanism as the tests and build checks, for kind
``qa``: the marker is stamped by ``proofjury run qa -- <cmd>``, so the
digest binds an agentic browser-QA pass (Replay) to the exact worktree
that was tested. Editing code after QA ran invalidates it —
"the deploy is blocked because the browser tests are stale" is a
deterministic statement about recorded facts, not a model opinion.

Skipped entirely unless ``.proofjury.toml [commands] qa`` is configured.
There is deliberately NO package.json auto-detection here (unlike build):
a repo that never opted in must behave exactly as it did before this
check existed.

Evidence is enriched, best-effort, from the stamped run's log —
Replay reports bug counts and recording URLs, and a reviewer wants the
recording link in the record, not just "exit 1".
"""

from __future__ import annotations

import re
from pathlib import Path

from .base import CheckContext, CheckResult, Evidence, register
from ..session import marker_status

SESSION_FILE = ".proofjury/session.json"

#: Replay recording permalinks — the thing a human actually clicks.
_RECORDING_RE = re.compile(r"https://app\.replay\.io/recording/\S+")

#: "3 bugs", "2 issues found", "1 failure" — tolerant of wording because
#: the exact CLI output format is not a contract we control.
_BUG_COUNT_RE = re.compile(
    r"\b(\d+)\s+(?:bug|issue|failure|defect)s?\b", re.IGNORECASE
)


def qa_applicable(ctx: CheckContext) -> tuple[bool, str]:
    """Whether browser QA is configured, and the command to suggest."""
    configured = (ctx.config.get("commands") or {}).get("qa")
    if configured:
        return True, str(configured)
    return False, ""


def _latest_qa_log(root: Path) -> Path | None:
    """Newest ``.proofjury/runs/qa-*.log`` (timestamps sort lexically)."""
    runs = Path(root) / ".proofjury" / "runs"
    try:
        logs = sorted(runs.glob("qa-*.log"))
    except OSError:
        return None
    return logs[-1] if logs else None


def parse_replay_summary(log_path: Path | None) -> str:
    """``"2 bugs · https://app.replay.io/recording/abc"`` from a QA log.

    Best-effort in every direction: no log, unreadable log, or output
    that matches nothing yields ``""`` and the evidence line is simply
    the unenriched marker reason.
    """
    if log_path is None:
        return ""
    try:
        text = log_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    parts: list[str] = []
    counts = _BUG_COUNT_RE.findall(text)
    if counts:
        # The last count wins: QA runners print a final tally after any
        # per-step chatter.
        total = counts[-1]
        noun = "bug" if total == "1" else "bugs"
        parts.append(f"{total} {noun}")
    recordings = _RECORDING_RE.findall(text)
    if recordings:
        parts.append(recordings[-1].rstrip(".,);"))
    return " · ".join(parts)


@register
def check_browser_qa(ctx: CheckContext) -> CheckResult:
    applicable, suggested = qa_applicable(ctx)
    if not applicable:
        return CheckResult(name="browser_qa", passed=True, skipped=True)

    fix_hint = f"Run: proofjury run qa -- {suggested}"
    status, marker = marker_status(ctx.session, "qa", ctx.digest)
    if status == "fresh":
        return CheckResult(name="browser_qa", passed=True)

    summary = parse_replay_summary(_latest_qa_log(ctx.root))

    if status == "failed":
        code = marker.get("exit_code") if marker else "?"
        cmd = " ".join(marker.get("cmd", [])) if marker else ""
        detail = f"browser QA run failed with exit code {code} ({cmd})"
        if summary:
            detail += f" — {summary}"
        return CheckResult(
            name="browser_qa",
            passed=False,
            failure_class="browser_qa_failed",
            evidence=[Evidence(file=SESSION_FILE, line=1, detail=detail)],
            fix_hint=fix_hint,
        )

    details = {
        "missing": "no browser QA run recorded for this worktree",
        "stale_age": "last recorded browser QA run is older than 24h",
        "stale_digest": (
            "code changed since browser QA last ran (worktree digest mismatch)"
        ),
    }
    detail = details.get(status, status)
    if summary and status != "missing":
        detail += f" — last run: {summary}"
    return CheckResult(
        name="browser_qa",
        passed=False,
        failure_class="browser_qa_not_run",
        evidence=[Evidence(file=SESSION_FILE, line=1, detail=detail)],
        fix_hint=fix_hint,
    )
