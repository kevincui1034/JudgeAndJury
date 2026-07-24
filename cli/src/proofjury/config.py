"""User-level judge config store — one BYOK key across all projects.

A user has one judge key, not one per repo, so the key lives at
``${XDG_CONFIG_HOME:-~/.config}/proofjury/config.toml`` (0600, outside any
repo). Storing it per-repo would recreate exactly the hand-editing friction
the ``proofjury login`` flow removes.

Reading uses stdlib ``tomllib`` (py3.11+); writing hand-renders a minimal
``[judge]`` table so no third-party TOML writer is needed — the runtime
deps stay at typer + rich + httpx.
"""

from __future__ import annotations

import os
import tomllib
from pathlib import Path
from typing import Mapping

#: provider -> the env var that carries its key.
PROVIDER_ENV_KEYS = {
    "openrouter": "OPENROUTER_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "pioneer": "PIONEER_API_KEY",
}

#: Auto-detect order when no provider is named explicitly. Pioneer sits
#: LAST so adding a PIONEER_API_KEY to the environment never silently
#: re-points an existing user's judge at a different provider.
_AUTODETECT_ORDER = ("openrouter", "anthropic", "openai", "pioneer")


def _env(env: Mapping[str, str] | None) -> Mapping[str, str]:
    return os.environ if env is None else env


def config_path(env: Mapping[str, str] | None = None) -> Path:
    env = _env(env)
    xdg = env.get("XDG_CONFIG_HOME")
    if xdg:
        base = Path(xdg)
    else:
        home = env.get("HOME")
        base = (Path(home) if home else Path.home()) / ".config"
    return base / "proofjury" / "config.toml"


def load_config(env: Mapping[str, str] | None = None) -> dict:
    """Parse the config file; ``{}`` when it's missing or malformed."""
    path = config_path(env)
    try:
        with path.open("rb") as fh:
            return tomllib.load(fh)
    except (OSError, tomllib.TOMLDecodeError):
        return {}


def _toml_scalar(value) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    # escape backslash first, then the quote
    text = str(value).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{text}"'


def _render_toml(data: Mapping) -> str:
    """Minimal TOML: bare top-level scalars, then ``[table]`` sections."""
    lines: list[str] = []
    for key, value in data.items():
        if not isinstance(value, Mapping):
            lines.append(f"{key} = {_toml_scalar(value)}")
    for key, value in data.items():
        if isinstance(value, Mapping):
            lines.append(f"[{key}]")
            for subkey, subval in value.items():
                if subval is None:
                    continue
                lines.append(f"{subkey} = {_toml_scalar(subval)}")
            lines.append("")
    return "\n".join(lines).rstrip("\n") + "\n"


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def save_judge_config(
    provider: str,
    api_key: str,
    model: str | None = None,
    env: Mapping[str, str] | None = None,
) -> Path:
    """Write the ``[judge]`` table (0600), preserving any other tables."""
    config = load_config(env)
    judge: dict = {"provider": provider, "api_key": api_key}
    if model:
        judge["model"] = model
    config["judge"] = judge
    path = config_path(env)
    _atomic_write(path, _render_toml(config))
    os.chmod(path, 0o600)
    return path


def clear_judge_config(env: Mapping[str, str] | None = None) -> str | None:
    """Remove the ``[judge]`` table; delete the file if that's all it held.

    Returns the removed provider (for the CLI to report), or None.
    """
    path = config_path(env)
    config = load_config(env)
    removed = config.get("judge")
    if removed is None:
        return None
    others = {k: v for k, v in config.items() if k != "judge"}
    if others:
        _atomic_write(path, _render_toml(others))
        os.chmod(path, 0o600)
    else:
        try:
            path.unlink()
        except FileNotFoundError:
            pass
    return removed.get("provider") if isinstance(removed, dict) else None


#: Where gate records sync when connected (see ``proofjury connect``).
DEFAULT_SYNC_ENDPOINT = "https://app.proofjury.com/api/v1"


def save_sync_config(
    token: str,
    token_id: str,
    endpoint: str | None = None,
    env: Mapping[str, str] | None = None,
) -> Path:
    """Write the ``[sync]`` table (0600), preserving any other tables.

    ``endpoint`` is persisted only when it differs from the default — a
    dev/test override, not something every config should carry.
    """
    config = load_config(env)
    sync: dict = {"token": token, "token_id": token_id, "enabled": True}
    if endpoint and endpoint != DEFAULT_SYNC_ENDPOINT:
        sync["endpoint"] = endpoint
    config["sync"] = sync
    path = config_path(env)
    _atomic_write(path, _render_toml(config))
    os.chmod(path, 0o600)
    return path


def clear_sync_config(env: Mapping[str, str] | None = None) -> str | None:
    """Remove the ``[sync]`` table; delete the file if that's all it held.

    Returns the removed token_id (for best-effort server-side revoke).
    """
    path = config_path(env)
    config = load_config(env)
    removed = config.get("sync")
    if removed is None:
        return None
    others = {k: v for k, v in config.items() if k != "sync"}
    if others:
        _atomic_write(path, _render_toml(others))
        os.chmod(path, 0o600)
    else:
        try:
            path.unlink()
        except FileNotFoundError:
            pass
    return removed.get("token_id") if isinstance(removed, dict) else None


def resolve_sync(env: Mapping[str, str] | None = None) -> dict | None:
    """``{"token", "token_id", "endpoint"}`` when sync is on, else None.

    ``PROOFJURY_NO_SYNC`` (any non-empty value) wins over config — the
    same belt-and-braces off switch as PROOFJURY_NO_CROSS_REPO. Endpoint
    precedence: PROOFJURY_SYNC_URL > ``[sync].endpoint`` > default.
    """
    env = _env(env)
    if env.get("PROOFJURY_NO_SYNC"):
        return None
    table = load_config(env).get("sync")
    if not isinstance(table, dict):
        return None
    if table.get("enabled") is False:
        return None
    token = table.get("token")
    if not isinstance(token, str) or not token:
        return None
    endpoint = (
        env.get("PROOFJURY_SYNC_URL")
        or table.get("endpoint")
        or DEFAULT_SYNC_ENDPOINT
    )
    return {
        "token": token,
        "token_id": table.get("token_id", ""),
        "endpoint": str(endpoint).rstrip("/"),
    }


def sync_enabled(env: Mapping[str, str] | None = None) -> bool:
    return resolve_sync(env) is not None


#: Sponsor/platform credentials a PROJECT may ship in its own ``.env``
#: (plus anything ``PROOFJURY_``-prefixed). Deliberately an allowlist, not
#: "load every key": a repo-level file must not be able to inject
#: arbitrary environment into the deploy context the env_vars check
#: evaluates.
PROJECT_ENV_KEYS = frozenset(
    {
        "PIONEER_API_KEY",
        "PIONEER_TRAINING_URL",
        "OPENROUTER_API_KEY",
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "SENSO_API_KEY",
        "SENSO_KB_ID",
        "SENSO_API_URL",
        "ACTIAN_VECTOR_URL",
        "ACTIAN_VECTOR_PATH",
        "REPLAY_API_KEY",
    }
)

PROJECT_ENV_FILE = ".env"


def load_project_env(root, env: Mapping[str, str] | None = None) -> dict[str, str]:
    """Allowlisted keys from ``<root>/.env`` that are NOT already set.

    This is how a project ships its own inference credentials instead of
    requiring every user to BYOK. The real environment always wins, so a
    shell export or a CI secret overrides the checked-out file, and a
    missing/unreadable/malformed file is simply no keys.

    The file is git-ignored — a key in the repo is a leaked key.
    """
    from pathlib import Path

    from .envfile import parse_env_file

    env = _env(env)
    try:
        parsed = parse_env_file(Path(root) / PROJECT_ENV_FILE)
    except OSError:
        return {}
    return {
        key: value
        for key, value in parsed.items()
        if (key in PROJECT_ENV_KEYS or key.startswith("PROOFJURY_"))
        and not env.get(key)
    }


def apply_project_env(root, env=None) -> list[str]:
    """Merge ``<root>/.env`` into the process environment; return the
    names applied (never the values — those are secrets)."""
    target = os.environ if env is None else env
    loaded = load_project_env(root, target)
    target.update(loaded)
    return sorted(loaded)


def resolve_judge(
    env: Mapping[str, str] | None = None, config: dict | None = None
) -> dict | None:
    """Resolve ``{provider, api_key, model}`` or None.

    Precedence: PROOFJURY_NO_LLM → None; explicit provider (env
    PROOFJURY_JUDGE_PROVIDER or config ``[judge].provider``, key from the
    matching env var else the stored key); else auto-detect by env key
    presence (openrouter → anthropic → openai); else the stored config;
    else None. Model: PROOFJURY_JUDGE_MODEL → config ``[judge].model`` →
    None (adapter default).
    """
    env = _env(env)
    if env.get("PROOFJURY_NO_LLM"):
        return None
    if config is None:
        config = load_config(env)
    judge_cfg = config.get("judge") or {}
    model = env.get("PROOFJURY_JUDGE_MODEL") or judge_cfg.get("model") or None

    provider = env.get("PROOFJURY_JUDGE_PROVIDER") or judge_cfg.get("provider")
    if provider:
        provider = str(provider).strip().lower()
        env_key = PROVIDER_ENV_KEYS.get(provider)
        api_key = (env.get(env_key) if env_key else None) or judge_cfg.get("api_key")
        if api_key:
            return {"provider": provider, "api_key": api_key, "model": model}
        return None

    for prov in _AUTODETECT_ORDER:
        key = env.get(PROVIDER_ENV_KEYS[prov])
        if key:
            return {"provider": prov, "api_key": key, "model": model}

    stored_provider = judge_cfg.get("provider")
    stored_key = judge_cfg.get("api_key")
    if stored_provider and stored_key:
        return {
            "provider": str(stored_provider).strip().lower(),
            "api_key": stored_key,
            "model": model,
        }
    return None


def llm_configured(env: Mapping[str, str] | None = None) -> bool:
    """True iff an LLM judge would be selected (discoverability hint)."""
    return resolve_judge(env) is not None


#: Defaults for the repo-level ``.proofjury.toml [advisory]`` table. The
#: advisory judge is best-effort and never blocks, so it defaults ON —
#: it only actually runs when an LLM is configured (BYOK) anyway.
ADVISORY_DEFAULTS = {
    "enabled": True,
    "auto_inject_min_confidence": 0.7,  # ≥ → injected to the agent
    "hold_min_confidence": 0.4,         # ≥ → held for human approval
    "max_findings": 5,
    "diff_min_lines": 1,                # diff smaller than this → skip
    "tiers": [4, 5],                    # mute a whole tier with e.g. [4]
    "model": None,                      # None → the judge's resolved model
}


#: Defaults for the repo-level ``.proofjury.toml [impact]`` table. The
#: blast-radius graph is deterministic, local, and context-only (never
#: touches the decision), so it defaults ON.
IMPACT_DEFAULTS = {
    "enabled": True,
    "depth": 2,        # reverse-import BFS depth
    "max_files": 50,   # total dependents emitted across changed files
}


def impact_settings(repo_config: dict | None) -> dict:
    """The ``[impact]`` table from ``.proofjury.toml`` merged over
    ``IMPACT_DEFAULTS``. Malformed values fall back to the default for
    that key — a config typo must never crash the gate.
    """
    settings = dict(IMPACT_DEFAULTS)
    table = (repo_config or {}).get("impact")
    if not isinstance(table, dict):
        return settings
    if isinstance(table.get("enabled"), bool):
        settings["enabled"] = table["enabled"]
    for key in ("depth", "max_files"):
        value = table.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value >= 1:
            settings[key] = value
    return settings


#: Defaults for the repo-level ``.proofjury.toml [memory]`` table. Cross-repo
#: recall reads other local repos' already-scrubbed stores read-only and
#: never affects pass/fail, so it defaults ON.
MEMORY_DEFAULTS = {
    "cross_repo": True,
}


def memory_settings(repo_config: dict | None) -> dict:
    """The ``[memory]`` table from ``.proofjury.toml`` merged over
    ``MEMORY_DEFAULTS``. Malformed values fall back to the default for
    that key — a config typo must never crash the gate.
    """
    settings = dict(MEMORY_DEFAULTS)
    table = (repo_config or {}).get("memory")
    if not isinstance(table, dict):
        return settings
    if isinstance(table.get("cross_repo"), bool):
        settings["cross_repo"] = table["cross_repo"]
    return settings


def cross_repo_enabled(
    repo_config: dict | None, env: Mapping[str, str] | None = None
) -> bool:
    """Whether this gate run participates in cross-repo memory recall.

    ``PROOFJURY_NO_CROSS_REPO`` (any non-empty value) wins over config —
    a belt-and-braces off switch for CI and scripted runs.
    """
    if _env(env).get("PROOFJURY_NO_CROSS_REPO"):
        return False
    return memory_settings(repo_config)["cross_repo"]


def advisory_settings(repo_config: dict | None) -> dict:
    """The ``[advisory]`` table from ``.proofjury.toml`` merged over
    ``ADVISORY_DEFAULTS``. Malformed values fall back to the default for
    that key — a config typo must never crash the gate.
    """
    settings = dict(ADVISORY_DEFAULTS)
    table = (repo_config or {}).get("advisory")
    if not isinstance(table, dict):
        return settings
    if isinstance(table.get("enabled"), bool):
        settings["enabled"] = table["enabled"]
    for key in ("auto_inject_min_confidence", "hold_min_confidence"):
        value = table.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            settings[key] = min(1.0, max(0.0, float(value)))
    for key in ("max_findings", "diff_min_lines"):
        value = table.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            settings[key] = value
    tiers = table.get("tiers")
    if isinstance(tiers, list):
        valid = [t for t in tiers if isinstance(t, int) and t in (4, 5)]
        settings["tiers"] = valid
    model = table.get("model")
    if isinstance(model, str) and model.strip():
        settings["model"] = model.strip()
    return settings


#: Defaults for the repo-level ``.proofjury.toml [checkpoint]`` table —
#: claim-of-done checkpoints (ROADMAP-intent.md). Recording is deterministic
#: and free; LLM work (classification, intent review) only happens with a
#: configured key and always in a detached background process.
#: ``model`` deliberately NEVER inherits ``[advisory].model``: that override
#: exists for low-volume deploy review; applying it at checkpoint volume
#: would silently multiply cost.
CHECKPOINT_DEFAULTS = {
    "enabled": True,
    "mode": "advise",                    # "passive" | "advise" | "active"
    "min_diff_lines": 1,                 # smaller diffs → no checkpoint
    "max_per_hour": 12,                  # rate cap on recorded checkpoints
    "auto_inject_min_confidence": 0.7,   # ≥ → staged for next-prompt injection
    "active_min_confidence": 0.85,       # active mode: ≥ tier-5 → continue-turn
    "model": None,                       # None → the judge's resolved model
}

_CHECKPOINT_MODES = ("passive", "advise", "active")


def checkpoint_settings(repo_config: dict | None) -> dict:
    """The ``[checkpoint]`` table merged over ``CHECKPOINT_DEFAULTS``.
    Malformed values fall back to the default for that key."""
    settings = dict(CHECKPOINT_DEFAULTS)
    table = (repo_config or {}).get("checkpoint")
    if not isinstance(table, dict):
        return settings
    if isinstance(table.get("enabled"), bool):
        settings["enabled"] = table["enabled"]
    mode = table.get("mode")
    if isinstance(mode, str) and mode.strip().lower() in _CHECKPOINT_MODES:
        settings["mode"] = mode.strip().lower()
    for key in ("min_diff_lines", "max_per_hour"):
        value = table.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            settings[key] = value
    for key in ("auto_inject_min_confidence", "active_min_confidence"):
        value = table.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            settings[key] = min(1.0, max(0.0, float(value)))
    model = table.get("model")
    if isinstance(model, str) and model.strip():
        settings["model"] = model.strip()
    return settings


def checkpoints_enabled(
    repo_config: dict | None, env: Mapping[str, str] | None = None
) -> bool:
    """``PROOFJURY_NO_CHECKPOINT`` (any non-empty value) wins over config."""
    if _env(env).get("PROOFJURY_NO_CHECKPOINT"):
        return False
    return checkpoint_settings(repo_config)["enabled"]


#: Defaults for the repo-level ``.proofjury.toml [semantic]`` table —
#: recall by meaning over an embedded Actian VectorAI DB (PLAN-swarmhack
#: H3). Defaults ON because it is doubly self-gating: it needs BOTH the
#: Actian library installed AND an embedding-capable judge key, and
#: without either ``semantic.get_index`` returns None and recall is
#: byte-identical to today's. It reads the same scrubbed text the judge
#: already sees, so it opens no new egress category.
SEMANTIC_DEFAULTS = {
    "enabled": True,
    "top_k": 5,
    "embed_model": None,  # None → semantic.DEFAULT_EMBED_MODEL
}


def semantic_settings(repo_config: dict | None) -> dict:
    """The ``[semantic]`` table merged over ``SEMANTIC_DEFAULTS``.
    Malformed values fall back to the default for that key."""
    settings = dict(SEMANTIC_DEFAULTS)
    table = (repo_config or {}).get("semantic")
    if not isinstance(table, dict):
        return settings
    if isinstance(table.get("enabled"), bool):
        settings["enabled"] = table["enabled"]
    value = table.get("top_k")
    if isinstance(value, int) and not isinstance(value, bool) and value >= 1:
        settings["top_k"] = value
    model = table.get("embed_model")
    if isinstance(model, str) and model.strip():
        settings["embed_model"] = model.strip()
    return settings


def semantic_enabled(
    repo_config: dict | None, env: Mapping[str, str] | None = None
) -> bool:
    """``PROOFJURY_NO_SEMANTIC`` (any non-empty value) wins over config."""
    if _env(env).get("PROOFJURY_NO_SEMANTIC"):
        return False
    return semantic_settings(repo_config)["enabled"]


#: Defaults for the repo-level ``.proofjury.toml [conventions]`` table —
#: human-authored team policy fetched from a Senso KB (PLAN-swarmhack H5).
#: Unlike every other context surface this defaults OFF: it is the only one
#: that leaves the machine, so participation is an explicit opt-in.
CONVENTIONS_DEFAULTS = {
    "enabled": False,
    "senso_kb": None,   # None → SENSO_KB_ID from the environment
    "max_results": 5,
}


def conventions_settings(repo_config: dict | None) -> dict:
    """The ``[conventions]`` table merged over ``CONVENTIONS_DEFAULTS``.
    Malformed values fall back to the default for that key."""
    settings = dict(CONVENTIONS_DEFAULTS)
    table = (repo_config or {}).get("conventions")
    if not isinstance(table, dict):
        return settings
    if isinstance(table.get("enabled"), bool):
        settings["enabled"] = table["enabled"]
    kb = table.get("senso_kb")
    if isinstance(kb, str) and kb.strip():
        settings["senso_kb"] = kb.strip()
    value = table.get("max_results")
    if isinstance(value, int) and not isinstance(value, bool) and value >= 1:
        settings["max_results"] = value
    return settings


def conventions_enabled(
    repo_config: dict | None, env: Mapping[str, str] | None = None
) -> bool:
    """``PROOFJURY_NO_CONVENTIONS`` (any non-empty value) wins over config —
    the same belt-and-braces off switch the other context surfaces have."""
    if _env(env).get("PROOFJURY_NO_CONVENTIONS"):
        return False
    return conventions_settings(repo_config)["enabled"]


#: Defaults for the repo-level ``.proofjury.toml [prefs]`` table — learned
#: user preferences (ROADMAP-intent.md I4). Only ``active`` (human-approved)
#: preferences are ever injected; candidates just wait in `proofjury prefs`.
PREFS_DEFAULTS = {
    "enabled": True,
    "inject_at_session_start": True,
    "graduation_min_corrections": 3,
}


def prefs_settings(repo_config: dict | None) -> dict:
    """The ``[prefs]`` table merged over ``PREFS_DEFAULTS``."""
    settings = dict(PREFS_DEFAULTS)
    table = (repo_config or {}).get("prefs")
    if not isinstance(table, dict):
        return settings
    for key in ("enabled", "inject_at_session_start"):
        if isinstance(table.get(key), bool):
            settings[key] = table[key]
    value = table.get("graduation_min_corrections")
    if isinstance(value, int) and not isinstance(value, bool) and value >= 1:
        settings["graduation_min_corrections"] = value
    return settings


def prefs_enabled(
    repo_config: dict | None, env: Mapping[str, str] | None = None
) -> bool:
    """``PROOFJURY_NO_PREFS`` (any non-empty value) wins over config."""
    if _env(env).get("PROOFJURY_NO_PREFS"):
        return False
    return prefs_settings(repo_config)["enabled"]
