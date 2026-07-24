"""Pioneer as a first-class judge provider (PLAN-swarmhack H1).

Pioneer is OpenAI-chat-completions-shaped, so the adapter reuses
``ChatCompletionsJudge._chat()`` wholesale. What these tests pin is the
two places Pioneer is NOT OpenRouter — the ``X-API-Key`` auth header and
the absence of OpenRouter's ``usage.include`` cost accounting — plus the
thing that makes Pioneer worth adding at all: it becomes the transport
for EVERY LLM surface (diagnosis, advisory, intent) at once.
"""

import json

import httpx
import pytest

from proofjury import config
from proofjury.checks.base import CheckResult, Evidence
from proofjury.judge import (
    DeterministicJudge,
    JudgeInput,
    OpenRouterJudge,
    PioneerJudge,
    get_judge,
)
from proofjury.judge.advisory import (
    AdvisoryInput,
    PioneerAdvisoryJudge,
    get_advisory_judge,
)
from proofjury.judge.deterministic import MODEL_ID as DETERMINISTIC_MODEL_ID
from proofjury.judge.intent import get_intent_chat
from proofjury.judge.pioneer import PIONEER_URL


def _judge_input() -> JudgeInput:
    return JudgeInput(
        action="deploy",
        repo_id="demo-app",
        failures=[
            CheckResult(
                name="env_vars",
                passed=False,
                failure_class="missing_env_var",
                evidence=[Evidence(file="payments.py", line=14, detail="STRIPE_API_KEY")],
                evidence_suffix="unset",
                fix_hint="export STRIPE_API_KEY=<value>",
            )
        ],
        git_summary="not a git repository",
    )


def _reply(content: str, model: str = "gpt-4.1", **usage) -> dict:
    return {
        "model": model,
        "choices": [{"message": {"content": content}}],
        "usage": usage or {"prompt_tokens": 1000, "completion_tokens": 500},
    }


# --------------------------------------------------------------------------
# transport: the two ways Pioneer differs from OpenRouter
# --------------------------------------------------------------------------


def test_pioneer_success_parses_and_writes_ledger(tmp_path):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["api_key_header"] = request.headers.get("X-API-Key")
        seen["auth_header"] = request.headers.get("Authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json=_reply(
                json.dumps({"diagnosis": "Pioneer diagnosis", "fix_steps": ["step one"]})
            ),
        )

    judge = PioneerJudge(
        api_key="pk-test",
        transport=httpx.MockTransport(handler),
        root=tmp_path / ".proofjury",
    )
    output = judge.diagnose(_judge_input())

    assert output.diagnosis == "Pioneer diagnosis"
    assert output.fix_steps == ["step one"]
    # Namespaced: the record must say Pioneer served this, not "gpt-4.1".
    assert output.model_id == "pioneer/gpt-4.1"
    assert seen["url"] == PIONEER_URL
    # Pioneer authenticates with X-API-Key, NOT Authorization: Bearer.
    assert seen["api_key_header"] == "pk-test"
    assert seen["auth_header"] is None
    assert seen["body"]["max_tokens"] == 700
    # OpenRouter's usage-accounting opt-in must never leak onto Pioneer.
    assert "usage" not in seen["body"]
    assert seen["body"]["messages"][0]["role"] == "system"
    assert "STRIPE_API_KEY (payments.py:14)" in seen["body"]["messages"][1]["content"]

    ledger = json.loads(
        (tmp_path / ".proofjury" / "ledger.jsonl").read_text().splitlines()[0]
    )
    assert ledger["model"] == "pioneer/gpt-4.1"


def test_pioneer_unknown_model_costs_zero_rather_than_guessing(tmp_path):
    """Pioneer bills credits, not published USD rates. An unpriced model
    records 0.0 — the offline-judge convention — never an invented price."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_reply(
                json.dumps({"diagnosis": "d", "fix_steps": []}),
                prompt_tokens=100_000,
                completion_tokens=50_000,
            ),
        )

    judge = PioneerJudge(
        api_key="k",
        transport=httpx.MockTransport(handler),
        root=tmp_path / ".proofjury",
    )
    assert judge.diagnose(_judge_input()).cost_usd == 0.0


# --------------------------------------------------------------------------
# router savings: what pioneer/auto saved, kept distinct from what it cost
# --------------------------------------------------------------------------


def _savings_block(baseline: str = "gpt-5.5", **rates) -> dict:
    """The ``x_pioneer`` envelope, shaped as the live API returns it."""
    return {
        "inference_id": "2d259e9f-3d5b-4514-9b95-a36b767b8498",
        "routed_model": "zai-org/GLM-5.2",
        "savings": {
            "baseline_model": baseline,
            "routed_model": "zai-org/GLM-5.2",
            "rate_diff_per_mtok": rates
            or {"input": 3.5, "output": 25.5, "cache_read": 0.2, "cache_write": 3.5},
        },
    }


def _ledger_line(tmp_path):
    return json.loads(
        (tmp_path / ".proofjury" / "ledger.jsonl").read_text().splitlines()[0]
    )


def _run(tmp_path, payload):
    judge = PioneerJudge(
        api_key="k",
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=payload)),
        root=tmp_path / ".proofjury",
    )
    return judge.diagnose(_judge_input())


def test_router_savings_are_recorded_without_inflating_cost(tmp_path):
    """Pioneer reports a rate delta versus a frontier baseline, not a
    price. It must land as a saving; the call's cost stays the honest 0.0
    of an unpriced model."""
    payload = _reply(
        json.dumps({"diagnosis": "d", "fix_steps": []}),
        model="zai-org/GLM-5.2",
        prompt_tokens=1_000_000,
        completion_tokens=1_000_000,
    )
    payload["x_pioneer"] = _savings_block()

    output = _run(tmp_path, payload)
    entry = _ledger_line(tmp_path)

    # 1M prompt @ $3.5 + 1M completion @ $25.5 saved per 1M tokens.
    assert entry["saved_usd"] == pytest.approx(29.0)
    assert entry["saved_vs"] == "gpt-5.5"
    # The saving is NOT a spend.
    assert entry["cost_usd"] == 0.0
    assert output.cost_usd == 0.0
    assert entry["model"] == "pioneer/zai-org/GLM-5.2"


def test_cached_prompt_tokens_are_not_counted_at_both_rates(tmp_path):
    """``cached_tokens`` is a SUBSET of ``prompt_tokens`` in this wire
    shape, so charging it the input rate too would overstate the saving."""
    payload = _reply(
        json.dumps({"diagnosis": "d", "fix_steps": []}),
        prompt_tokens=1_000_000,
        completion_tokens=0,
        prompt_tokens_details={"cached_tokens": 400_000},
    )
    payload["x_pioneer"] = _savings_block(input=10.0, cache_read=1.0)

    _run(tmp_path, payload)
    # 600k uncached @ $10 + 400k cached @ $1 = $6.40, not $10.40.
    assert _ledger_line(tmp_path)["saved_usd"] == pytest.approx(6.4)


def test_a_response_without_the_savings_block_keeps_the_old_entry_shape(tmp_path):
    """Every other provider — and Pioneer on a pinned model — must keep the
    exact three-key ledger entry that existing readers parse."""
    _run(tmp_path, _reply(json.dumps({"diagnosis": "d", "fix_steps": []})))
    assert set(_ledger_line(tmp_path)) == {"ts", "model", "cost_usd"}


def test_a_malformed_savings_block_is_dropped_not_raised(tmp_path):
    """The block is untrusted upstream JSON; junk must degrade to 'no
    savings recorded' rather than break a diagnosis."""
    payload = _reply(json.dumps({"diagnosis": "d", "fix_steps": []}))
    payload["x_pioneer"] = {"savings": {"rate_diff_per_mtok": "not-a-dict"}}

    assert _run(tmp_path, payload).diagnosis == "d"
    assert set(_ledger_line(tmp_path)) == {"ts", "model", "cost_usd"}


def test_stats_aggregates_savings_separately_from_spend(tmp_path):
    """`proofjury memory stats` must report the two as different numbers."""
    from proofjury.memory.export import read_ledger

    ledger_path = tmp_path / "ledger.jsonl"
    ledger_path.write_text(
        "\n".join(
            json.dumps(entry)
            for entry in [
                {"ts": "t", "model": "pioneer/a", "cost_usd": 0.0, "saved_usd": 1.5,
                 "saved_vs": "gpt-5.5"},
                {"ts": "t", "model": "pioneer/a", "cost_usd": 0.0, "saved_usd": 0.5,
                 "saved_vs": "gpt-5.5"},
                {"ts": "t", "model": "openai/gpt-4o-mini", "cost_usd": 0.02},
            ]
        )
        + "\n"
    )
    data = read_ledger(ledger_path)

    assert data["calls"] == 3
    assert data["total_cost_usd"] == pytest.approx(0.02)
    assert data["total_saved_usd"] == pytest.approx(2.0)
    assert data["saved_vs"] == {"gpt-5.5": 2}
    assert data["by_model"]["pioneer/a"]["saved_usd"] == pytest.approx(2.0)
    # A provider that reports no savings reads as 0.0, never as missing.
    assert data["by_model"]["openai/gpt-4o-mini"]["saved_usd"] == 0.0


def test_pioneer_default_model_is_the_router():
    """Pioneer/Auto dispatches each prompt to the best model for the job.
    The judge has three surfaces with very different cost profiles (cheap
    correction classifier, mid-tier advisory reviewer, heavier diagnosis),
    so routing per-prompt beats pinning one model for all three."""
    assert PioneerJudge(api_key="k").model == "pioneer/auto"


def test_router_choice_is_visible_in_the_record(tmp_path):
    """The request says Pioneer/Auto; the record says which model actually
    answered — that is how routing decisions become auditable."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["model"] == "pioneer/auto"
        return httpx.Response(
            200,
            json=_reply(
                json.dumps({"diagnosis": "d", "fix_steps": []}), model="qwen3-32b"
            ),
        )

    judge = PioneerJudge(
        api_key="k",
        transport=httpx.MockTransport(handler),
        root=tmp_path / ".proofjury",
    )
    assert judge.diagnose(_judge_input()).model_id == "pioneer/qwen3-32b"


def test_router_echoing_its_own_name_is_not_double_prefixed(tmp_path):
    """The router may echo "Pioneer/Auto" back rather than naming the
    chosen model; "pioneer/Pioneer/Auto" would be nonsense."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_reply(
                json.dumps({"diagnosis": "d", "fix_steps": []}), model="Pioneer/Auto"
            ),
        )

    judge = PioneerJudge(
        api_key="k",
        transport=httpx.MockTransport(handler),
        root=tmp_path / ".proofjury",
    )
    assert judge.diagnose(_judge_input()).model_id == "Pioneer/Auto"


def test_pioneer_serves_a_finetuned_job_id(tmp_path):
    """H2's wire-up: a completed fine-tune's job id is just a model id, so
    switching the gate onto the tuned judge is config, not code."""
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json=_reply(
                json.dumps({"diagnosis": "tuned", "fix_steps": []}), model="job_abc123"
            ),
        )

    judge = PioneerJudge(
        api_key="k",
        model="job_abc123",
        transport=httpx.MockTransport(handler),
        root=tmp_path / ".proofjury",
    )
    output = judge.diagnose(_judge_input())
    # The wire carries the bare job id; the record carries the provenance.
    assert seen["body"]["model"] == "job_abc123"
    assert output.model_id == "pioneer/job_abc123"


def test_provider_prefix_is_not_doubled_when_already_namespaced(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_reply(
                json.dumps({"diagnosis": "d", "fix_steps": []}), model="pioneer/gpt-4.1"
            ),
        )

    judge = PioneerJudge(
        api_key="k",
        transport=httpx.MockTransport(handler),
        root=tmp_path / ".proofjury",
    )
    assert judge.diagnose(_judge_input()).model_id == "pioneer/gpt-4.1"


def test_other_providers_keep_bare_model_ids(tmp_path):
    """The provenance hook is Pioneer-only — no existing record shape moves."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "model": "openai/gpt-4o-mini",
                "choices": [
                    {"message": {"content": json.dumps({"diagnosis": "d", "fix_steps": []})}}
                ],
                "usage": {"cost": 0.001},
            },
        )

    judge = OpenRouterJudge(
        api_key="k",
        transport=httpx.MockTransport(handler),
        root=tmp_path / ".proofjury",
    )
    assert judge.diagnose(_judge_input()).model_id == "openai/gpt-4o-mini"


def test_pioneer_error_falls_back_to_deterministic(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    judge = PioneerJudge(
        api_key="k",
        transport=httpx.MockTransport(handler),
        root=tmp_path / ".proofjury",
    )
    output = judge.diagnose(_judge_input())
    assert output.model_id == DETERMINISTIC_MODEL_ID
    assert not (tmp_path / ".proofjury" / "ledger.jsonl").exists()


def test_pioneer_endpoint_env_override(monkeypatch):
    monkeypatch.setenv("PROOFJURY_PIONEER_URL", "http://127.0.0.1:9931/chat/completions")
    assert PioneerJudge(api_key="k").endpoint == "http://127.0.0.1:9931/chat/completions"

    monkeypatch.delenv("PROOFJURY_PIONEER_URL")
    assert PioneerJudge(api_key="k").endpoint == PIONEER_URL  # unset → class default


# --------------------------------------------------------------------------
# provider selection
# --------------------------------------------------------------------------


def test_factory_selects_pioneer_from_env(tmp_path):
    env = {"XDG_CONFIG_HOME": str(tmp_path / "cfg"), "PIONEER_API_KEY": "pk-1"}
    judge = get_judge(env, root=tmp_path)
    assert isinstance(judge, PioneerJudge)
    assert judge.api_key == "pk-1"
    assert judge.model == "pioneer/auto"


def test_autodetect_keeps_pioneer_last(tmp_path):
    """Adding PIONEER_API_KEY to an environment must never silently
    re-point an existing user's judge away from their provider."""
    env = {
        "XDG_CONFIG_HOME": str(tmp_path / "cfg"),
        "OPENROUTER_API_KEY": "or-1",
        "PIONEER_API_KEY": "pk-1",
    }
    assert isinstance(get_judge(env, root=tmp_path), OpenRouterJudge)


def test_explicit_provider_selects_pioneer_over_another_key(tmp_path):
    env = {
        "XDG_CONFIG_HOME": str(tmp_path / "cfg"),
        "PROOFJURY_JUDGE_PROVIDER": "pioneer",
        "OPENROUTER_API_KEY": "or-1",
        "PIONEER_API_KEY": "pk-1",
    }
    judge = get_judge(env, root=tmp_path)
    assert isinstance(judge, PioneerJudge)
    assert judge.api_key == "pk-1"


def test_pioneer_from_stored_config(tmp_path):
    env = {"XDG_CONFIG_HOME": str(tmp_path / "cfg")}
    config.save_judge_config("pioneer", "stored-pk", model="job_abc123", env=env)
    judge = get_judge(env, root=tmp_path)
    assert isinstance(judge, PioneerJudge)
    assert judge.api_key == "stored-pk"
    assert judge.model == "job_abc123"


def test_no_llm_flag_still_wins_over_pioneer(tmp_path):
    env = {
        "XDG_CONFIG_HOME": str(tmp_path / "cfg"),
        "PIONEER_API_KEY": "pk-1",
        "PROOFJURY_NO_LLM": "1",
    }
    assert isinstance(get_judge(env), DeterministicJudge)


def test_pioneer_registered_in_config_tables():
    assert config.PROVIDER_ENV_KEYS["pioneer"] == "PIONEER_API_KEY"
    assert config._AUTODETECT_ORDER[-1] == "pioneer"


def test_login_accepts_pioneer_provider():
    from proofjury.cli import JUDGE_PROVIDERS

    assert "pioneer" in JUDGE_PROVIDERS


# --------------------------------------------------------------------------
# every LLM surface routes through Pioneer, not just the diagnosis judge
# --------------------------------------------------------------------------


def test_advisory_surface_routes_through_pioneer(tmp_path):
    env = {"XDG_CONFIG_HOME": str(tmp_path / "cfg"), "PIONEER_API_KEY": "pk-1"}
    judge = get_advisory_judge(env, tmp_path, {})
    assert isinstance(judge, PioneerAdvisoryJudge)
    assert judge.endpoint == PIONEER_URL


def test_advisory_review_over_pioneer_transport(tmp_path):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["api_key_header"] = request.headers.get("X-API-Key")
        return httpx.Response(
            200,
            json=_reply(
                json.dumps(
                    {
                        "findings": [
                            {
                                "concern": "Unhandled error path on the payment call.",
                                "kind": "discovery",
                                "tier": 4,
                                "confidence": 0.8,
                                "grounded_in": [],
                                "target": "payments.py:14",
                            }
                        ]
                    }
                )
            ),
        )

    judge = PioneerAdvisoryJudge(
        api_key="pk-1",
        transport=httpx.MockTransport(handler),
        root=tmp_path / ".proofjury",
    )
    output = judge.review(
        AdvisoryInput(
            action="deploy",
            repo_id="demo-app",
            task_ref="add payments",
            git_summary="1 file changed",
        )
    )
    assert seen["api_key_header"] == "pk-1"
    assert [f.tier for f in output.findings] == [4]
    assert output.findings[0].target == "payments.py:14"


def test_intent_surface_routes_through_pioneer(tmp_path):
    env = {"XDG_CONFIG_HOME": str(tmp_path / "cfg"), "PIONEER_API_KEY": "pk-1"}
    chat = get_intent_chat(env, tmp_path, {})
    assert chat is not None
    assert isinstance(chat.__self__, PioneerJudge)


def test_intent_reviewer_honors_checkpoint_model_override(tmp_path):
    """[checkpoint].model is how the tuned judge from H2 gets used — the
    classifier stays on the cheap default, the reviewer gets the job id."""
    env = {"XDG_CONFIG_HOME": str(tmp_path / "cfg"), "PIONEER_API_KEY": "pk-1"}
    repo_config = {"checkpoint": {"model": "job_abc123"}}

    reviewer = get_intent_chat(env, tmp_path, repo_config, for_review=True)
    classifier = get_intent_chat(env, tmp_path, repo_config)

    assert reviewer.__self__.model == "job_abc123"
    assert classifier.__self__.model == "pioneer/auto"


def test_advisory_model_override_serves_a_tuned_job_id(tmp_path):
    env = {"XDG_CONFIG_HOME": str(tmp_path / "cfg"), "PIONEER_API_KEY": "pk-1"}
    judge = get_advisory_judge(env, tmp_path, {"advisory": {"model": "job_xyz789"}})
    assert isinstance(judge, PioneerAdvisoryJudge)
    assert judge.model == "job_xyz789"


@pytest.mark.parametrize("surface", ["diagnosis", "advisory", "intent"])
def test_no_pioneer_key_leaves_every_surface_unchanged(tmp_path, surface):
    """Firewall: without a key, Pioneer is invisible — the gate behaves
    exactly as it did before H1 landed."""
    env = {"XDG_CONFIG_HOME": str(tmp_path / "cfg")}
    if surface == "diagnosis":
        assert isinstance(get_judge(env, root=tmp_path), DeterministicJudge)
    elif surface == "advisory":
        assert get_advisory_judge(env, tmp_path, {}) is None
    else:
        assert get_intent_chat(env, tmp_path, {}) is None
