"""Team conventions — human-authored policy as advisory context (Senso).

Proofjury deliberately deferred human-authored team conventions
(ROADMAP-intent.md: conventions are NOT learned preferences — they are a
separate authored surface with a human owner). Senso is that surface: a
verified knowledge base of runbooks, style guides and policies that the
advisory judge can query, with citations.

Three properties this module must never lose:

1. **Context, never authority.** Conventions enter the advisory prompt
   only. Deterministic checks alone decide blocked/exit_code, so a Senso
   outage, a bad KB, or a hallucinated policy can never change a verdict.
2. **Firewalled.** Disabled by default; 3s timeout; ANY error (network,
   auth, malformed payload) yields ``[]``, and the advisory prompt is
   then byte-identical to a run without conventions.
3. **Cited.** Each statement carries ``[source: <doc>]`` so a finding
   that leans on a policy can be traced back to the authored document —
   proof, not promises.

Endpoint note: the Senso developer API is provisioned per-account
(PLAN-swarmhack H0). The default below follows their documented
``SENSO_API_KEY``/REST convention and is overridable with
``SENSO_API_URL`` — and because the layer is firewalled, an endpoint
mismatch degrades to "no conventions", never to a broken gate. The
response parser is deliberately shape-tolerant for the same reason.
"""

from __future__ import annotations

from typing import Callable, Mapping, Sequence

import httpx

#: Overridable with SENSO_API_URL — confirm against the live account at H0.
SENSO_URL = "https://api.senso.ai/v1/search"
TIMEOUT_SECONDS = 3.0

#: Keys the parser will accept for the result list / text / source name.
#: Tolerant on purpose: a shape mismatch must yield "no conventions",
#: never an exception and never a garbled policy statement.
_RESULT_KEYS = ("results", "matches", "documents", "data", "items")
_TEXT_KEYS = ("statement", "text", "content", "snippet", "answer", "summary")
_SOURCE_KEYS = ("title", "document", "source", "name", "file", "doc")


def _query_text(changed_files: Sequence[str], task: str | None) -> str:
    """The natural-language query sent to the KB."""
    bits = ["policies relevant to:"]
    if task:
        bits.append(str(task))
    files = [str(f) for f in changed_files if f][:20]
    if files:
        bits.append("files: " + ", ".join(files))
    return " ".join(bits)


def _render(item: dict) -> str | None:
    """``"<statement> [source: <doc>]"`` from one result, or None."""
    statement = ""
    for key in _TEXT_KEYS:
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            statement = " ".join(value.split())
            break
    if not statement:
        return None
    source = ""
    for key in _SOURCE_KEYS:
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            source = " ".join(value.split())
            break
    return f"{statement} [source: {source}]" if source else statement


def parse_conventions(payload: object, limit: int) -> list[str]:
    """Rendered, cited statements from a Senso search response."""
    items: object = None
    if isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict):
        for key in _RESULT_KEYS:
            if isinstance(payload.get(key), list):
                items = payload[key]
                break
    if not isinstance(items, list):
        return []
    out: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        rendered = _render(item)
        if rendered and rendered not in out:
            out.append(rendered)
        if len(out) >= limit:
            break
    return out


def _default_fetcher(url: str, headers: dict, body: dict) -> object:
    with httpx.Client(timeout=TIMEOUT_SECONDS) as client:
        response = client.post(url, headers=headers, json=body)
        response.raise_for_status()
        return response.json()


def fetch_conventions(
    changed_files: Sequence[str],
    task: str | None,
    env: Mapping[str, str],
    config: dict | None,
    *,
    fetcher: Callable[[str, dict, dict], object] | None = None,
) -> list[str]:
    """Authored team conventions relevant to this change, or ``[]``.

    ``fetcher`` is the injection point used by tests (and by anyone
    swapping Senso for another context service): it receives
    ``(url, headers, body)`` and returns the decoded JSON.
    """
    from .. import config as config_module

    settings = config_module.conventions_settings(config)
    if not settings["enabled"]:
        return []
    api_key = env.get("SENSO_API_KEY")
    if not api_key:
        return []
    kb = settings["senso_kb"] or env.get("SENSO_KB_ID") or ""

    url = env.get("SENSO_API_URL") or SENSO_URL
    headers = {"X-API-Key": api_key, "Content-Type": "application/json"}
    body: dict = {
        "query": _query_text(changed_files, task),
        "max_results": settings["max_results"],
    }
    if kb:
        body["knowledge_base_id"] = kb

    try:
        payload = (fetcher or _default_fetcher)(url, headers, body)
        return parse_conventions(payload, settings["max_results"])
    except Exception:
        return []  # firewalled: no conventions section, prompt unchanged
