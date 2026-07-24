"""guard merge / guard release: hook triggers, check profiles, neutral copy.

Recall stays action-agnostic: a merge-time failure recalls a deploy-time
prior (same repo, same failure class, same fix).
"""

import json

from typer.testing import CliRunner

from proofjury.checks import resolve_check_profile
from proofjury.cli import app
from proofjury.gate import run_gate
from proofjury.hooks import (
    DEFAULT_MERGE_PATTERNS,
    DEFAULT_PUSH_PATTERNS,
    DEFAULT_RELEASE_PATTERNS,
    action_enabled,
    default_branch,
    handle_hook,
    is_deploy_command,
    match_action,
    push_target_branch,
)
from proofjury.memory.store import MemoryStore
from proofjury.session import stamp

runner = CliRunner()

NO_DECISION: dict = {}

FAILING_PAYMENTS = 'import os\nKEY = os.environ["STRIPE_API_KEY"]\n'


def _reason(output: dict) -> str:
    return output["hookSpecificOutput"]["permissionDecisionReason"]


# -- pattern matching ----------------------------------------------------


def test_release_patterns_match_release_commands():
    releases = [
        "npm publish",
        "pnpm publish --access public",
        "cargo publish",
        "twine upload dist/*",
        "gh release create v1.2.0",
        "git push origin --tags",
        "git push origin v1.2.3",
    ]
    for command in releases:
        assert is_deploy_command(command, DEFAULT_RELEASE_PATTERNS), command


def test_release_patterns_ignore_lookalikes():
    normal = [
        "npm run publish",  # deploy pattern's territory, not release's
        "git push origin main",
        "cat publish.md",
        "echo 'npm publish'",  # quoted string, not an invocation
        "git push origin devbranch",
    ]
    for command in normal:
        assert not is_deploy_command(command, DEFAULT_RELEASE_PATTERNS), command


def test_merge_patterns_match_and_skip_recovery_ops():
    assert is_deploy_command("git merge feature-x", DEFAULT_MERGE_PATTERNS)
    assert is_deploy_command("gh pr merge 42 --squash", DEFAULT_MERGE_PATTERNS)
    for recovery in ("git merge --abort", "git merge --continue", "git merge --quit"):
        assert not is_deploy_command(recovery, DEFAULT_MERGE_PATTERNS), recovery


def test_match_action_precedence_and_toggles():
    # deploy > release: a heroku push with tags is still a deploy
    assert match_action("git push heroku main --tags", {}) == "deploy"
    assert match_action("npm publish", {}) == "release"
    # merge is opt-in
    assert match_action("git merge feature-x", {}) is None
    cfg = {"hook": {"gate_merges": True}}
    assert match_action("git merge feature-x", cfg) == "merge"
    # release can be toggled off
    off = {"hook": {"gate_releases": False}}
    assert match_action("npm publish", off) is None
    assert not action_enabled(off, "release")
    assert action_enabled({}, "deploy")  # deploy is always on


# -- check profiles -------------------------------------------------------


def test_default_profiles():
    assert resolve_check_profile({}, "deploy") is None  # all checks
    assert resolve_check_profile({}, "release") is None
    assert resolve_check_profile({}, "merge") == {
        "tests", "build", "preprod", "lockfile", "unfinished",
    }
    cfg = {"actions": {"merge": {"checks": ["tests", "secrets"]}}}
    assert resolve_check_profile(cfg, "merge") == {"tests", "secrets"}


def test_merge_profile_skips_env_checks(tmp_repo, scrubbed_env):
    """A repo with a missing env var but fresh tests passes the MERGE gate:
    env_vars is a deploy-target concern, outside the merge profile."""
    tmp_repo.write("payments.py", FAILING_PAYMENTS)
    stamp(tmp_repo.root, "tests", 0, ["pytest"])
    result = run_gate(
        tmp_repo.root, "merge", None, no_exec=True, env=dict(scrubbed_env), render=False
    )
    assert not result.blocked
    by_name = {r.name: r for r in result.results}
    assert by_name["env_vars"].skipped and by_name["env_vars"].passed
    assert not by_name["tests"].skipped


def test_merge_gate_blocks_on_tests_only(tmp_repo, scrubbed_env):
    tmp_repo.write("payments.py", FAILING_PAYMENTS)  # env failure — irrelevant to merge
    result = run_gate(
        tmp_repo.root, "merge", None, no_exec=True, env=dict(scrubbed_env), render=False
    )
    assert result.blocked
    assert {r.name for r in result.failures} == {"tests"}


def test_profile_skipped_checks_do_not_auto_resolve(tmp_repo, scrubbed_env):
    """A passing MERGE run must not auto-resolve a deploy block whose
    failure (env_vars) the merge profile never evaluated."""
    tmp_repo.write("payments.py", FAILING_PAYMENTS)
    blocked = run_gate(
        tmp_repo.root, "deploy", None, no_exec=True, env=dict(scrubbed_env), render=False
    )
    assert blocked.blocked
    stamp(tmp_repo.root, "tests", 0, ["pytest"])
    merged = run_gate(
        tmp_repo.root, "merge", None, no_exec=True, env=dict(scrubbed_env), render=False
    )
    assert not merged.blocked
    assert merged.record.resolves is None
    prior = MemoryStore(tmp_repo.root / ".proofjury").get(blocked.record.id)
    assert prior.resolution is None  # env_vars was never verified fixed


# -- hook end-to-end -------------------------------------------------------


def test_hook_denies_release_with_release_wording(tmp_repo, scrubbed_env):
    tmp_repo.write("payments.py", FAILING_PAYMENTS)
    payload = {"tool_name": "Bash", "tool_input": {"command": "npm publish"}}
    output = handle_hook(payload, tmp_repo.root, scrubbed_env)
    reason = _reason(output)
    assert "BLOCKED this release command" in reason
    record = MemoryStore(tmp_repo.root / ".proofjury").get("chk_001")
    assert record.action_intercepted == "release"


def test_hook_merge_no_decision_by_default(tmp_repo, scrubbed_env):
    tmp_repo.write("payments.py", FAILING_PAYMENTS)
    payload = {"tool_name": "Bash", "tool_input": {"command": "git merge feature-x"}}
    assert handle_hook(payload, tmp_repo.root, scrubbed_env) == NO_DECISION
    assert not (tmp_repo.root / ".proofjury" / "memory.jsonl").exists()


def test_hook_merge_gated_when_opted_in(tmp_repo, scrubbed_env):
    tmp_repo.write("payments.py", FAILING_PAYMENTS)
    tmp_repo.write(".proofjury.toml", "[hook]\ngate_merges = true\n")
    payload = {"tool_name": "Bash", "tool_input": {"command": "git merge feature-x"}}
    output = handle_hook(payload, tmp_repo.root, scrubbed_env)
    reason = _reason(output)
    assert "BLOCKED this merge command" in reason
    assert "tests_not_run" in reason
    assert "missing_env_var" not in reason  # outside the merge profile

    # Opted-in merge passes once code-readiness is stamped, despite the
    # env failure — no decision, normal permission flow applies.
    stamp(tmp_repo.root, "tests", 0, ["pytest"])
    assert handle_hook(payload, tmp_repo.root, scrubbed_env) == NO_DECISION


def test_release_patterns_extra_extends_defaults(tmp_repo, scrubbed_env):
    tmp_repo.write("payments.py", FAILING_PAYMENTS)
    tmp_repo.write(
        ".proofjury.toml", "[hook]\nrelease_patterns_extra = ['^ship-it$']\n"
    )
    payload = {"tool_name": "Bash", "tool_input": {"command": "ship-it"}}
    output = handle_hook(payload, tmp_repo.root, scrubbed_env)
    assert "BLOCKED this release command" in _reason(output)
    # defaults still apply alongside the extra
    still = {"tool_name": "Bash", "tool_input": {"command": "npm publish"}}
    assert "release" in _reason(handle_hook(still, tmp_repo.root, scrubbed_env))


# -- push gating -------------------------------------------------------------


def _committed_on(tmp_repo, branch: str) -> None:
    tmp_repo.write("app.py", "print('hi')\n")
    tmp_repo.git("add", ".")
    tmp_repo.git("commit", "-q", "-m", "init")
    tmp_repo.git("branch", "-M", branch)


def test_push_patterns_and_precedence():
    assert is_deploy_command("git push", DEFAULT_PUSH_PATTERNS)
    assert is_deploy_command("git push -u origin feature/x", DEFAULT_PUSH_PATTERNS)
    assert not is_deploy_command("echo 'git push'", DEFAULT_PUSH_PATTERNS)
    # strictest story wins: prod-named refs are deploys, tags are releases
    assert match_action("git push origin production", {}) == "deploy"
    assert match_action("git push origin --tags", {}) == "release"
    assert match_action("git push origin main", {}) == "push"
    assert action_enabled({}, "push")  # default-branch mode is on by default
    assert not action_enabled({"hook": {"gate_pushes": False}}, "push")


def test_push_target_branch_parsing(tmp_repo):
    _committed_on(tmp_repo, "feature/x")
    root = tmp_repo.root
    assert push_target_branch("git push origin main", root) == "main"
    assert push_target_branch("git push -u origin HEAD:release/1.2", root) == "release/1.2"
    assert push_target_branch("git push origin refs/heads/main", root) == "main"
    # no refspec (or HEAD) → the current branch
    assert push_target_branch("git push", root) == "feature/x"
    assert push_target_branch("git push origin HEAD", root) == "feature/x"
    # nothing gate-worthy lands on a branch:
    assert push_target_branch("git push origin :dead", root) is None
    assert push_target_branch("git push --delete origin dead", root) is None
    assert push_target_branch("git push --dry-run origin main", root) is None


def test_default_branch_fallback_without_origin(tmp_repo):
    _committed_on(tmp_repo, "main")
    assert default_branch(tmp_repo.root) == "main"
    tmp_repo.git("checkout", "-q", "-b", "feature/y")
    assert default_branch(tmp_repo.root) == "main"  # not the current branch


def test_push_profile_includes_secrets():
    assert resolve_check_profile({}, "push") == {
        "secrets", "tests", "build", "preprod", "lockfile", "unfinished",
    }


def test_hook_gates_push_to_default_branch(tmp_repo, scrubbed_env):
    _committed_on(tmp_repo, "main")
    payload = {"tool_name": "Bash", "tool_input": {"command": "git push origin main"}}
    reason = _reason(handle_hook(payload, tmp_repo.root, scrubbed_env))
    assert "BLOCKED this push command" in reason
    assert "tests_not_run" in reason
    # bare `git push` on main resolves to the same branch and gates too
    bare = {"tool_name": "Bash", "tool_input": {"command": "git push"}}
    assert "BLOCKED this push command" in _reason(handle_hook(bare, tmp_repo.root, scrubbed_env))
    # once code-readiness is stamped, no decision — normal flow applies
    stamp(tmp_repo.root, "tests", 0, ["pytest"])
    assert handle_hook(payload, tmp_repo.root, scrubbed_env) == NO_DECISION


def test_hook_push_feature_branch_default_vs_all(tmp_repo, scrubbed_env):
    _committed_on(tmp_repo, "main")
    tmp_repo.git("checkout", "-q", "-b", "feature/z")
    payload = {"tool_name": "Bash", "tool_input": {"command": "git push -u origin feature/z"}}
    # default-branch mode: feature pushes are not gated
    assert handle_hook(payload, tmp_repo.root, scrubbed_env) == NO_DECISION
    # "all" opts feature branches in (push+PR teams)
    tmp_repo.write(".proofjury.toml", '[hook]\ngate_pushes = "all"\n')
    assert "BLOCKED this push command" in _reason(
        handle_hook(payload, tmp_repo.root, scrubbed_env)
    )


def test_hook_push_gating_disabled(tmp_repo, scrubbed_env):
    _committed_on(tmp_repo, "main")
    tmp_repo.write(".proofjury.toml", "[hook]\ngate_pushes = false\n")
    payload = {"tool_name": "Bash", "tool_input": {"command": "git push origin main"}}
    assert handle_hook(payload, tmp_repo.root, scrubbed_env) == NO_DECISION


def test_guard_push_cli_action_recorded(tmp_repo, monkeypatch):
    monkeypatch.chdir(tmp_repo.root)
    result = runner.invoke(app, ["guard", "push", "--no-exec", "--json"])
    assert result.exit_code == 2  # tests_not_run
    assert json.loads(result.stdout)["action_intercepted"] == "push"


# -- recall is action-agnostic ----------------------------------------------


def test_recall_is_action_agnostic(tmp_repo, scrubbed_env):
    """A deploy-time missing_env_var prior is recalled by a release-time
    failure of the same class — same repo, same failure, same fix."""
    tmp_repo.write("payments.py", FAILING_PAYMENTS)
    first = run_gate(
        tmp_repo.root, "deploy", None, no_exec=True, env=dict(scrubbed_env), render=False
    )
    second = run_gate(
        tmp_repo.root, "release", None, no_exec=True, env=dict(scrubbed_env), render=False
    )
    assert second.record.recalled_from == first.record.id


# -- guard CLI ---------------------------------------------------------------


def test_guard_release_cli_action_recorded(tmp_repo, monkeypatch):
    tmp_repo.write("payments.py", FAILING_PAYMENTS)
    monkeypatch.chdir(tmp_repo.root)
    monkeypatch.delenv("STRIPE_API_KEY", raising=False)
    result = runner.invoke(app, ["guard", "release", "--no-exec", "--json"])
    assert result.exit_code == 2
    record = json.loads(result.stdout)
    assert record["action_intercepted"] == "release"
