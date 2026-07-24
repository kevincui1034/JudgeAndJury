"""Intent-pillar sync: checkpoints, prefs, ledger, reported config.

The gate-record drain was already firewalled and content-hashed; this
pins that the intent drain behaves the same way — bounded, idempotent,
and structurally unable to change the gate's exit code.
"""

import json

import pytest

from proofjury import sync as sync_module
from proofjury.sync import INTENT_DRAIN_LIMIT, drain_intent, load_state


class FakeClient:
    """Records what would have been pushed."""

    def __init__(self, fail: bool = False):
        self.calls: list[dict] = []
        self.fail = fail

    def push_intent(self, repo_id: str, payload: dict) -> dict:
        if self.fail:
            raise RuntimeError("intent endpoint down")
        self.calls.append({"repo_id": repo_id, **payload})
        return {"status": "ok"}


def _ckpt(ckpt_id="ckpt_001", **over):
    base = {
        "id": ckpt_id,
        "created_at": "2026-07-24T12:00:00Z",
        "repo_id": "demo",
        "session_id": "s1",
        "event": "stop",
        "task": "add refunds",
        "changed_files": ["payments.py"],
        "diff_lines": 12,
        "diff_excerpt": "+ def refund(): ...",
        "outcome": {
            "label": "corrected",
            "statement": "wants smaller files",
            "category": "size",
            "confidence": 0.9,
        },
        "findings": [],
        "checkpoint_input": "REVIEW PROMPT",
        "checkpoint_output": "{}",
        "schema_version": "1",
        "cli_version": "0.1.0",
    }
    base.update(over)
    return base


def _write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows),
        encoding="utf-8",
    )


@pytest.fixture
def repo(tmp_path):
    (tmp_path / ".proofjury").mkdir(parents=True, exist_ok=True)
    return tmp_path


# --------------------------------------------------------------------------
# what gets pushed
# --------------------------------------------------------------------------


def test_pushes_checkpoints_prefs_ledger_and_config(repo, scrubbed_env):
    pj = repo / ".proofjury"
    _write_jsonl(pj / "checkpoints.jsonl", [_ckpt("ckpt_001"), _ckpt("ckpt_002")])
    _write_jsonl(
        pj / "preferences.jsonl",
        [
            {
                "id": "pref_001",
                "statement": "prefers small modules",
                "category": "size",
                "scope": "repo",
                "status": "candidate",
                "evidence": ["ckpt_001"],
                "created_at": "2026-07-24T12:00:00Z",
                "updated_at": "2026-07-24T12:00:00Z",
            }
        ],
    )
    _write_jsonl(
        pj / "ledger.jsonl",
        [{"ts": "2026-07-24T12:00:00Z", "model": "pioneer/gpt-4.1", "cost_usd": 0.001}],
    )
    (repo / ".proofjury.toml").write_text("[advisory]\nenabled = true\n", encoding="utf-8")

    client = FakeClient()
    sent = drain_intent(repo, client, "demo", scrubbed_env)

    assert sent == 2
    payload = client.calls[0]
    assert payload["repo_id"] == "demo"
    assert [c["id"] for c in payload["checkpoints"]] == ["ckpt_001", "ckpt_002"]
    assert payload["prefs"][0]["id"] == "pref_001"
    assert payload["prefs"][0]["scope"] == "repo"
    assert payload["ledger"][0]["seq"] == 0
    assert payload["config"]["effective"] == {"advisory": {"enabled": True}}
    assert payload["capabilities"]["checkpoints"] is True


def test_second_drain_sends_nothing_when_unchanged(repo, scrubbed_env):
    _write_jsonl(repo / ".proofjury" / "checkpoints.jsonl", [_ckpt()])
    client = FakeClient()
    assert drain_intent(repo, client, "demo", scrubbed_env) == 1
    assert drain_intent(repo, client, "demo", scrubbed_env) == 0
    assert len(client.calls) == 1


def test_changed_checkpoint_is_repushed(repo, scrubbed_env):
    path = repo / ".proofjury" / "checkpoints.jsonl"
    _write_jsonl(path, [_ckpt()])
    client = FakeClient()
    drain_intent(repo, client, "demo", scrubbed_env)

    # A label lands locally → the content hash moves → it re-pushes.
    _write_jsonl(path, [_ckpt(outcome={"label": "accepted_implicit"})])
    assert drain_intent(repo, client, "demo", scrubbed_env) == 1
    assert client.calls[-1]["checkpoints"][0]["outcome"]["label"] == "accepted_implicit"


def test_limit_bounds_post_gate_work(repo, scrubbed_env):
    _write_jsonl(
        repo / ".proofjury" / "checkpoints.jsonl",
        [_ckpt(f"ckpt_{i:03d}") for i in range(25)],
    )
    client = FakeClient()
    assert drain_intent(repo, client, "demo", scrubbed_env) == INTENT_DRAIN_LIMIT
    # The rest follow on later drains rather than in one giant request.
    assert drain_intent(repo, client, "demo", scrubbed_env) == INTENT_DRAIN_LIMIT


def test_ledger_only_sends_the_tail(repo, scrubbed_env):
    path = repo / ".proofjury" / "ledger.jsonl"
    rows = [{"ts": "2026-07-24T12:00:00Z", "model": "m", "cost_usd": 0.1}]
    _write_jsonl(path, rows)
    client = FakeClient()
    drain_intent(repo, client, "demo", scrubbed_env)

    _write_jsonl(path, rows + [{"ts": "2026-07-24T12:05:00Z", "model": "m2", "cost_usd": 0.2}])
    drain_intent(repo, client, "demo", scrubbed_env)
    assert [e["seq"] for e in client.calls[-1]["ledger"]] == [1]


def test_config_only_resent_when_the_file_changes(repo, scrubbed_env):
    toml = repo / ".proofjury.toml"
    toml.write_text("[advisory]\nenabled = true\n", encoding="utf-8")
    client = FakeClient()
    drain_intent(repo, client, "demo", scrubbed_env)
    assert "config" in client.calls[0]

    toml.write_text("[advisory]\nenabled = false\n", encoding="utf-8")
    drain_intent(repo, client, "demo", scrubbed_env)
    assert client.calls[-1]["config"]["effective"]["advisory"]["enabled"] is False


# --------------------------------------------------------------------------
# privacy + firewall
# --------------------------------------------------------------------------


def test_checkpoint_diff_optout_strips_diff_text(repo, scrubbed_env):
    _write_jsonl(repo / ".proofjury" / "checkpoints.jsonl", [_ckpt()])
    client = FakeClient()
    drain_intent(repo, client, "demo", scrubbed_env, include_diff=False)
    sent = client.calls[0]["checkpoints"][0]
    assert "diff_excerpt" not in sent
    assert "checkpoint_input" not in sent
    assert sent["task"] == "add refunds"  # the record itself still syncs


def test_capabilities_never_carry_secrets(repo, scrubbed_env):
    client = FakeClient()
    _write_jsonl(repo / ".proofjury" / "checkpoints.jsonl", [_ckpt()])
    drain_intent(
        repo, client, "demo", {**scrubbed_env, "PIONEER_API_KEY": "pk-super-secret"}
    )
    blob = json.dumps(client.calls[0])
    assert "pk-super-secret" not in blob


def test_failed_push_leaves_everything_pending(repo, scrubbed_env):
    _write_jsonl(repo / ".proofjury" / "checkpoints.jsonl", [_ckpt()])
    with pytest.raises(RuntimeError):
        drain_intent(repo, FakeClient(fail=True), "demo", scrubbed_env)
    # State was not advanced, so the next drain retries.
    assert load_state(repo / ".proofjury")["checkpoints"] == {}
    assert drain_intent(repo, FakeClient(), "demo", scrubbed_env) == 1


def test_no_data_means_no_request(repo, scrubbed_env):
    client = FakeClient()
    assert drain_intent(repo, client, "demo", scrubbed_env) == 0
    assert client.calls == []


def test_old_sync_json_without_intent_keys_still_loads(repo):
    pj = repo / ".proofjury"
    (pj / "sync.json").write_text(
        json.dumps({"version": 1, "records": {"chk_001": "abc"}, "label_cursor": 4}),
        encoding="utf-8",
    )
    state = load_state(pj)
    assert state["records"] == {"chk_001": "abc"}
    assert state["label_cursor"] == 4
    assert state["checkpoints"] == {}
    assert state["ledger_line"] == 0


def test_sync_after_gate_swallows_intent_failure(repo, scrubbed_env, monkeypatch):
    """The gate's exit code can never depend on the intent drain."""
    _write_jsonl(repo / ".proofjury" / "checkpoints.jsonl", [_ckpt()])

    def explode(*args, **kwargs):
        raise RuntimeError("intent drain crashed")

    monkeypatch.setattr(sync_module, "drain_intent", explode)
    monkeypatch.setattr(
        sync_module,
        "resolve_sync",
        lambda env: {
            "token": "pjt_x",
            "token_id": "t",
            "endpoint": "http://127.0.0.1:9/api/v1",
            "intent": True,
            "checkpoint_diff": True,
        },
    )
    # Must return normally despite the crash.
    sync_module.sync_after_gate(repo, scrubbed_env)
