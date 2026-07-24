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
  table — unknown model → 0.0, exactly like the offline judge.

``model`` accepts either a base model id or the job id returned by a
completed Pioneer fine-tune (``job_abc123``). That is what makes stage H2
a config change rather than a code change: point ``[checkpoint].model`` /
``[advisory].model`` at the tuned job id and this adapter serves it.
"""

from __future__ import annotations

from ._openai_compat import ChatCompletionsJudge, token_cost

PIONEER_URL = "https://api.pioneer.ai/v1/chat/completions"

#: Pioneer routes to hosted decoder models; the live catalog is
#: ``GET https://api.pioneer.ai/v1/base-models``. Override per-repo with
#: ``[judge].model`` / ``PROOFJURY_JUDGE_MODEL`` (or with a tuned job id).
DEFAULT_MODEL = "gpt-4.1"
MAX_TOKENS = 700

#: Pioneer routes to models it does not own, so the bare id it echoes back
#: ("gpt-4.1") would be indistinguishable from a direct OpenAI call in the
#: record and the ledger. Namespacing it keeps provenance readable.
PROVIDER_PREFIX = "pioneer/"

#: USD per 1M tokens: (input, output). Pioneer bills in credits rather
#: than publishing per-model USD rates, so this stays empty: an unknown
#: model yields cost 0.0 and the ledger records a free call rather than a
#: fabricated price.
PRICE: dict[str, tuple[float, float]] = {}


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
        if model_id.startswith(PROVIDER_PREFIX):
            return model_id
        return PROVIDER_PREFIX + model_id

    def _extract_cost(self, data: dict) -> float:
        usage = data.get("usage") or {}
        return token_cost(
            PRICE.get(self.model),
            usage.get("prompt_tokens", 0),
            usage.get("completion_tokens", 0),
        )
