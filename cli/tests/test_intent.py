"""Intent alignment (ROADMAP-intent.md): checkpoints, labels, review,
preferences, active mode — and the pinned invariants (gate untouched,
no permission decisions, raw prompts never persisted)."""

import json

from typer.testing import CliRunner

import proofjury.checkpoint as checkpoint_module
from proofjury.checkpoint import (
    CheckpointStore,
    classify_and_label,
    drain_staged_findings,
    get_store,
    mark_findings_sent,
    maybe_graduate,
    record_checkpoint,
    run_intent_review,
)
from proofjury.cli import _merge_claude_hook, app
from proofjury.gate import run_gate
from proofjury.hooks import (
    handle_prompt_hook,
    handle_session_start_hook,
    handle_stop_hook,
)
from proofjury.judge.advisory import AdvisoryInput
from proofjury.memory import prefs as prefs_module

runner = CliRunner()

FAILING_PAYMENTS = 'import os\nKEY = os.environ["STRIPE_API_KEY"]\n'


def _committed(tmp_repo) -> None:
    tmp_repo.write("app.py", "print('hi')\n")
    tmp_repo.git("add", ".")
    tmp_repo.git("commit", "-q", "-m", "init")


def _fake_chat(reply: dict):
    def chat(system, user):
        return json.dumps(reply), "test/fake-model", 0.0
    return chat


# -- I1: sensor --------------------------------------------------------------


def test_checkpoint_records_new_work_and_skips_unchanged(tmp_repo, scrubbed_env):
    _committed(tmp_repo)
    tmp_repo.write("feature.py", "def f():\n    return 1\n")
    record = record_checkpoint(tmp_repo.root, scrubbed_env, event="stop", task="add f")
    assert record is not None
    assert record["id"] == "ckpt_001"
    assert record["task"] == "add f"
    assert "feature.py" in record["changed_files"]
    assert record["diff_lines"] >= 1
    assert record["outcome"] is None
    # nothing changed → no second checkpoint
    assert record_checkpoint(tmp_repo.root, scrubbed_env, event="stop") is None
    # new work → next checkpoint
    tmp_repo.write("feature.py", "def f():\n    return 2\n")
    second = record_checkpoint(tmp_repo.root, scrubbed_env, event="stop")
    assert second is not None and second["id"] == "ckpt_002"


def test_checkpoint_guards_min_diff_and_rate_cap(tmp_repo, scrubbed_env):
    _committed(tmp_repo)
    tmp_repo.write(".proofjury.toml", "[checkpoint]\nmin_diff_lines = 1000\n")
    tmp_repo.write("feature.py", "x = 1\n")
    assert record_checkpoint(tmp_repo.root, scrubbed_env) is None  # tiny diff
    tmp_repo.write(".proofjury.toml", "[checkpoint]\nmax_per_hour = 1\n")
    assert record_checkpoint(tmp_repo.root, scrubbed_env) is not None
    tmp_repo.write("feature.py", "x = 2\n")
    assert record_checkpoint(tmp_repo.root, scrubbed_env) is None  # rate-capped


def test_checkpoint_kill_switches(tmp_repo, scrubbed_env):
    _committed(tmp_repo)
    tmp_repo.write("feature.py", "x = 1\n")
    off_env = dict(scrubbed_env, PROOFJURY_NO_CHECKPOINT="1")
    assert record_checkpoint(tmp_repo.root, off_env) is None
    tmp_repo.write(".proofjury.toml", "[checkpoint]\nenabled = false\n")
    assert record_checkpoint(tmp_repo.root, scrubbed_env) is None


def test_checkpoint_captures_committed_work(tmp_repo, scrubbed_env):
    """A clean worktree after a commit still checkpoints — the diff comes
    from the last checkpoint's head."""
    _committed(tmp_repo)
    tmp_repo.write("feature.py", "x = 1\n")
    first = record_checkpoint(tmp_repo.root, scrubbed_env)
    assert first is not None
    tmp_repo.git("add", ".")
    tmp_repo.git("commit", "-q", "-m", "feature")
    tmp_repo.write("feature.py", "x = 1\ny = 2\n")
    tmp_repo.git("add", ".")
    tmp_repo.git("commit", "-q", "-m", "more")
    record = record_checkpoint(tmp_repo.root, scrubbed_env, event="commit")
    assert record is not None
    assert record["diff_lines"] >= 1


def test_checkpoint_cli_command(tmp_repo, monkeypatch):
    _committed(tmp_repo)
    tmp_repo.write("feature.py", "x = 1\n")
    monkeypatch.chdir(tmp_repo.root)
    result = runner.invoke(app, ["checkpoint", "--task", "add feature"])
    assert result.exit_code == 0
    assert "ckpt_001" in result.stdout
    result = runner.invoke(app, ["checkpoint"])
    assert "no checkpoint" in result.stdout


def test_stop_hook_records_and_stays_silent(tmp_repo, scrubbed_env):
    _committed(tmp_repo)
    tmp_repo.write("feature.py", "x = 1\n")
    env = dict(scrubbed_env, PROOFJURY_INTENT_SYNC="1")
    output = handle_stop_hook({"session_id": "s1"}, tmp_repo.root, env)
    assert output == {}  # never a permission decision, never a block in advise mode
    records = list(get_store(tmp_repo.root).iter_records())
    assert len(records) == 1 and records[0]["session_id"] == "s1"


# -- I2: labels --------------------------------------------------------------


def test_classification_corrected_labels_and_never_persists_prompt(
    tmp_repo, scrubbed_env
):
    _committed(tmp_repo)
    tmp_repo.write("big.py", "x = 1\n")
    record_checkpoint(tmp_repo.root, scrubbed_env, event="stop", session_id="s1")
    marker = "XYZZY-raw-prompt-marker-XYZZY"
    prompt = f"no, split big.py into smaller modules {marker}"
    outcome = classify_and_label(
        tmp_repo.root,
        scrubbed_env,
        prompt,
        "s1",
        chat=_fake_chat(
            {
                "kind": "corrected",
                "statement": "wants large files split into small modules",
                "category": "decomposition",
                "confidence": 0.9,
            }
        ),
    )
    assert outcome is not None and outcome["label"] == "corrected"
    stored = get_store(tmp_repo.root).get("ckpt_001")
    assert stored["outcome"]["category"] == "decomposition"
    assert stored["outcome"]["statement"] == "wants large files split into small modules"
    # PINNED privacy invariant: the raw prompt is never written to disk.
    for path in (tmp_repo.root / ".proofjury").rglob("*"):
        if path.is_file():
            assert marker not in path.read_text(errors="replace"), path


def test_classification_new_task_is_accepted_implicit(tmp_repo, scrubbed_env):
    _committed(tmp_repo)
    tmp_repo.write("a.py", "x = 1\n")
    record_checkpoint(tmp_repo.root, scrubbed_env, session_id="s1")
    outcome = classify_and_label(
        tmp_repo.root,
        scrubbed_env,
        "now add a login page",
        "s1",
        chat=_fake_chat({"kind": "new_task", "statement": "", "category": "", "confidence": 0.8}),
    )
    assert outcome["label"] == "accepted_implicit"
    assert outcome["category"] == ""


def test_classification_conservative_defaults(tmp_repo, scrubbed_env):
    _committed(tmp_repo)
    tmp_repo.write("a.py", "x = 1\n")
    record_checkpoint(tmp_repo.root, scrubbed_env, session_id="s1")
    # low confidence → unlabeled
    assert (
        classify_and_label(
            tmp_repo.root, scrubbed_env, "hmm", "s1",
            chat=_fake_chat({"kind": "corrected", "statement": "s", "category": "size", "confidence": 0.3}),
        )
        is None
    )
    # no LLM → unlabeled (chat=None resolves to nothing in scrubbed env)
    assert classify_and_label(tmp_repo.root, scrubbed_env, "hmm again", "s1") is None
    assert get_store(tmp_repo.root).get("ckpt_001")["outcome"] is None


# -- I3: review + staged delivery -------------------------------------------


def test_review_stages_confident_findings_and_drains_once(tmp_repo, scrubbed_env):
    _committed(tmp_repo)
    tmp_repo.write("a.py", "x = 1\n")
    record = record_checkpoint(tmp_repo.root, scrubbed_env, task="add login")
    entries = run_intent_review(
        tmp_repo.root,
        scrubbed_env,
        record["id"],
        chat=_fake_chat(
            {
                "findings": [
                    {"concern": "No login was added; the diff only touches a.py.",
                     "tier": 5, "confidence": 0.9, "target": "a.py:1"},
                    {"concern": "Might be nice to add tests.",
                     "tier": 4, "confidence": 0.5, "target": None},
                ]
            }
        ),
    )
    assert [e["delivery"] for e in entries] == ["staged", "recorded"]
    stored = get_store(tmp_repo.root).get(record["id"])
    assert stored["checkpoint_input"] and stored["checkpoint_output"]
    text, pending = drain_staged_findings(tmp_repo.root)
    assert "No login was added" in text and len(pending) == 1
    mark_findings_sent(tmp_repo.root, pending)
    assert drain_staged_findings(tmp_repo.root) == ("", [])


def test_review_suppresses_rejected_signatures(tmp_repo, scrubbed_env, monkeypatch):
    _committed(tmp_repo)
    tmp_repo.write("a.py", "x = 1\n")
    record = record_checkpoint(tmp_repo.root, scrubbed_env)
    from proofjury.memory.recall import advisory_signature

    concern = "Silent failure mode in a.py error handling."
    monkeypatch.setattr(
        checkpoint_module,
        "rejected_advisory_signatures",
        lambda store, repo_id: {advisory_signature(concern, "a.py:1"): concern},
    )
    entries = run_intent_review(
        tmp_repo.root,
        scrubbed_env,
        record["id"],
        chat=_fake_chat(
            {"findings": [{"concern": concern, "tier": 4, "confidence": 0.95, "target": "a.py:1"}]}
        ),
    )
    assert entries == []


def test_prompt_hook_delivers_staged_context_and_no_decision(tmp_repo, scrubbed_env):
    _committed(tmp_repo)
    tmp_repo.write("a.py", "x = 1\n")
    record = record_checkpoint(tmp_repo.root, scrubbed_env, task="t")
    run_intent_review(
        tmp_repo.root, scrubbed_env, record["id"],
        chat=_fake_chat({"findings": [{"concern": "Mismatch with task.", "tier": 5, "confidence": 0.9, "target": None}]}),
    )
    env = dict(scrubbed_env, PROOFJURY_INTENT_SYNC="1")
    output = handle_prompt_hook({"prompt": "continue", "session_id": "s1"}, tmp_repo.root, env)
    inner = output["hookSpecificOutput"]
    assert inner["hookEventName"] == "UserPromptSubmit"
    assert "Mismatch with task" in inner["additionalContext"]
    assert "permissionDecision" not in json.dumps(output)
    # drained → second prompt has nothing to deliver
    assert handle_prompt_hook({"prompt": "ok"}, tmp_repo.root, env) == {}


# -- I4: preferences ---------------------------------------------------------


def _label_corrections(tmp_repo, scrubbed_env, n, category="decomposition"):
    for i in range(n):
        tmp_repo.write("big.py", f"x = {i}\n")
        record = record_checkpoint(tmp_repo.root, scrubbed_env, session_id="s1")
        assert record is not None
        get_store(tmp_repo.root).update(
            record["id"],
            {"outcome": {"label": "corrected", "statement": f"split files please ({i})",
                         "category": category, "confidence": 0.9,
                         "classified_by": "test", "at": record["created_at"]}},
        )


def test_graduation_after_three_corrections_and_rejection_suppression(
    tmp_repo, scrubbed_env
):
    _committed(tmp_repo)
    _label_corrections(tmp_repo, scrubbed_env, 3)
    pref = maybe_graduate(tmp_repo.root, scrubbed_env, "decomposition")
    assert pref is not None and pref["status"] == "candidate"
    assert len(pref["evidence"]) == 3
    # an existing pref for the category (any status) suppresses re-graduation
    assert maybe_graduate(tmp_repo.root, scrubbed_env, "decomposition") is None
    store = prefs_module.repo_store(tmp_repo.root)
    store.set_status(pref["id"], "rejected", now="2026-01-01T00:00:00Z")
    assert maybe_graduate(tmp_repo.root, scrubbed_env, "decomposition") is None
    # "other" never graduates
    assert maybe_graduate(tmp_repo.root, scrubbed_env, "other") is None


def test_classification_triggers_graduation(tmp_repo, scrubbed_env):
    _committed(tmp_repo)
    _label_corrections(tmp_repo, scrubbed_env, 2, category="size")
    tmp_repo.write("big.py", "x = 99\n")
    record_checkpoint(tmp_repo.root, scrubbed_env, session_id="s1")
    classify_and_label(
        tmp_repo.root, scrubbed_env, "smaller files please", "s1",
        chat=_fake_chat({"kind": "corrected", "statement": "prefers small files",
                         "category": "size", "confidence": 0.9}),
    )
    prefs = prefs_module.repo_store(tmp_repo.root).list()
    assert len(prefs) == 1 and prefs[0]["category"] == "size"
    assert prefs[0]["status"] == "candidate"  # activation stays human-only


def test_session_start_injects_only_active_prefs(tmp_repo, scrubbed_env):
    store = prefs_module.repo_store(tmp_repo.root)
    store.add("prefers small modules", "size", status="candidate", now="t")
    assert handle_session_start_hook({}, tmp_repo.root, scrubbed_env) == {}
    active = store.add("uses Tailwind, not CSS modules", "framework_choice",
                       status="active", now="t")
    output = handle_session_start_hook({}, tmp_repo.root, scrubbed_env)
    context = output["hookSpecificOutput"]["additionalContext"]
    assert "Tailwind" in context and "small modules" not in context
    # kill switch
    off = dict(scrubbed_env, PROOFJURY_NO_PREFS="1")
    assert handle_session_start_hook({}, tmp_repo.root, off) == {}
    store.set_status(active["id"], "rejected", now="t")
    assert handle_session_start_hook({}, tmp_repo.root, scrubbed_env) == {}


def test_prefs_cli_add_list_approve(tmp_repo, monkeypatch):
    monkeypatch.chdir(tmp_repo.root)
    result = runner.invoke(app, ["prefs", "add", "prefers small files", "--category", "size"])
    assert result.exit_code == 0 and "active" in result.stdout
    result = runner.invoke(app, ["prefs", "list"])
    assert "prefers small files" in result.stdout
    prefs = prefs_module.repo_store(tmp_repo.root).list()
    assert prefs[0]["status"] == "active"  # explicit add IS the approval


def test_advisory_prompt_gains_preferences_section():
    base = AdvisoryInput(action="deploy", repo_id="r", task_ref=None, git_summary="g")
    assert "Active user preferences" not in base.to_prompt_text()
    with_prefs = AdvisoryInput(
        action="deploy", repo_id="r", task_ref=None, git_summary="g",
        preferences=["prefers small modules"],
    )
    text = with_prefs.to_prompt_text()
    assert "Active user preferences" in text and "prefers small modules" in text


def test_user_scope_prefs_cross_repo(tmp_repo, scrubbed_env):
    user = prefs_module.user_store(scrubbed_env)
    user.add("prefers explicit type hints", "other", status="active", now="t")
    statements = [p["statement"] for p in prefs_module.active_prefs(tmp_repo.root, scrubbed_env)]
    assert "prefers explicit type hints" in statements


# -- I5: active mode ---------------------------------------------------------


def _wire_active_chat(monkeypatch, findings):
    monkeypatch.setattr(
        checkpoint_module,
        "get_intent_chat",
        lambda *a, **k: _fake_chat({"findings": findings}),
    )


def test_active_mode_blocks_stop_once_on_confident_tier5(
    tmp_repo, scrubbed_env, monkeypatch
):
    _committed(tmp_repo)
    tmp_repo.write(".proofjury.toml", '[checkpoint]\nmode = "active"\n')
    tmp_repo.write("a.py", "x = 1\n")
    _wire_active_chat(
        monkeypatch,
        [{"concern": "The task asked for login; nothing was added.",
          "tier": 5, "confidence": 0.95, "target": "a.py:1"}],
    )
    output = handle_stop_hook({"session_id": "s1"}, tmp_repo.root, scrubbed_env)
    assert output["decision"] == "block"
    assert "login" in output["reason"]
    # once per turn: stop_hook_active → never a second continuation
    tmp_repo.write("a.py", "x = 2\n")
    again = handle_stop_hook(
        {"session_id": "s1", "stop_hook_active": True}, tmp_repo.root, scrubbed_env
    )
    assert again == {}


def test_active_mode_stays_silent_below_threshold(tmp_repo, scrubbed_env, monkeypatch):
    _committed(tmp_repo)
    tmp_repo.write(".proofjury.toml", '[checkpoint]\nmode = "active"\n')
    tmp_repo.write("a.py", "x = 1\n")
    _wire_active_chat(
        monkeypatch,
        [{"concern": "Style nit.", "tier": 4, "confidence": 0.99, "target": None},
         {"concern": "Maybe off-task.", "tier": 5, "confidence": 0.7, "target": None}],
    )
    assert handle_stop_hook({}, tmp_repo.root, scrubbed_env) == {}


# -- pinned invariants -------------------------------------------------------


def test_gate_exit_identical_with_checkpoints_on_off_broken(tmp_repo, scrubbed_env):
    """PINNED: the checkpoint pillar can be on, off, or corrupted — the
    gate's verdict and exit code never move."""
    tmp_repo.write("payments.py", FAILING_PAYMENTS)
    baseline = run_gate(
        tmp_repo.root, "deploy", None, no_exec=True, env=dict(scrubbed_env), render=False
    )
    # corrupt every intent artifact
    (tmp_repo.root / ".proofjury" / "checkpoints.jsonl").write_text("{{{{not json")
    (tmp_repo.root / ".proofjury" / "preferences.jsonl").write_text("{{{{not json")
    broken = run_gate(
        tmp_repo.root, "deploy", None, no_exec=True, env=dict(scrubbed_env), render=False
    )
    off_env = dict(scrubbed_env, PROOFJURY_NO_CHECKPOINT="1", PROOFJURY_NO_PREFS="1")
    off = run_gate(
        tmp_repo.root, "deploy", None, no_exec=True, env=off_env, render=False
    )
    assert baseline.exit_code == broken.exit_code == off.exit_code == 2
    assert baseline.blocked and broken.blocked and off.blocked


def test_intent_hooks_never_crash_or_decide(tmp_repo, scrubbed_env):
    """All three handlers fail OPEN on garbage and never emit permission
    decisions (active mode's continue-turn is the sole, opt-in exception)."""
    env = dict(scrubbed_env, PROOFJURY_INTENT_SYNC="1")
    for handler in (handle_stop_hook, handle_prompt_hook, handle_session_start_hook):
        for payload in ({}, {"prompt": 42}, {"session_id": ["x"]}, {"prompt": ""}):
            output = handler(payload, tmp_repo.root, env)
            assert "permissionDecision" not in json.dumps(output)
            assert output.get("decision") is None


def test_hook_cli_intent_events_fail_open(tmp_repo, monkeypatch):
    monkeypatch.chdir(tmp_repo.root)
    for event in ("stop", "prompt", "session-start"):
        result = runner.invoke(app, ["hook", "--event", event], input="not json{{{")
        assert result.exit_code == 0, (event, result.output)
        assert json.loads(result.stdout.strip().splitlines()[-1]) == {}


def test_init_wires_all_four_claude_events(tmp_repo):
    message = _merge_claude_hook(tmp_repo.root)
    assert "Stop" in message and "SessionStart" in message
    settings = json.loads((tmp_repo.root / ".claude" / "settings.json").read_text())
    events = settings["hooks"]
    assert set(events) >= {"PreToolUse", "Stop", "UserPromptSubmit", "SessionStart"}
    assert events["Stop"][0]["hooks"][0]["command"] == "proofjury hook --event stop"
    assert "matcher" not in events["Stop"][0]
    # idempotent
    assert "already wired" in _merge_claude_hook(tmp_repo.root)
    # upgrade path: a pre-intent settings.json (PreToolUse only) gains the rest
    (tmp_repo.root / ".claude" / "settings.json").write_text(
        json.dumps({"hooks": {"PreToolUse": [
            {"matcher": "Bash", "hooks": [{"type": "command", "command": "proofjury hook"}]}
        ]}})
    )
    message = _merge_claude_hook(tmp_repo.root)
    assert "Stop" in message and "PreToolUse" not in message


def test_memory_stats_intent_section(tmp_repo, scrubbed_env, monkeypatch):
    _committed(tmp_repo)
    tmp_repo.write("a.py", "x = 1\n")
    record = record_checkpoint(tmp_repo.root, scrubbed_env)
    get_store(tmp_repo.root).update(
        record["id"],
        {"outcome": {"label": "corrected", "statement": "s", "category": "size",
                     "confidence": 0.9, "classified_by": "t", "at": "t"}},
    )
    from proofjury.memory.export import stats
    from proofjury.memory.store import MemoryStore

    data = stats(
        MemoryStore(tmp_repo.root / ".proofjury"),
        tmp_repo.root / ".proofjury" / "ledger.jsonl",
        env=scrubbed_env,
    )
    assert data["intent"]["checkpoints"] == 1
    assert data["intent"]["outcomes"] == {"corrected": 1}
    assert data["intent"]["correction_rate"] == 1.0
