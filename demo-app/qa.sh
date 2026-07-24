#!/usr/bin/env bash
# STAND-IN for an agentic browser-QA runner (Replay).
#
# This demo storefront has no web surface, so there is nothing for a real
# browser to record. This script stands in for `replayio`/`@replayio/playwright`
# the same way compileall stands in for the build and deploy.sh stands in for
# the deploy: the marker mechanism records an exit code and a worktree digest,
# and does not care what produced them.
#
# What it does keep faithful is the SHAPE of the signal:
#   - it fails on defects a browser QA agent would actually catch (a debug
#     banner rendered to users; API calls pointed at localhost, which is
#     unreachable from a real user's browser),
#   - it prints a bug tally and a recording permalink in the format
#     checks/browser_qa.py::parse_replay_summary scrapes.
#
# The recording URL below is a PLACEHOLDER id, not a real Replay recording.
# Swapping this script for a real Replay run requires no proofjury change —
# only the [commands] qa value in .proofjury.toml.
#
# Writes no files, so the worktree digest stays stable across runs.
set -uo pipefail

RECORDING_ID="demo-standin-0000"

echo "▶ browser QA (stand-in) — storefront smoke suite"
echo "  ✓ app boots"

bugs=0

if python3 -c "import config; raise SystemExit(0 if config.DEBUG else 1)"; then
  echo "  ✗ checkout page renders the debug banner to end users (config.py: DEBUG)"
  bugs=$((bugs + 1))
else
  echo "  ✓ no debug banner rendered"
fi

if python3 -c "import config; raise SystemExit(0 if 'localhost' in config.API_BASE_URL or '127.0.0.1' in config.API_BASE_URL else 1)"; then
  echo "  ✗ XHR to \$API_BASE_URL is unreachable from a user's browser (config.py: API_BASE_URL)"
  bugs=$((bugs + 1))
else
  echo "  ✓ API base URL is reachable"
fi

echo "recording: https://app.replay.io/recording/${RECORDING_ID}"

if [ "$bugs" -gt 0 ]; then
  noun="bugs"
  [ "$bugs" -eq 1 ] && noun="bug"
  echo "Found ${bugs} ${noun}"
  exit 1
fi

echo "0 bugs — suite green"
