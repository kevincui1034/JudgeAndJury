"""Project-shipped credentials via a git-ignored ``.env``.

The hackathon build inverts Proofjury's BYOK default: the PROJECT
supplies the Pioneer key and model rather than each user bringing their
own. These tests pin the three properties that keeps safe — an
allowlist (a repo file cannot inject arbitrary deploy environment), real
env always wins, and a malformed file is never fatal.
"""

import pytest
from typer.testing import CliRunner

from proofjury import config
from proofjury.cli import app

runner = CliRunner()


def _write_env(root, text):
    (root / ".env").write_text(text, encoding="utf-8")


def test_loads_allowlisted_sponsor_keys(tmp_repo):
    _write_env(
        tmp_repo.root,
        "PIONEER_API_KEY=pk-project\n"
        "SENSO_API_KEY=senso-project\n"
        "SENSO_KB_ID=kb-42\n"
        "ACTIAN_VECTOR_URL=localhost:6574\n",
    )
    loaded = config.load_project_env(tmp_repo.root, {})
    assert loaded["PIONEER_API_KEY"] == "pk-project"
    assert loaded["SENSO_KB_ID"] == "kb-42"
    assert loaded["ACTIAN_VECTOR_URL"] == "localhost:6574"


def test_proofjury_prefixed_keys_are_allowed(tmp_repo):
    """This is how a project pins its provider and model without code."""
    _write_env(
        tmp_repo.root,
        "PROOFJURY_JUDGE_PROVIDER=pioneer\nPROOFJURY_JUDGE_MODEL=Pioneer/Auto\n",
    )
    loaded = config.load_project_env(tmp_repo.root, {})
    assert loaded["PROOFJURY_JUDGE_PROVIDER"] == "pioneer"
    assert loaded["PROOFJURY_JUDGE_MODEL"] == "Pioneer/Auto"


def test_non_allowlisted_keys_are_ignored(tmp_repo):
    """A repo-level file must not be able to inject arbitrary environment
    into the deploy context the env_vars check evaluates."""
    _write_env(
        tmp_repo.root,
        "PIONEER_API_KEY=pk\nDATABASE_URL=postgres://prod\nPATH=/evil\nAWS_SECRET=x\n",
    )
    loaded = config.load_project_env(tmp_repo.root, {})
    assert set(loaded) == {"PIONEER_API_KEY"}


def test_real_environment_always_wins(tmp_repo):
    """A shell export or CI secret overrides the checked-out file."""
    _write_env(tmp_repo.root, "PIONEER_API_KEY=from-file\n")
    loaded = config.load_project_env(tmp_repo.root, {"PIONEER_API_KEY": "from-shell"})
    assert "PIONEER_API_KEY" not in loaded


def test_empty_value_in_env_does_not_shadow_the_file(tmp_repo):
    _write_env(tmp_repo.root, "PIONEER_API_KEY=from-file\n")
    loaded = config.load_project_env(tmp_repo.root, {"PIONEER_API_KEY": ""})
    assert loaded["PIONEER_API_KEY"] == "from-file"


@pytest.mark.parametrize(
    "text", ["", "# only a comment\n", "not-a-kv-line\n", "=novalue\n"]
)
def test_degenerate_files_yield_nothing(tmp_repo, text):
    _write_env(tmp_repo.root, text)
    assert config.load_project_env(tmp_repo.root, {}) == {}


def test_missing_file_is_not_an_error(tmp_repo):
    assert config.load_project_env(tmp_repo.root, {}) == {}


def test_apply_returns_names_never_values(tmp_repo):
    _write_env(tmp_repo.root, "PIONEER_API_KEY=pk-secret\nSENSO_KB_ID=kb-1\n")
    env = {}
    applied = config.apply_project_env(tmp_repo.root, env)
    assert applied == ["PIONEER_API_KEY", "SENSO_KB_ID"]
    assert "pk-secret" not in " ".join(applied)
    assert env["PIONEER_API_KEY"] == "pk-secret"


def test_cli_bootstrap_loads_the_project_env(tmp_repo, monkeypatch):
    """End to end: a repo that ships .env needs no `proofjury login`."""
    monkeypatch.chdir(tmp_repo.root)
    monkeypatch.delenv("PIONEER_API_KEY", raising=False)
    monkeypatch.delenv("PROOFJURY_NO_LLM", raising=False)
    _write_env(
        tmp_repo.root,
        "PIONEER_API_KEY=pk-project\nPROOFJURY_JUDGE_PROVIDER=pioneer\n",
    )

    result = runner.invoke(app, ["status"])
    assert result.exit_code == 0

    resolved = config.resolve_judge()
    assert resolved is not None
    assert resolved["provider"] == "pioneer"
    assert resolved["api_key"] == "pk-project"


def test_malformed_env_never_stops_a_command(tmp_repo, monkeypatch):
    monkeypatch.chdir(tmp_repo.root)
    (tmp_repo.root / ".env").write_bytes(b"\xff\xfe not utf-8 at all")
    result = runner.invoke(app, ["status"])
    assert result.exit_code == 0


def test_env_file_is_gitignored_by_the_repo():
    """A key in the repo is a leaked key — the ignore rule is the guard."""
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    assert ".env" in (root / ".gitignore").read_text(encoding="utf-8").split()
