"""Intent judge — classification and checkpoint review (ROADMAP-intent.md).

Two LLM surfaces, both best-effort and decision-free:

- **Classifier** (I2): given the previous claimed-done checkpoint and the
  user's next message, decide whether the message corrects that work.
  Output feeds the checkpoint's ``outcome`` label; wrong answers cost a
  mislabel, never a block.
- **Reviewer** (I3): given a checkpoint's task + diff + active preferences
  + recent corrections, emit advisory-shaped intent findings ("this does
  not match the stated task", "violates preference: small files").

Model policy (locked): the resolved judge's cheap default, overridable
only by ``[checkpoint].model`` — NEVER by ``[advisory].model``. The
classifier always uses the cheap tier even when the reviewer is upgraded.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Mapping

from .. import config as config_module
from ._openai_compat import _FENCE_RE
from .advisory import AdvisoryFinding
from .anthropic_direct import AnthropicJudge
from .openai_direct import OpenAIJudge
from .openrouter import OpenRouterJudge
from .pioneer import PioneerJudge

#: TAXONOMY.md intent categories (v0.3). Small on purpose — categories are
#: graduation signatures, and a sprawling taxonomy never accumulates the
#: ≥3 same-category corrections graduation needs.
INTENT_CATEGORIES = (
    "decomposition",     # split it up / structure it differently
    "size",              # smaller files / shorter functions
    "style_fidelity",    # visual/stylistic result != what was wanted
    "framework_choice",  # wrong library/tool/framework/idiom
    "naming",            # naming conventions
    "scope",             # did more or less than asked
    "other",
)

CLASSIFY_SYSTEM_PROMPT = (
    "You classify one user message in a coding-agent conversation. The "
    "agent just finished a turn and claimed work done (the checkpoint "
    "below); then the user sent this message. Decide: is the message a "
    "CORRECTION of that work (redirects, criticizes, or asks to redo what "
    "the agent just did), or a NEW TASK (moves on — which implicitly "
    "accepts the previous work), or UNCLEAR? Be conservative: when in "
    "doubt, unclear. If a correction, distill WHAT the user actually "
    "wanted into one short third-person statement (e.g. \"wants large "
    "files split into small modules\") and pick the closest category from: "
    + ", ".join(INTENT_CATEGORIES) + ". "
    'Respond as strict JSON: {"kind": "corrected"|"new_task"|"unclear", '
    '"statement": "<distilled want, or empty>", "category": "<category or '
    'empty>", "confidence": <0.0-1.0>}.'
)

REVIEW_SYSTEM_PROMPT = (
    "You are Proofjury's intent reviewer at a claim-of-done checkpoint. "
    "The coding agent just finished a turn. You CANNOT block and must not "
    "try — findings are context only. Review whether the diff matches the "
    "user's stated task and the user's known preferences. Emit findings "
    "ONLY for visible mismatches: tier 5 = the change does not do what the "
    "task asked (missing parts, did something else, scope creep); tier 4 = "
    "the change contradicts a listed user preference or a recent "
    "correction on the same files. No task stated → no tier-5 findings. "
    "No speculation; an empty findings list is a good answer. Respond as "
    'strict JSON: {"findings": [{"concern": "<1-2 sentences>", "tier": '
    '4|5, "confidence": <0.0-1.0>, "target": "<file:line>"|null}]}.'
)


def parse_classification(content: str) -> dict | None:
    """Strict-JSON parse of the classifier reply; None when unusable."""
    text = _FENCE_RE.sub("", (content or "").strip()).strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    kind = parsed.get("kind")
    if kind not in ("corrected", "new_task", "unclear"):
        return None
    confidence = parsed.get("confidence")
    if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
        confidence = 0.0
    statement = parsed.get("statement")
    statement = " ".join(statement.split()) if isinstance(statement, str) else ""
    category = parsed.get("category")
    if category not in INTENT_CATEGORIES:
        category = "other" if kind == "corrected" else ""
    return {
        "kind": kind,
        "statement": statement,
        "category": category,
        "confidence": min(1.0, max(0.0, float(confidence))),
    }


def parse_review_findings(content: str) -> list[AdvisoryFinding]:
    """Reviewer findings, reusing the advisory finding shape (kind
    "intent" so records distinguish them from gate-time advisories)."""
    text = _FENCE_RE.sub("", (content or "").strip()).strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, dict) or not isinstance(parsed.get("findings"), list):
        return []
    findings: list[AdvisoryFinding] = []
    for item in parsed["findings"]:
        if not isinstance(item, dict):
            continue
        concern = item.get("concern")
        tier = item.get("tier")
        confidence = item.get("confidence")
        if not isinstance(concern, str) or not concern.strip():
            continue
        if tier not in (4, 5):
            continue
        if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
            continue
        target = item.get("target")
        if not isinstance(target, str) or not target.strip():
            target = None
        findings.append(
            AdvisoryFinding(
                concern=" ".join(concern.split()),
                kind="intent",
                tier=tier,
                confidence=min(1.0, max(0.0, float(confidence))),
                grounded_in=[],
                target=target,
            )
        )
    return findings


_ADAPTERS = {
    "openrouter": OpenRouterJudge,
    "anthropic": AnthropicJudge,
    "openai": OpenAIJudge,
    "pioneer": PioneerJudge,
}


def get_intent_chat(
    env: Mapping[str, str] | None,
    root: Path | None,
    repo_config: dict | None,
    *,
    for_review: bool = False,
):
    """A ``chat(system, user) -> (content, model_id, cost)`` callable, or
    None when no LLM is configured (checkpoints then record without
    classification/findings — the sensor still works).

    ``for_review=True`` applies the ``[checkpoint].model`` override; the
    classifier ignores it and stays on the resolved (cheap) default.
    """
    resolved = config_module.resolve_judge(env)
    if resolved is None:
        return None
    adapter = _ADAPTERS.get(resolved["provider"])
    if adapter is None:
        return None
    model = resolved["model"]
    if for_review:
        override = config_module.checkpoint_settings(repo_config)["model"]
        model = override or model
    judge = adapter(api_key=resolved["api_key"], model=model, root=root)
    return judge._chat
