"""Web-originated config patches applied locally by the CLI.

The two properties that make remote config editing safe at all: an
allowlist that cannot reach anything capable of weakening the gate, and
edits that preserve the file's documentation comments rather than
re-rendering it.
"""

import tomllib

import pytest

from proofjury.configfile import (
    EDITABLE_TABLES,
    LOCAL_ONLY_TABLES,
    apply_patch,
    file_hash,
)
from proofjury.hooks import PROOFJURY_TOML_TEMPLATE



@pytest.fixture
def repo(tmp_path):
    (tmp_path / ".proofjury.toml").write_text(PROOFJURY_TOML_TEMPLATE, encoding="utf-8")
    return tmp_path


def _toml(repo):
    return tomllib.loads((repo / ".proofjury.toml").read_text(encoding="utf-8"))


# --------------------------------------------------------------------------
# the allowlist is the whole safety story
# --------------------------------------------------------------------------


@pytest.mark.parametrize("table", sorted(LOCAL_ONLY_TABLES))
def test_gate_shaping_tables_are_never_remotely_editable(repo, table):
    """[actions] decides WHICH checks run and [hook] decides whether the
    gate fires at all — a stolen web session must not reach either."""
    before = (repo / ".proofjury.toml").read_text(encoding="utf-8")
    result = apply_patch(repo, {"table": table, "set": {"anything": "x"}})
    assert result.applied is False
    assert (repo / ".proofjury.toml").read_text(encoding="utf-8") == before


def test_unknown_table_is_rejected(repo):
    assert apply_patch(repo, {"table": "nope", "set": {"a": 1}}).applied is False


def test_editable_and_local_only_never_overlap():
    assert EDITABLE_TABLES.isdisjoint(LOCAL_ONLY_TABLES)


# --------------------------------------------------------------------------
# comment preservation
# --------------------------------------------------------------------------


def test_every_comment_survives_a_patch(repo):
    before = (repo / ".proofjury.toml").read_text(encoding="utf-8")
    comments_before = [l for l in before.splitlines() if l.strip().startswith("#")]

    assert apply_patch(
        repo, {"table": "advisory", "set": {"auto_inject_min_confidence": 0.8}}
    ).applied

    after = (repo / ".proofjury.toml").read_text(encoding="utf-8")
    comments_after = [l for l in after.splitlines() if l.strip().startswith("#")]
    # The templated default may be uncommented by the edit itself, so allow
    # that one line to move from comment to setting — nothing else may go.
    assert len(comments_before) - len(comments_after) <= 1
    assert _toml(repo)["advisory"]["auto_inject_min_confidence"] == 0.8


def test_creates_a_table_that_the_template_omits(repo):
    """[semantic] and [conventions] are read by config.py but absent from
    PROOFJURY_TOML_TEMPLATE, so the create-section path is real."""
    assert "[semantic]" not in PROOFJURY_TOML_TEMPLATE
    assert apply_patch(repo, {"table": "semantic", "set": {"top_k": 12}}).applied
    assert _toml(repo)["semantic"]["top_k"] == 12


def test_new_table_is_inserted_before_hook(repo):
    """proofjury init appends detected deploy patterns to the end of
    [hook], so [hook] must remain the last section."""
    apply_patch(repo, {"table": "semantic", "set": {"top_k": 3}})
    text = (repo / ".proofjury.toml").read_text(encoding="utf-8")
    # Compare against the real section HEADER: the template also mentions
    # "[hook]" inside a comment above it, which appears earlier in the file.
    assert text.index("\n[semantic]") < text.index("\n[hook]")


def test_unset_removes_a_key(repo):
    apply_patch(repo, {"table": "semantic", "set": {"top_k": 9, "enabled": True}})
    assert apply_patch(repo, {"table": "semantic", "unset": ["top_k"]}).applied
    assert "top_k" not in _toml(repo)["semantic"]


# --------------------------------------------------------------------------
# clamping mirrors config.py's readers
# --------------------------------------------------------------------------


def test_confidence_is_clamped(repo):
    apply_patch(repo, {"table": "advisory", "set": {"hold_min_confidence": 4.2}})
    assert _toml(repo)["advisory"]["hold_min_confidence"] == 1.0


def test_tiers_filtered_and_empty_refused(repo):
    apply_patch(repo, {"table": "advisory", "set": {"tiers": [4, 5, 9]}})
    assert _toml(repo)["advisory"]["tiers"] == [4, 5]

    # tiers = [] silently mutes the entire advisory surface — refuse it.
    apply_patch(repo, {"table": "advisory", "set": {"tiers": ["nonsense"]}})
    assert _toml(repo)["advisory"]["tiers"] == [4, 5]


# --------------------------------------------------------------------------
# concurrency + corruption
# --------------------------------------------------------------------------


def test_stale_base_hash_refuses_rather_than_clobbering(repo):
    stale = file_hash(repo)
    (repo / ".proofjury.toml").write_text(
        PROOFJURY_TOML_TEMPLATE + "\n# a local edit\n", encoding="utf-8"
    )
    result = apply_patch(
        repo,
        {"table": "advisory", "set": {"max_findings": 2}, "base_hash": stale},
    )
    assert result.applied is False
    assert "base_hash" in result.reason
    assert "# a local edit" in (repo / ".proofjury.toml").read_text(encoding="utf-8")


def test_matching_base_hash_applies(repo):
    result = apply_patch(
        repo,
        {
            "table": "advisory",
            "set": {"max_findings": 2},
            "base_hash": file_hash(repo),
        },
    )
    assert result.applied is True
    assert result.new_hash == file_hash(repo)


def test_missing_file_is_not_an_error(tmp_path):
    assert apply_patch(tmp_path, {"table": "advisory", "set": {"a": 1}}).applied is False


def test_patch_that_would_corrupt_the_file_is_not_written(repo):
    """A corrupt .proofjury.toml makes load_config return {}, silently
    resetting every knob to its default — never ship an unparseable edit."""
    before = (repo / ".proofjury.toml").read_text(encoding="utf-8")
    # A raw multi-line string value would break the line-oriented format.
    result = apply_patch(
        repo, {"table": "advisory", "set": {"model": 'a"\nb = [unclosed'}}
    )
    after = (repo / ".proofjury.toml").read_text(encoding="utf-8")
    if not result.applied:
        assert after == before
    else:
        tomllib.loads(after)  # whatever landed must still parse
