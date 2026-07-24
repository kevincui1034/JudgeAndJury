"""PioneerJudge — Pioneer (Fastino Labs) as a first-class judge provider.

Pioneer exposes an OpenAI-compatible ``/chat/completions`` endpoint with
model routing, so this is an adapter over the shared
``ChatCompletionsJudge`` transport — ``_chat()`` is reused wholesale and
every LLM surface (diagnosis, advisory, intent classifier, checkpoint
reviewer) rides it at once.

Two things differ from the OpenRouter adapter and are the whole reason
this is a sibling of ``ChatCompletionsJudge`` rather than a subclass of
``OpenRouterJudge``:

- **Auth header.** Pioneer authenticates with ``X-API-Key: <key>``, not
  ``Authorization: Bearer <key>``.
- **Cost.** OpenRouter returns a per-call ``usage.cost``; Pioneer bills
  credits and returns token counts, so cost comes from the local PRICE
  table — unknown model → 0.0, exactly like the offline judge. What
  Pioneer does return is ``x_pioneer.savings``: a per-1M-token rate delta
  against a named frontier baseline. That is a saving, not a spend, so it
  rides the ledger as its own ``saved_usd`` field and never touches
  ``cost_usd`` — see ``_extract_ledger_extra``.

``model`` accepts either a base model id or the job id returned by a
completed Pioneer fine-tune (``job_abc123``). That is what makes stage H2
a config change rather than a code change: point ``[checkpoint].model`` /
``[advisory].model`` at the tuned job id and this adapter serves it.
"""

from __future__ import annotations

from ._openai_compat import MAX_TOKENS, ChatCompletionsJudge, token_cost

PIONEER_URL = "https://api.pioneer.ai/v1/chat/completions"

#: Pioneer's MODEL ROUTER: every prompt is dispatched to the best model
#: for that job across 70+ open and frontier models. It is the default
#: because the judge has three very different surfaces — a cheap
#: correction classifier, a mid-tier advisory reviewer, a heavier
#: diagnosis — and routing per-prompt is strictly better than pinning one
#: model for all three. The platform's Routers page reports the savings
#: versus calling a frontier model every time.
#:
#: Spelled exactly as Pioneer's own catalog reports it — `GET /v1/models`
#: returns the router as `pioneer/auto` (lowercase), not the `Pioneer/Auto`
#: form the launch slide used. Both appear to resolve, but the server's id
#: is the authoritative one.
#:
#: Override with ``[judge].model`` / ``PROOFJURY_JUDGE_MODEL``, a specific
#: catalog id (``GET https://api.pioneer.ai/v1/models`` for chat,
#: ``/base-models`` for embeddings), or a tuned job id from H2.
DEFAULT_MODEL = "pioneer/auto"

#: Pioneer routes to models it does not own, so the bare id it echoes back
#: ("gpt-4.1") would be indistinguishable from a direct OpenAI call in the
#: record and the ledger. Namespacing it keeps provenance readable — and
#: under the router it is what makes the ROUTING DECISION visible: the
#: request says "Pioneer/Auto", the record says which model answered.
PROVIDER_PREFIX = "pioneer/"

#: USD per 1M tokens: (input, output). Pioneer bills in credits rather
#: than publishing per-model USD rates, so this stays empty: an unknown
#: model yields cost 0.0 and the ledger records a free call rather than a
#: fabricated price.
PRICE: dict[str, tuple[float, float]] = {}


def _num(value) -> float:
    """Numeric coercion that treats bools and junk as absent.

    The savings block is untrusted upstream JSON; a stray string must
    degrade to "no savings recorded", never raise mid-diagnosis.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0.0
    return float(value)


def router_savings(usage: dict, rate_diff: dict) -> float:
    """USD the router saved on one call, from Pioneer's own rate deltas.

    ``rate_diff_per_mtok`` is the per-1M-token difference between the
    frontier baseline's rates and the routed model's, so multiplying it by
    this call's token counts yields the saving for this call.

    Cached prompt tokens are billed at the cache-read rate and are a
    SUBSET of ``prompt_tokens`` in the OpenAI usage shape, so they are
    subtracted out before the input rate applies — counting them twice
    would overstate the saving. ``cache_write`` has no counterpart in this
    wire format and is therefore never claimed.
    """
    details = usage.get("prompt_tokens_details") or {}
    cached = max(_num(details.get("cached_tokens")), 0.0)
    prompt = max(_num(usage.get("prompt_tokens")), 0.0)
    uncached = max(prompt - cached, 0.0)
    saved = (
        uncached * _num(rate_diff.get("input"))
        + max(_num(usage.get("completion_tokens")), 0.0) * _num(rate_diff.get("output"))
        + cached * _num(rate_diff.get("cache_read"))
    )
    return saved / 1_000_000


class PioneerJudge(ChatCompletionsJudge):
    """``PROOFJURY_PIONEER_URL`` overrides the endpoint — the hook for a
    local mock server in tests or a self-hosted proxy."""

    endpoint = PIONEER_URL
    endpoint_env = "PROOFJURY_PIONEER_URL"
    default_model = DEFAULT_MODEL

    def _auth_headers(self) -> dict[str, str]:
        return {"X-API-Key": self.api_key}

    def _body_extras(self) -> dict:
        return {"max_tokens": MAX_TOKENS}

    def _label_model(self, model_id: str) -> str:
        # Case-insensitive: the router echoes back "Pioneer/Auto" when it
        # does not name the chosen model, and "pioneer/Pioneer/Auto" would
        # be nonsense.
        if model_id.lower().startswith(PROVIDER_PREFIX):
            return model_id
        return PROVIDER_PREFIX + model_id

    def _extract_cost(self, data: dict) -> float:
        usage = data.get("usage") or {}
        return token_cost(
            PRICE.get(self.model),
            usage.get("prompt_tokens", 0),
            usage.get("completion_tokens", 0),
        )

    def _extract_ledger_extra(self, data: dict) -> dict:
        """Record what the ROUTER SAVED, from Pioneer's own numbers.

        Deliberately NOT folded into ``cost_usd``. Pioneer bills credits
        and publishes no USD rate for the routed model, so the call's cost
        stays the honest 0.0 of an unpriced model; what the response does
        carry is a rate delta against a named frontier baseline, which is a
        different claim and gets a different field. Reading a saving as a
        spend would be the one way to make this ledger lie.

        Absent on a non-router call (a pinned model saves nothing to
        report) and on any response without the block, so the entry shape
        stays three keys unless there is a real number to add.
        """
        savings = (data.get("x_pioneer") or {}).get("savings") or {}
        rate_diff = savings.get("rate_diff_per_mtok") or {}
        if not isinstance(rate_diff, dict):
            return {}
        saved = router_savings(data.get("usage") or {}, rate_diff)
        if saved <= 0:
            return {}
        extra: dict = {"saved_usd": saved}
        baseline = savings.get("baseline_model")
        if baseline:
            # The saving is meaningless without the model it is measured
            # against — store the comparison, not just the number.
            extra["saved_vs"] = str(baseline)
        return extra
