"""Agent hook adapters — Claude Code / Codex (PreToolUse) and Cursor
(beforeShellExecution).

Reads the hook JSON from stdin and matches the shell command against
deploy-command patterns. The hook only ever NARROWS permissions, never
widens them:

- Non-deploy commands (and anything it cannot parse as a deploy) get NO
  decision — an empty ``{}`` output — so Claude Code's normal permission
  flow applies untouched. The hook never auto-approves.
- Deploy-shaped commands are gated (``--no-exec``). Failures produce a
  "deny" with a STRUCTURED, agent-actionable payload — failed checks,
  file:line evidence, exact fix steps — so the agent can self-correct
  instead of stalling on a bare denial. A PASSING gate also emits no
  decision: the user's normal permission flow still makes the final call.
- ``proofjury`` invocations themselves are never re-gated (the inner
  command of ``proofjury guard deploy -- ./deploy.sh`` would otherwise
  double-run the gate and duplicate records).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Mapping

from . import config as config_module
from .context import _git, load_config
from .envfile import parse_env_file
from .gate import GateResult, run_gate
from .judge.deterministic import compile_fix_steps

# Start of a shell command: line start, or right after a separator (; | &,
# which covers && and ||), allowing a leading `sudo`, VAR=value assignments,
# and npx/bunx-style launchers. Anchoring every tool pattern to this position
# means a tool name inside a quoted string, a commit message, or a file
# argument (`cat wrangler.toml`, `git commit -m "add docker push"`) never
# counts as a deploy — only an actual invocation does.
_CMD = (
    r"(?:^|[\n;|&])\s*"
    r"(?:sudo\s+)?"
    r"(?:[A-Za-z_]\w*=\S+\s+)*"
    r"(?:(?:npx|bunx|pnpm\s+dlx|yarn\s+dlx)\s+)?"
)


def _cmd(pattern: str) -> str:
    """Anchor a tool pattern to a shell command-invocation position."""
    return _CMD + pattern


#: Shell commands matching any of these regexes are treated as deploys. Tool
#: patterns are anchored to the command-invocation position (see ``_CMD``);
#: the two script patterns keep their own equivalent anchor so reads like
#: ``cat deploy.sh`` or ``ls ../deployments`` never match. Covers the common
#: deploy surfaces out of the box — extend with ``deploy_patterns_extra`` or
#: replace with ``deploy_patterns`` in ``.proofjury.toml [hook]``.
DEFAULT_DEPLOY_PATTERNS = [
    # PaaS / static hosts
    _cmd(r"vercel\s+(?:--prod\b|deploy\b)"),
    _cmd(r"netlify\s+deploy\b"),
    _cmd(r"(?:fly|flyctl)\s+deploy\b"),
    _cmd(r"railway\s+up\b"),
    _cmd(r"wrangler\s+(?:pages\s+)?(?:deploy|publish)\b"),
    _cmd(r"render\s+deploys?\s+create\b"),
    _cmd(r"git\s+push\s+heroku\b"),
    # cloud providers
    _cmd(r"sam\s+deploy\b"),
    _cmd(r"cdk\s+deploy\b"),
    _cmd(r"aws\s+cloudformation\s+deploy\b"),
    _cmd(r"gcloud\s+(?:run|app|functions)\s+deploy\b"),
    _cmd(r"gcloud\s+builds\s+submit\b"),
    # containers / orchestration
    _cmd(r"kubectl\s+(?:apply|rollout)\b"),
    _cmd(r"helm\s+(?:install|upgrade)\b"),
    _cmd(r"docker\s+(?:push|stack\s+deploy)\b"),
    # infrastructure as code
    _cmd(r"(?:terraform|tofu)\s+apply\b"),
    _cmd(r"pulumi\s+up\b"),
    # framework / release CLIs
    _cmd(r"(?:serverless|sls)\s+deploy\b"),
    _cmd(r"sst\s+deploy\b"),
    _cmd(r"kamal\s+(?:deploy|redeploy)\b"),
    _cmd(r"cap\s+\w+\s+deploy\b"),
    # generic release scripts
    _cmd(r"(?:npm|pnpm|yarn|bun)\s+run\s+(?:deploy|release|ship|publish)\b"),
    _cmd(r"(?:make|just)\s+(?:deploy|release|ship|publish)\b"),
    # git push to a prod/production/release branch or remote
    _cmd(r"git\s+push\b.*\b(?:prod|production|release)\b"),
    # explicit deploy scripts, anchored so `cat deploy.sh` never matches
    r"(?:^|&&|\|\||;|\|)\s*(?:bash\s+|sh\s+)?\.?/?[\w./-]*deploy\.sh\b",
    r"(?:^|&&|\|\||;|\|)\s*\./[\w./-]*deploy\b",
]

#: Release-shaped commands: publishing a package / cutting a tagged release.
#: Rare, deliberate, production-affecting — gated ON by default.
DEFAULT_RELEASE_PATTERNS = [
    _cmd(r"(?:npm|pnpm|yarn|bun)\s+publish\b"),
    _cmd(r"cargo\s+publish\b"),
    _cmd(r"gem\s+push\b"),
    _cmd(r"twine\s+upload\b"),
    _cmd(r"uv\s+publish\b"),
    _cmd(r"gh\s+release\s+create\b"),
    _cmd(r"git\s+push\b.*\s--tags\b"),
    _cmd(r"git\s+push\b.*\sv\d+(?:\.\d+)*\b"),
]

#: Merge-shaped commands. Gated OFF by default (`[hook] gate_merges = true`
#: opts in): tests_not_run fails for anyone not stamping runs, so gating
#: every `git merge` out of the box would block routine work. --abort/
#: --continue/--quit are recovery operations, never gated.
DEFAULT_MERGE_PATTERNS = [
    _cmd(r"git\s+merge\s+(?!--abort\b|--continue\b|--quit\b)\S"),
    _cmd(r"gh\s+pr\s+merge\b"),
]

#: Push-shaped commands. Which pushes actually gate is branch policy, not
#: pattern matching: `[hook] gate_pushes` scopes it to the repo's default
#: branch (the default — in CI-deploy workflows the push to main IS the
#: deploy button), every branch, or off. Deletes/dry-runs never gate
#: (see ``push_target_branch``). Pushes to prod-named refs or with tags
#: still gate as deploy/release via ACTION_ORDER precedence.
DEFAULT_PUSH_PATTERNS = [
    _cmd(r"git\s+push\b"),
]

#: Precedence order for action matching: a command matching two groups is
#: gated as the strictest story (deploy > release > merge > push).
ACTION_ORDER = ("deploy", "release", "merge", "push")
_ACTION_DEFAULTS = {
    "deploy": DEFAULT_DEPLOY_PATTERNS,
    "release": DEFAULT_RELEASE_PATTERNS,
    "merge": DEFAULT_MERGE_PATTERNS,
    "push": DEFAULT_PUSH_PATTERNS,
}
_ACTION_DEFAULT_ENABLED = {"deploy": True, "release": True, "merge": False, "push": True}
#: `[hook]` toggle key per action ("push" pluralizes as "pushes").
_ACTION_TOGGLE_KEYS = {"release": "gate_releases", "merge": "gate_merges", "push": "gate_pushes"}

FINAL_INSTRUCTION = "Fix these, then re-run the original command."

AGENTS_SNIPPET = """\
## Deploy safety — Proofjury gate (required)

Before ANY deploy/release/production-affecting command, route it through
`proofjury guard deploy -- <exact command>`. If BLOCKED (exit 2): read the
evidence, apply the listed fixes, re-run the gate. Never use `--force`
unless the human explicitly instructs it. Run tests via
`proofjury run tests -- <test cmd>` — this is how the gate knows tests ran.
"""

PROOFJURY_TOML_TEMPLATE = """\
# Proofjury configuration — https://proofjury.com
# All sections are optional; sensible defaults apply.

[commands]
# Commands the gate expects to have seen run for this worktree
# (stamped via `proofjury run <kind> -- <cmd>`).
# build = "npm run build"
# lint = "ruff check ."
# typecheck = "mypy ."

[env]
# Evaluate the env_vars check against the deploy target's environment
# (an env file) instead of your shell. Values from this file are treated
# as deploy secrets: scrubbed from all persisted output, never executed
# with. If the configured file is unreadable, the hook fails CLOSED.
# file = ".env.production"

[actions]
# Per-action check profiles: which checks evaluate when the gate runs for
# a given action. Deploy and release run every check; merge defaults to
# code-readiness only (tests, build, preprod). Override per action:
# [actions.merge]
# checks = ["tests", "build", "preprod", "secrets"]

[session]
# What the current change is supposed to do — enables tier-5 advisory
# findings ("not what was asked"). Usually captured automatically from
# the agent transcript; set here (or via PROOFJURY_TASK / --task) when
# gating from a plain shell.
# task = "add rate limiting to the webhook endpoint"

[memory]
# Memory recall may cite prior records from your other repos on this
# machine (read-only; local files only; never affects pass/fail). Set to
# false to neither read other repos' stores nor let them read this one.
# cross_repo = true

[advisory]
# The advisory judge (model judgment, never blocking). Runs only when an
# LLM is configured (`proofjury login`); reviews the diff for risks the
# deterministic checks can't enumerate and grounds findings in memory.
# Findings NEVER change the block/allow decision or the exit code.
# enabled = true
# auto_inject_min_confidence = 0.7   # ≥ → sent to the agent as context
# hold_min_confidence = 0.4          # ≥ → held for `proofjury advisory approve`
# max_findings = 5
# diff_min_lines = 1                 # skip trivial diffs
# tiers = [4, 5]                     # [4] mutes tier-5 findings entirely
# model = ""                         # blank → the judge's resolved model

# NOTE: [hook] must stay the LAST section — proofjury init appends
# detected deploy_patterns_extra to the end of this file.
[hook]
# Shell commands matching any of these regexes are treated as deploys and
# routed through the gate by the Claude Code PreToolUse hook. Proofjury ships
# defaults for Vercel, Netlify, Fly, Railway, Cloudflare (wrangler), Heroku,
# AWS (sam/cdk/cloudformation), GCP (gcloud), Kubernetes (kubectl/helm),
# Docker, Terraform/Pulumi, Serverless/SST, Kamal, Capistrano, npm/make/just
# release scripts, and ./deploy.sh — so most repos need nothing here.
#
# ADD to the built-in defaults (recommended — keeps every default pattern):
# deploy_patterns_extra = ['(?:^|[;&|])\\s*bin/release\\b']
#
# REPLACE the defaults entirely (advanced — you then own the whole list):
# deploy_patterns = ['^make ship$']
#
# Release-shaped commands (npm publish, cargo publish, twine upload,
# gh release create, git push --tags/vN.N) are gated by default; merge
# gating (git merge / gh pr merge) is opt-in. Patterns follow the same
# <action>_patterns / <action>_patterns_extra convention as deploy.
# gate_releases = true
# gate_merges = true
#
# git push: pushes to the repo's DEFAULT branch (main/master) are gated by
# default — in CI-deploy workflows that push is the deploy button. Set to
# "all" to gate every push (feature branches too, for push+PR teams), or
# false to disable. Deletes, dry runs, and tag-only pushes never gate.
# gate_pushes = "default-branch"   # "default-branch" | "all" | false

[checkpoint]
# Claim-of-done checkpoints: each agent turn that changed code is recorded;
# the user's next message labels it (corrected / accepted). Deterministic
# and free; LLM classification/review needs a configured key and runs in a
# detached background process. Kill switch: PROOFJURY_NO_CHECKPOINT=1.
# enabled = true
# mode = "advise"        # "passive" (record only) | "advise" | "active"
# min_diff_lines = 1
# max_per_hour = 12
# model = ""             # intent-review model; NEVER inherits [advisory].model

[prefs]
# Learned preferences graduate from ≥3 same-category corrections into
# candidates; `proofjury prefs approve` activates them and they inject at
# session start. Personal-only — never committed, never in AGENTS.md.
# Kill switch: PROOFJURY_NO_PREFS=1.
# enabled = true
# inject_at_session_start = true
# graduation_min_corrections = 3
"""

#: Leading VAR=value assignments before the actual command word.
_ENV_ASSIGN_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|\"[^\"]*\"|\S*)\s+")


def get_action_patterns(config: dict, action: str) -> list[str]:
    """Resolve ``<action>``-command patterns from ``.proofjury.toml [hook]``.

    ``<action>_patterns_extra`` ADDS to the built-in defaults (recommended —
    you keep the defaults and add your own). ``<action>_patterns`` fully
    REPLACES the defaults (advanced — you own the whole list). Both may be
    set: extras are appended to the override base. Order is preserved and
    duplicates removed.
    """
    hook_cfg = config.get("hook") or {}
    override = hook_cfg.get(f"{action}_patterns")
    extra = hook_cfg.get(f"{action}_patterns_extra")
    if isinstance(override, list) and override:
        base = [str(p) for p in override]
    else:
        base = list(_ACTION_DEFAULTS[action])
    if isinstance(extra, list):
        base += [str(p) for p in extra]
    seen: set[str] = set()
    out: list[str] = []
    for pattern in base:
        if pattern not in seen:
            seen.add(pattern)
            out.append(pattern)
    return out


def get_deploy_patterns(config: dict) -> list[str]:
    """Deploy patterns from config (see ``get_action_patterns``)."""
    return get_action_patterns(config, "deploy")


def action_enabled(config: dict, action: str) -> bool:
    """Whether the hook gates ``action``-shaped commands.

    Deploy is always on (the core product). Release defaults on, merge
    defaults off — toggled by ``[hook] gate_releases`` / ``gate_merges``.
    Push is scoped by ``[hook] gate_pushes`` (see ``push_gate_mode``).
    """
    if action == "deploy":
        return True
    if action == "push":
        return push_gate_mode(config) is not None
    value = (config.get("hook") or {}).get(_ACTION_TOGGLE_KEYS[action])
    if isinstance(value, bool):
        return value
    return _ACTION_DEFAULT_ENABLED[action]


def push_gate_mode(config: dict) -> str | None:
    """Which pushes gate: "default-branch" (the default), "all", or None.

    ``[hook] gate_pushes`` accepts "default-branch", "all", true (= "all"),
    or false (off). Unrecognized values fall back to the default rather
    than silently widening or disabling the gate.
    """
    value = (config.get("hook") or {}).get("gate_pushes")
    if value is False:
        return None
    if value is True or value == "all":
        return "all"
    return "default-branch"


def compile_deploy_patterns(
    patterns: list[str],
    source: str = ".proofjury.toml [hook].deploy_patterns",
    defaults: list[str] | None = None,
) -> list[re.Pattern]:
    """Compile action patterns, dropping invalid ones with a warning.

    A config typo must never lock the agent out of the shell: bad
    patterns are skipped (one stderr line each), and if EVERY configured
    pattern is invalid we fall back to ``defaults`` (the deploy defaults
    when not given).
    """
    compiled: list[re.Pattern] = []
    for pattern in patterns:
        try:
            compiled.append(re.compile(pattern))
        except re.error as exc:
            sys.stderr.write(
                f"proofjury: ignoring invalid deploy pattern {pattern!r} "
                f"from {source}: {exc}\n"
            )
    if not compiled:
        compiled = [re.compile(p) for p in (defaults or DEFAULT_DEPLOY_PATTERNS)]
    return compiled


def match_action(command: str, config: dict) -> str | None:
    """The first enabled action whose patterns match ``command``.

    Checked in ACTION_ORDER precedence (deploy > release > merge > push)
    so a command matching two groups gates as the strictest story. A
    "push" match is pattern-shape only — branch policy (``push_gated``)
    decides whether that particular push actually gates.
    """
    for action in ACTION_ORDER:
        if not action_enabled(config, action):
            continue
        patterns = compile_deploy_patterns(
            get_action_patterns(config, action),
            source=f".proofjury.toml [hook].{action}_patterns",
            defaults=_ACTION_DEFAULTS[action],
        )
        if is_deploy_command(command, patterns):
            return action
    return None


def is_deploy_command(command: str, patterns: list) -> bool:
    """``patterns`` may be regex strings or pre-compiled patterns."""
    return any(re.search(pattern, command) for pattern in patterns)


#: The `git push …` segment of a shell command, up to the next separator.
_PUSH_SEGMENT_RE = re.compile(r"git\s+push\b([^&|;\n]*)")

#: Push flags that mean no code lands on a branch — never gated.
_PUSH_NEVER_GATED_FLAGS = {"--dry-run", "-n", "--delete", "-d", "--tags"}


def push_target_branch(command: str, root: Path) -> str | None:
    """The branch a ``git push`` lands on, or None when nothing gate-worthy
    lands anywhere: deletes, dry runs, tag-only pushes, or a target that
    cannot be determined (e.g. not a git repository).

    Heuristic token walk over the push segment — positional args are
    ``remote [refspec…]``; a refspec's destination is the part after ``:``.
    No refspec means the current branch (git's own default behavior).
    """
    segment = _PUSH_SEGMENT_RE.search(command)
    if segment is None:
        return None
    tokens = segment.group(1).split()
    if _PUSH_NEVER_GATED_FLAGS.intersection(tokens):
        return None
    positionals = [t for t in tokens if not t.startswith("-")]
    dst = None
    if len(positionals) > 1:  # remote + at least one refspec
        src, sep, explicit = positionals[-1].partition(":")
        if sep and not src:
            return None  # ":branch" — a delete
        dst = (explicit if sep else src).lstrip("+")
        if dst.startswith("refs/tags/"):
            return None
        if dst.startswith("refs/heads/"):
            dst = dst[len("refs/heads/"):]
    if dst and dst != "HEAD":
        return dst
    current = (_git(root, "rev-parse", "--abbrev-ref", "HEAD") or "").strip()
    return current if current and current != "HEAD" else None


def default_branch(root: Path) -> str:
    """The repo's default branch: origin's HEAD when known, else the first
    of main/master that exists locally, else "main"."""
    head = (_git(root, "symbolic-ref", "--short", "refs/remotes/origin/HEAD") or "").strip()
    if head:
        return head.split("/", 1)[-1]
    for name in ("main", "master"):
        if _git(root, "show-ref", "--verify", "--quiet", f"refs/heads/{name}") is not None:
            return name
    return "main"


def push_gated(command: str, root: Path, config: dict) -> bool:
    """Branch policy for a push-matched command (see ``push_gate_mode``)."""
    mode = push_gate_mode(config)
    if mode is None:
        return False
    branch = push_target_branch(command, root)
    if branch is None:
        return False
    return mode == "all" or branch == default_branch(root)


# --------------------------------------------------------------------------
# Stack detection — used by `proofjury init` for a transparent summary and to
# seed repo-local deploy entrypoints the built-in defaults might not cover.
# --------------------------------------------------------------------------

#: Marker file (or directory) → the deploy platform it indicates. Every one
#: of these platforms is already covered by DEFAULT_DEPLOY_PATTERNS; the
#: detection is for a transparent init summary, not for coverage.
_STACK_MARKERS: list[tuple[str, str]] = [
    ("vercel.json", "Vercel"),
    (".vercel", "Vercel"),
    ("netlify.toml", "Netlify"),
    ("fly.toml", "Fly.io"),
    ("railway.json", "Railway"),
    ("railway.toml", "Railway"),
    ("wrangler.toml", "Cloudflare (wrangler)"),
    ("wrangler.jsonc", "Cloudflare (wrangler)"),
    ("wrangler.json", "Cloudflare (wrangler)"),
    ("Procfile", "Heroku"),
    ("serverless.yml", "Serverless Framework"),
    ("serverless.yaml", "Serverless Framework"),
    ("sst.config.ts", "SST"),
    ("samconfig.toml", "AWS SAM"),
    ("cdk.json", "AWS CDK"),
    ("Pulumi.yaml", "Pulumi"),
    ("Pulumi.yml", "Pulumi"),
    ("Chart.yaml", "Kubernetes (Helm)"),
    ("kustomization.yaml", "Kubernetes (kustomize)"),
    ("k8s", "Kubernetes"),
    ("Dockerfile", "Docker"),
    ("app.yaml", "Google App Engine"),
    ("config/deploy.rb", "Capistrano/Kamal"),
]

#: package.json script names that look like a production deploy/release.
_DEPLOY_SCRIPT_RE = re.compile(r"(?:^|:)(?:deploy|release|ship|publish)(?::|$)", re.IGNORECASE)
_BARE_DEPLOY_NAMES = {"deploy", "release", "ship", "publish"}


def detect_deploy_stack(root: Path) -> list[str]:
    """Human labels for deploy platforms detected from marker files.

    Every detected platform is already covered by DEFAULT_DEPLOY_PATTERNS;
    this drives a transparent ``proofjury init`` summary. Terraform is matched
    by any top-level ``*.tf`` file.
    """
    found: list[str] = []
    for marker, label in _STACK_MARKERS:
        if (root / marker).exists() and label not in found:
            found.append(label)
    if any(root.glob("*.tf")) and "Terraform" not in found:
        found.append("Terraform")
    return found


def detect_extra_deploy_patterns(root: Path) -> list[str]:
    """Repo-local deploy entrypoints the built-in defaults might not cover.

    Seeded by ``proofjury init`` into ``deploy_patterns_extra``. Currently:
    ``package.json`` scripts named like ``deploy``/``release``/``ship``/
    ``publish`` — including colon-suffixed variants (``deploy:prod``). The
    bare names are already in the defaults, so only the suffixed ones are
    seeded here (each as a ``npm/pnpm/yarn/bun run <name>`` pattern).
    """
    pkg = root / "package.json"
    if not pkg.exists():
        return []
    try:
        data = json.loads(pkg.read_text(encoding="utf-8")) or {}
        scripts = data.get("scripts") or {}
    except (OSError, ValueError):
        return []
    extras: list[str] = []
    for name in scripts:
        if not isinstance(name, str) or name in _BARE_DEPLOY_NAMES:
            continue
        if _DEPLOY_SCRIPT_RE.search(name):
            pattern = _cmd(rf"(?:npm|pnpm|yarn|bun)\s+run\s+{re.escape(name)}\b")
            if pattern not in extras:
                extras.append(pattern)
    return extras


def _first_command_token(command: str) -> str:
    rest = command.lstrip()
    while True:
        match = _ENV_ASSIGN_RE.match(rest)
        if match is None:
            break
        rest = rest[match.end():]
    parts = rest.split(None, 1)
    return parts[0] if parts else ""


def is_proofjury_invocation(command: str) -> bool:
    """True when the command itself is a proofjury call.

    Re-gating ``proofjury guard deploy -- ./deploy.sh`` (whose inner
    command matches the deploy patterns) would double-run the gate and
    duplicate memory records.
    """
    first = _first_command_token(command)
    return first == "proofjury" or Path(first).name == "proofjury"


#: Never read more than this much transcript tail hunting for the task.
_TRANSCRIPT_TAIL_BYTES = 2_000_000


def _text_of_message(message: dict) -> str:
    """Plain text of a transcript message; '' when there is none."""
    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = [
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        ]
        return "\n".join(p for p in parts if p).strip()
    return ""


def task_from_payload(payload: dict) -> str | None:
    """Opportunistic task capture: the most recent user prompt in the
    agent transcript the hook payload points at.

    Best-effort by design — any missing file, oversized transcript tail,
    or unparseable line yields None (tier-5 advisory findings simply
    don't fire). Only the tail of large transcripts is read.
    """
    try:
        path = payload.get("transcript_path")
        if not path:
            return None
        transcript = Path(path)
        size = transcript.stat().st_size
        with transcript.open("rb") as fh:
            if size > _TRANSCRIPT_TAIL_BYTES:
                fh.seek(size - _TRANSCRIPT_TAIL_BYTES)
                fh.readline()  # skip the partial line the seek landed in
            raw_lines = fh.read().decode("utf-8", errors="replace").splitlines()
        for line in reversed(raw_lines):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(entry, dict) or entry.get("type") != "user":
                continue
            message = entry.get("message")
            if not isinstance(message, dict):
                continue
            text = _text_of_message(message)
            if text:
                return text
        return None
    except Exception:
        return None


def _hook_output(decision: str, reason: str) -> dict:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": reason,
        }
    }


def no_decision_output() -> dict:
    """No permission decision: the normal permission flow applies.

    Emitting "allow" here would BYPASS Claude Code's permission system
    and auto-approve the command — the hook must never do that.
    """
    return {}


def deny_output(reason: str) -> dict:
    return _hook_output("deny", reason)


ADVISORY_CONTEXT_HEADER = (
    "Proofjury advisory context (model judgment — informational only, not "
    "a gate decision):"
)


def _advisory_context_text(notes: list[str]) -> str:
    return ADVISORY_CONTEXT_HEADER + "\n" + "\n".join(f"- {note}" for note in notes)


def additional_context_output(notes: list[str]) -> dict:
    """Non-blocking advisory delivery on a PASSING gate.

    Deliberately carries NO ``permissionDecision`` — the normal permission
    flow is untouched; this only adds context to the agent's next turn.
    The advisory path may only ever ADD context, never widen permission.
    """
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "additionalContext": _advisory_context_text(notes),
        }
    }


def build_deny_reason(result: GateResult) -> str:
    """Structured, agent-actionable denial payload."""
    record = result.record
    action = record.action_intercepted or "deploy"
    lines = [
        f"⛔ Proofjury BLOCKED this {action} command (record {record.id}, exit 2).",
        "",
        "Failed checks:",
    ]
    for failure in result.failures:
        lines.append(
            f"- {failure.name} → {failure.failure_class}: {failure.evidence_str()}"
        )
    lines += ["", f"Diagnosis: {record.diagnosis}", "", "Fix steps:"]
    fix_steps = compile_fix_steps(result.failures)
    for i, step in enumerate(fix_steps, start=1):
        lines.append(f"{i}. {step}")
    if result.recalled is not None:
        lines += [
            "",
            f"Memory: recalled from {result.recalled.id} — the same failure was "
            "diagnosed before in this repo.",
        ]
    if result.impact_note:
        # Deterministic reverse-import graph — fix with dependents in mind.
        lines += ["", f"Blast radius: {result.impact_note}."]
    if result.agent_notes:
        # Injected advisories ride along in the deny reason — context only;
        # the block above is the deterministic checks' alone.
        lines += ["", ADVISORY_CONTEXT_HEADER]
        lines += [f"- {note}" for note in result.agent_notes]
    lines += ["", FINAL_INSTRUCTION]
    return "\n".join(lines)


def _gate_command(
    command: str, root: Path, env: Mapping[str, str], task_ref: str | None = None
) -> GateResult | None:
    """Gate one shell command if it matches an enabled action (deploy /
    release / merge).

    Returns None when the command matches no gated action (or could not
    be parsed) — the caller emits its agent's no-decision form. Everything
    past the pattern match fails CLOSED: exceptions propagate so the CLI
    layer can deny.
    """
    try:
        if not isinstance(command, str) or not command.strip():
            return None
        if is_proofjury_invocation(command):
            return None  # never re-gate proofjury itself
        config = load_config(root)
        action = match_action(command, config)
        if action is None:
            return None
        if action == "push" and not push_gated(command, root, config):
            return None
    except Exception:
        # Could not establish that this is a gated command — stay out of
        # the decision and let the normal permission flow handle it.
        return None

    # The command matched a valid deploy pattern: the gate decides. Any
    # error past this point fails CLOSED (the CLI denies on exception).
    # In particular a configured-but-unreadable [env].file must deny, never
    # silently fall back to os.environ — that would reintroduce the exact
    # false negative deploy-env fidelity exists to kill.
    deploy_env = None
    env_file = (config.get("env") or {}).get("file")
    if env_file:
        path = Path(env_file)
        if not path.is_absolute():
            path = root / path
        deploy_env = parse_env_file(path)
    return run_gate(
        root,
        action,
        # Single-element list: the hook is no_exec, so cmd is only ever
        # persisted — this preserves the exact shell text losslessly
        # (shlex.split would raise on unbalanced quotes and fail closed
        # on a legitimate deploy).
        cmd=[command],
        no_exec=True,
        env=dict(env),
        deploy_env=deploy_env,
        task_ref=task_ref,
        render=False,
    )


def handle_hook(payload: dict, root: Path, env: Mapping[str, str]) -> dict:
    """Process one PreToolUse event (Claude Code / Codex share this shape);
    returns the hook output JSON dict.

    Returns ``{}`` (no decision) for everything except a deploy-shaped
    command that fails the gate, which gets a structured "deny".
    """
    try:
        tool_input = payload.get("tool_input") or {}
        command = tool_input.get("command") or ""
    except Exception:
        return no_decision_output()
    result = _gate_command(command, root, env, task_ref=task_from_payload(payload))
    if result is None:
        return no_decision_output()
    if result.failures:
        return deny_output(build_deny_reason(result))
    if result.agent_notes:
        # Passing gate with advisory context: additionalContext only —
        # still NO permission decision (see additional_context_output).
        return additional_context_output(result.agent_notes)
    # Gate passed: still no decision — auto-approving would silently
    # disable the user's Bash permission prompts for deploys.
    return no_decision_output()


# --------------------------------------------------------------------------
# Intent-alignment events (ROADMAP-intent.md) — Stop / UserPromptSubmit /
# SessionStart. All three fail OPEN: these events are observation and
# context delivery, and an internal error must never disturb the agent's
# turn (the opposite polarity of the PreToolUse gate, which fails closed).
# None of them ever emits a permission decision.
# --------------------------------------------------------------------------


def handle_stop_hook(payload: dict, root: Path, env: Mapping[str, str]) -> dict:
    """Turn end = claim of done. Record a checkpoint (deterministic,
    inline, fast); LLM review runs detached — except opt-in active mode,
    which reviews inline and may ask the agent to continue ONCE."""
    from . import checkpoint as checkpoint_module  # late import: keeps hook cold-start lean

    try:
        config = load_config(root)
        if not config_module.checkpoints_enabled(config, env):
            return {}
        settings = config_module.checkpoint_settings(config)
        record = checkpoint_module.record_checkpoint(
            root,
            env,
            event="stop",
            task=task_from_payload(payload),
            session_id=payload.get("session_id"),
        )
        if record is None or settings["mode"] == "passive":
            return {}
        if settings["mode"] == "active" and not payload.get("stop_hook_active"):
            # Opt-in latency: review inline so a high-confidence tier-5
            # mismatch can send the agent back to work. stop_hook_active
            # guards the once-per-turn cap (Claude Code sets it when a
            # stop hook already blocked this turn).
            findings = checkpoint_module.run_intent_review(root, env, record["id"])
            actionable = [
                f
                for f in findings
                if f["tier"] == 5
                and f["confidence"] >= settings["active_min_confidence"]
            ]
            if actionable:
                top = max(actionable, key=lambda f: f["confidence"])
                checkpoint_module.mark_findings_sent(
                    root, [(record["id"], int(top["id"].split("#")[1]))]
                )
                return {
                    "decision": "block",
                    "reason": (
                        "Proofjury intent check — the work does not appear "
                        f"to match the stated task: {top['concern']} "
                        "Address this (or explain why it is correct), then finish."
                    ),
                }
            return {}
        # advise mode: review in a detached worker; findings are staged
        # and drain at the next prompt.
        if env.get("PROOFJURY_INTENT_SYNC"):
            checkpoint_module.run_intent_review(root, env, record["id"])
        else:
            checkpoint_module.spawn_worker(
                root, ["review", record["id"]], None, env
            )
        return {}
    except Exception:
        return {}


def handle_prompt_hook(payload: dict, root: Path, env: Mapping[str, str]) -> dict:
    """UserPromptSubmit: (1) deliver staged intent findings as context;
    (2) hand the prompt to the background classifier, which labels the
    previous checkpoint. The raw prompt is never persisted."""
    from . import checkpoint as checkpoint_module

    output: dict = {}
    try:
        config = load_config(root)
        if not config_module.checkpoints_enabled(config, env):
            return {}
        settings = config_module.checkpoint_settings(config)
        if settings["mode"] != "passive":
            text, pending = checkpoint_module.drain_staged_findings(root)
            if text:
                output = {
                    "hookSpecificOutput": {
                        "hookEventName": "UserPromptSubmit",
                        "additionalContext": text,
                    }
                }
                checkpoint_module.mark_findings_sent(root, pending)
        prompt = payload.get("prompt") or ""
        if isinstance(prompt, str) and prompt.strip():
            if env.get("PROOFJURY_INTENT_SYNC"):
                checkpoint_module.classify_and_label(
                    root, env, prompt, payload.get("session_id")
                )
            else:
                checkpoint_module.spawn_worker(
                    root,
                    ["classify", "--session", str(payload.get("session_id") or "")],
                    prompt,
                    env,
                )
    except Exception:
        return output or {}
    return output


def handle_session_start_hook(
    payload: dict, root: Path, env: Mapping[str, str]
) -> dict:
    """SessionStart: inject ACTIVE (human-approved) preferences so the
    agent codes to them from the first line — the whole point of I4."""
    from .memory import prefs as prefs_module

    try:
        config = load_config(root)
        if not config_module.prefs_enabled(config, env):
            return {}
        if not config_module.prefs_settings(config)["inject_at_session_start"]:
            return {}
        text = prefs_module.render_for_injection(prefs_module.active_prefs(root, env))
        if not text:
            return {}
        return {
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": text,
            }
        }
    except Exception:
        return {}


# Cursor hook output uses snake_case keys (user_message/agent_message) per
# the official hooks doc. LIVE VERIFICATION PENDING (step 6 of
# PLAN-cross-agent-hooks): confirm in a real Cursor session that exit 0 +
# ``{}`` is inert for (a) non-deploy commands and (b) a passing gate; if
# ``{}`` is not inert on the deploy-pass path, switch that path to
# {"permission": "ask"} — never "allow".
def cursor_deny_output(reason: str) -> dict:
    return {
        "permission": "deny",
        "agent_message": reason,
        "user_message": (
            "Proofjury blocked this deploy — see the agent message for the fix list."
        ),
    }


# LIVE VERIFICATION PENDING (same caveat as cursor_deny_output): confirm in
# a real Cursor session that an agent_message WITHOUT a permission key is
# inert on the permission flow. If Cursor treats it as a decision, drop the
# passing-gate delivery for Cursor — never emit permission "allow".
def cursor_context_output(notes: list[str]) -> dict:
    return {"agent_message": _advisory_context_text(notes)}


def handle_cursor_hook(payload: dict, root: Path, env: Mapping[str, str]) -> dict:
    """Process one Cursor ``beforeShellExecution`` event.

    Cursor's stdin schema is FLAT: ``command`` is top-level (plus cwd,
    conversation_id, ...), not nested under ``tool_input`` — feeding a
    Cursor payload to ``handle_hook`` would silently gate nothing.
    Returns ``{}`` (no decision) for everything except a deploy-shaped
    command that fails the gate.
    """
    try:
        command = payload.get("command") or ""
    except Exception:
        return no_decision_output()
    env = dict(env)
    env.setdefault("PROOFJURY_AGENT_SOURCE", "cursor")
    # Cursor payloads don't document a transcript ref today; the capture
    # is a safe no-op when the key is absent.
    result = _gate_command(command, root, env, task_ref=task_from_payload(payload))
    if result is None:
        return no_decision_output()
    if result.failures:
        return cursor_deny_output(build_deny_reason(result))
    if result.agent_notes:
        # Advisory context only — no permission key set.
        return cursor_context_output(result.agent_notes)
    # Gate passed: no decision — Cursor's own permission flow decides.
    return no_decision_output()
