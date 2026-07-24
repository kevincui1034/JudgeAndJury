"""browser_qa_not_run / browser_qa_failed (PLAN-swarmhack H4, prong A).

A sponsor-backed check that fails the gate the same way tests_not_run
does — from recorded facts (exit code + worktree digest), never model
output. The load-bearing invariant is the opt-in: a repo without
``[commands] qa`` must behave EXACTLY as it did before this check
existed, which is what keeps every pre-existing repo, test, and the demo
untouched.
"""

import json
import sys

from typer.testing import CliRunner

from proofjury.checks import CHECK_NAMES, REGISTRY
from proofjury.checks.browser_qa import check_browser_qa, parse_replay_summary
from proofjury.cli import app
from proofjury.session import load_session, stamp

runner = CliRunner()

QA_CONFIG = {"commands": {"qa": "npx replay-qa run"}}


# --------------------------------------------------------------------------
# opt-in: unconfigured repos are untouched
# --------------------------------------------------------------------------


def test_skipped_when_qa_not_configured(tmp_repo, make_ctx):
    tmp_repo.write("svc.py", "x = 1\n")
    result = check_browser_qa(make_ctx(tmp_repo.root, config={}))
    assert result.skipped
    assert result.passed
    assert result.failure_class is None


def test_no_autodetection_from_package_json(tmp_repo, make_ctx):
    """Unlike `build`, there is no package.json fallback — an `npm run qa`
    script must not silently arm a blocking check on someone's repo."""
    tmp_repo.write("package.json", json.dumps({"scripts": {"qa": "playwright test"}}))
    result = check_browser_qa(make_ctx(tmp_repo.root, config={}))
    assert result.skipped


# --------------------------------------------------------------------------
# marker lifecycle (mirrors the tests check)
# --------------------------------------------------------------------------


def test_marker_absent_fails_browser_qa_not_run(tmp_repo, make_ctx):
    tmp_repo.write("svc.py", "x = 1\n")
    result = check_browser_qa(make_ctx(tmp_repo.root, config=QA_CONFIG))
    assert not result.passed
    assert result.failure_class == "browser_qa_not_run"
    assert "no browser QA run recorded" in result.evidence[0].detail
    assert result.fix_hint == "Run: proofjury run qa -- npx replay-qa run"


def test_fresh_passing_marker_passes(tmp_repo, make_ctx):
    tmp_repo.write("svc.py", "x = 1\n")
    stamp(tmp_repo.root, "qa", 0, ["npx", "replay-qa", "run"])
    assert check_browser_qa(make_ctx(tmp_repo.root, config=QA_CONFIG)).passed


def test_stale_digest_fails(tmp_repo, make_ctx):
    """The demo line: 'blocked because the browser tests Replay ran are
    stale' — editing code after QA invalidates the pass."""
    tmp_repo.write("svc.py", "x = 1\n")
    stamp(tmp_repo.root, "qa", 0, ["npx", "replay-qa", "run"])
    tmp_repo.write("new_feature.py", "y = 2\n")
    result = check_browser_qa(make_ctx(tmp_repo.root, config=QA_CONFIG))
    assert not result.passed
    assert result.failure_class == "browser_qa_not_run"
    assert "code changed since browser QA last ran" in result.evidence[0].detail


def test_marker_older_than_24h_fails(tmp_repo, make_ctx):
    tmp_repo.write("svc.py", "x = 1\n")
    stamp(tmp_repo.root, "qa", 0, ["npx", "replay-qa", "run"])
    session_file = tmp_repo.root / ".proofjury" / "session.json"
    data = json.loads(session_file.read_text())
    data["qa"]["ran_at"] = "2020-01-01T00:00:00Z"
    session_file.write_text(json.dumps(data))
    result = check_browser_qa(make_ctx(tmp_repo.root, config=QA_CONFIG))
    assert result.failure_class == "browser_qa_not_run"
    assert "older than 24h" in result.evidence[0].detail


def test_failed_marker_is_browser_qa_failed(tmp_repo, make_ctx):
    tmp_repo.write("svc.py", "x = 1\n")
    stamp(tmp_repo.root, "qa", 1, ["npx", "replay-qa", "run"])
    result = check_browser_qa(make_ctx(tmp_repo.root, config=QA_CONFIG))
    assert not result.passed
    assert result.failure_class == "browser_qa_failed"
    assert "exit code 1" in result.evidence[0].detail


# --------------------------------------------------------------------------
# Replay evidence enrichment
# --------------------------------------------------------------------------


def test_parse_replay_summary_extracts_bugs_and_recording(tmp_path):
    log = tmp_path / "qa-20260724T101500Z.log"
    log.write_text(
        "running checkout flow...\n"
        "step 3 failed\n"
        "Found 2 bugs\n"
        "recording: https://app.replay.io/recording/abc123\n"
    )
    assert parse_replay_summary(log) == "2 bugs · https://app.replay.io/recording/abc123"


def test_parse_replay_summary_singular_bug(tmp_path):
    log = tmp_path / "qa.log"
    log.write_text("1 issue found\n")
    assert parse_replay_summary(log) == "1 bug"


def test_parse_replay_summary_is_best_effort(tmp_path):
    assert parse_replay_summary(None) == ""
    assert parse_replay_summary(tmp_path / "missing.log") == ""
    unmatched = tmp_path / "qa.log"
    unmatched.write_text("all green, nothing to report\n")
    assert parse_replay_summary(unmatched) == ""


def test_failed_evidence_includes_replay_summary(tmp_repo, make_ctx):
    tmp_repo.write("svc.py", "x = 1\n")
    runs = tmp_repo.root / ".proofjury" / "runs"
    runs.mkdir(parents=True, exist_ok=True)
    (runs / "qa-20260724T101500Z.log").write_text(
        "Found 3 bugs\nhttps://app.replay.io/recording/xyz789\n"
    )
    stamp(tmp_repo.root, "qa", 1, ["npx", "replay-qa", "run"])
    result = check_browser_qa(make_ctx(tmp_repo.root, config=QA_CONFIG))
    detail = result.evidence[0].detail
    assert result.failure_class == "browser_qa_failed"
    assert "3 bugs" in detail
    assert "https://app.replay.io/recording/xyz789" in detail


def test_missing_marker_evidence_omits_stale_summary(tmp_repo, make_ctx):
    """No run was ever recorded, so an old log must not be described as
    'last run' — that would misreport which worktree was tested."""
    runs = tmp_repo.root / ".proofjury" / "runs"
    runs.mkdir(parents=True, exist_ok=True)
    (runs / "qa-20200101T000000Z.log").write_text("Found 9 bugs\n")
    tmp_repo.write("svc.py", "x = 1\n")
    result = check_browser_qa(make_ctx(tmp_repo.root, config=QA_CONFIG))
    assert result.failure_class == "browser_qa_not_run"
    assert "9 bugs" not in result.evidence[0].detail


# --------------------------------------------------------------------------
# `proofjury run qa` wiring
# --------------------------------------------------------------------------


def test_run_qa_stamps_and_check_passes(tmp_repo, make_ctx, monkeypatch):
    monkeypatch.chdir(tmp_repo.root)
    result = runner.invoke(
        app, ["run", "qa", "--", sys.executable, "-c", "print('qa-ok')"]
    )
    assert result.exit_code == 0
    assert load_session(tmp_repo.root)["qa"]["exit_code"] == 0
    logs = list((tmp_repo.root / ".proofjury" / "runs").glob("qa-*.log"))
    assert len(logs) == 1
    assert check_browser_qa(make_ctx(tmp_repo.root, config=QA_CONFIG)).passed


def test_run_qa_propagates_failure(tmp_repo, make_ctx, monkeypatch):
    monkeypatch.chdir(tmp_repo.root)
    result = runner.invoke(
        app, ["run", "qa", "--", sys.executable, "-c", "import sys; sys.exit(1)"]
    )
    assert result.exit_code == 1
    check = check_browser_qa(make_ctx(tmp_repo.root, config=QA_CONFIG))
    assert check.failure_class == "browser_qa_failed"


# --------------------------------------------------------------------------
# registration + judge integration
# --------------------------------------------------------------------------


def test_check_is_registered_once():
    assert check_browser_qa in REGISTRY
    assert CHECK_NAMES[check_browser_qa] == "browser_qa"
    assert REGISTRY.count(check_browser_qa) == 1


def test_deterministic_judge_explains_both_classes():
    from proofjury.checks.base import CheckResult, Evidence
    from proofjury.judge import DeterministicJudge, JudgeInput
    from proofjury.judge.deterministic import SEVERITY_ORDER

    assert "browser_qa_failed" in SEVERITY_ORDER
    assert "browser_qa_not_run" in SEVERITY_ORDER

    for cls, expected in (
        ("browser_qa_failed", "Browser QA found defects"),
        ("browser_qa_not_run", "Browser QA has not run"),
    ):
        output = DeterministicJudge().diagnose(
            JudgeInput(
                action="deploy",
                repo_id="demo-app",
                failures=[
                    CheckResult(
                        name="browser_qa",
                        passed=False,
                        failure_class=cls,
                        evidence=[
                            Evidence(
                                file=".proofjury/session.json", line=1, detail="reason"
                            )
                        ],
                        fix_hint="Run: proofjury run qa -- npx replay-qa run",
                    )
                ],
                git_summary="",
            )
        )
        assert expected in output.diagnosis
        # No generic "<name> failed:" fallthrough.
        assert "browser_qa failed:" not in output.diagnosis


def test_severity_order_additions_did_not_reorder_existing():
    """The order is a pinned contract — new classes append."""
    from proofjury.judge.deterministic import SEVERITY_ORDER

    assert SEVERITY_ORDER[:10] == [
        "missing_env_var",
        "test_failure",
        "build_failure",
        "hardcoded_secret",
        "tests_not_run",
        "config_mismatch",
        "preprod_check_skipped",
        "pending_migration",
        "lockfile_drift",
        "unfinished_work",
    ]
