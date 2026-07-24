"""Team conventions as advisory context via Senso (PLAN-swarmhack H5).

Conventions are human-AUTHORED policy (runbooks, deploy rules), distinct
from the LEARNED preferences of ROADMAP-intent.md I4. They are context
for the advisory judge and nothing more — the invariants pinned here are
that they default OFF, that every failure mode is firewalled to "no
section", and that with no conventions the prompt is byte-identical to a
run without Senso.
"""

import httpx
import pytest

from proofjury import config
from proofjury.judge.advisory import AdvisoryInput
from proofjury.judge.conventions import (
    SENSO_URL,
    fetch_conventions,
    parse_conventions,
)

ON = {"conventions": {"enabled": True}}
ENV = {"SENSO_API_KEY": "senso-key"}

PAYLOAD = {
    "results": [
        {
            "text": "Payments code requires a second QA pass before deploy.",
            "title": "deploy-runbook.md",
        },
        {"text": "No direct-to-main deploys after 5pm.", "title": "release-policy.md"},
    ]
}


def _fetcher(payload, spy=None):
    def _fetch(url, headers, body):
        if spy is not None:
            spy.update(url=url, headers=headers, body=body)
        return payload

    return _fetch


# --------------------------------------------------------------------------
# defaults + firewall
# --------------------------------------------------------------------------


def test_disabled_by_default():
    assert config.CONVENTIONS_DEFAULTS["enabled"] is False
    assert config.conventions_settings(None)["enabled"] is False
    # Even with a key present, an opt-out repo sends nothing.
    called = []
    result = fetch_conventions(
        ["payments.py"], "add refunds", ENV, {}, fetcher=lambda *a: called.append(a)
    )
    assert result == []
    assert called == []


def test_env_kill_switch_beats_config():
    assert config.conventions_enabled(ON, {"PROOFJURY_NO_CONVENTIONS": "1"}) is False
    assert config.conventions_enabled(ON, {}) is True


def test_no_api_key_means_no_conventions():
    called = []
    result = fetch_conventions(
        ["payments.py"], "t", {}, ON, fetcher=lambda *a: called.append(a)
    )
    assert result == []
    assert called == []


@pytest.mark.parametrize(
    "boom",
    [
        httpx.ConnectError("down"),
        httpx.ReadTimeout("slow"),
        ValueError("garbage json"),
        RuntimeError("boom"),
    ],
)
def test_any_error_is_firewalled(boom):
    def explode(url, headers, body):
        raise boom

    assert fetch_conventions(["a.py"], "t", ENV, ON, fetcher=explode) == []


@pytest.mark.parametrize(
    "payload", [None, {}, {"results": "nope"}, {"results": [1, 2]}, [], 42]
)
def test_malformed_payloads_yield_nothing(payload):
    assert fetch_conventions(["a.py"], "t", ENV, ON, fetcher=_fetcher(payload)) == []


# --------------------------------------------------------------------------
# request + parsing
# --------------------------------------------------------------------------


def test_statements_carry_source_citations():
    result = fetch_conventions(
        ["payments.py"], "add refunds", ENV, ON, fetcher=_fetcher(PAYLOAD)
    )
    assert result == [
        "Payments code requires a second QA pass before deploy. "
        "[source: deploy-runbook.md]",
        "No direct-to-main deploys after 5pm. [source: release-policy.md]",
    ]


def test_request_shape_and_auth():
    spy = {}
    fetch_conventions(
        ["payments.py", "db.py"],
        "add refunds",
        {**ENV, "SENSO_KB_ID": "kb-42"},
        ON,
        fetcher=_fetcher(PAYLOAD, spy),
    )
    assert spy["url"] == SENSO_URL
    assert spy["headers"]["X-API-Key"] == "senso-key"
    assert spy["body"]["knowledge_base_id"] == "kb-42"
    assert "add refunds" in spy["body"]["query"]
    assert "payments.py" in spy["body"]["query"]


def test_config_kb_beats_env_kb():
    spy = {}
    fetch_conventions(
        ["a.py"],
        "t",
        {**ENV, "SENSO_KB_ID": "kb-env"},
        {"conventions": {"enabled": True, "senso_kb": "kb-config"}},
        fetcher=_fetcher(PAYLOAD, spy),
    )
    assert spy["body"]["knowledge_base_id"] == "kb-config"


def test_endpoint_is_env_overridable():
    spy = {}
    fetch_conventions(
        ["a.py"],
        "t",
        {**ENV, "SENSO_API_URL": "http://127.0.0.1:9944/search"},
        ON,
        fetcher=_fetcher(PAYLOAD, spy),
    )
    assert spy["url"] == "http://127.0.0.1:9944/search"


def test_max_results_caps_and_is_configurable():
    payload = {"results": [{"text": f"rule {i}", "title": "d.md"} for i in range(20)]}
    assert len(fetch_conventions(["a.py"], "t", ENV, ON, fetcher=_fetcher(payload))) == 5
    capped = fetch_conventions(
        ["a.py"],
        "t",
        ENV,
        {"conventions": {"enabled": True, "max_results": 2}},
        fetcher=_fetcher(payload),
    )
    assert len(capped) == 2


def test_parser_tolerates_alternate_shapes():
    """The live response shape is account-provisioned; a key-name
    difference must degrade gracefully, not crash the advisory surface."""
    assert parse_conventions(
        {"matches": [{"content": "rule one", "document": "runbook.md"}]}, 5
    ) == ["rule one [source: runbook.md]"]
    assert parse_conventions([{"snippet": "rule two", "name": "policy.md"}], 5) == [
        "rule two [source: policy.md]"
    ]
    # A result with no usable text is dropped, not rendered empty.
    assert parse_conventions({"results": [{"title": "only-a-title.md"}]}, 5) == []
    # No source → the statement still lands, just uncited.
    assert parse_conventions({"results": [{"text": "bare rule"}]}, 5) == ["bare rule"]


def test_duplicate_statements_collapse():
    payload = {"results": [{"text": "same", "title": "d.md"}] * 3}
    assert fetch_conventions(["a.py"], "t", ENV, ON, fetcher=_fetcher(payload)) == [
        "same [source: d.md]"
    ]


# --------------------------------------------------------------------------
# prompt integration — the section appears ONLY when non-empty
# --------------------------------------------------------------------------


def _base_input(**kw) -> AdvisoryInput:
    return AdvisoryInput(
        action="deploy", repo_id="r", task_ref=None, git_summary="g", **kw
    )


def test_advisory_prompt_is_byte_identical_without_conventions():
    assert _base_input().to_prompt_text() == _base_input(conventions=[]).to_prompt_text()
    assert "Team conventions" not in _base_input().to_prompt_text()


def test_advisory_prompt_gains_conventions_section():
    text = _base_input(
        conventions=["Payments needs a second QA pass. [source: deploy-runbook.md]"]
    ).to_prompt_text()
    assert "Team conventions authored by this org" in text
    assert "[source: deploy-runbook.md]" in text


def test_conventions_and_preferences_are_separate_sections():
    """Authored policy and learned preference must not be conflated —
    they have different owners and different authority."""
    text = _base_input(
        preferences=["prefers small modules"],
        conventions=["No deploys after 5pm. [source: release-policy.md]"],
    ).to_prompt_text()
    assert "Active user preferences" in text
    assert "Team conventions authored by this org" in text
    assert text.index("Active user preferences") < text.index("Team conventions")


# --------------------------------------------------------------------------
# gate + checkpoint wiring
# --------------------------------------------------------------------------


def test_gate_helper_is_firewalled_and_off_by_default(tmp_repo, scrubbed_env):
    from proofjury.gate import _team_conventions

    assert _team_conventions(tmp_repo.root, scrubbed_env, "task", ["a.py"]) == []


def test_gate_helper_returns_cited_statements(tmp_repo, scrubbed_env, monkeypatch):
    from proofjury import gate as gate_module

    tmp_repo.write(".proofjury.toml", "[conventions]\nenabled = true\n")
    monkeypatch.setattr(
        "proofjury.judge.conventions.fetch_conventions",
        lambda *a, **k: ["No deploys after 5pm. [source: release-policy.md]"],
    )
    result = gate_module._team_conventions(
        tmp_repo.root, {**scrubbed_env, "SENSO_API_KEY": "k"}, "ship it", ["a.py"]
    )
    assert result == ["No deploys after 5pm. [source: release-policy.md]"]


def test_checkpoint_review_input_gains_conventions(tmp_repo, scrubbed_env, monkeypatch):
    from proofjury import checkpoint as checkpoint_module

    record = {
        "id": "ckpt_001",
        "repo_id": "r",
        "task": "add refunds",
        "changed_files": ["payments.py"],
        "diff_excerpt": "+ def refund(): ...",
    }

    assert "Team conventions" not in checkpoint_module._review_input(
        tmp_repo.root, scrubbed_env, record
    )

    monkeypatch.setattr(
        checkpoint_module,
        "_team_conventions",
        lambda *a, **k: ["Payments needs a second QA pass. [source: deploy-runbook.md]"],
    )
    text = checkpoint_module._review_input(tmp_repo.root, scrubbed_env, record)
    assert "Team conventions authored by this org" in text
    assert "[source: deploy-runbook.md]" in text


def test_checkpoint_helper_is_off_by_default(tmp_repo, scrubbed_env):
    from proofjury.checkpoint import _team_conventions

    assert _team_conventions(tmp_repo.root, scrubbed_env, "task", ["a.py"]) == []
