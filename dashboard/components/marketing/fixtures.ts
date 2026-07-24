/**
 * Static content for the marketing surfaces.
 *
 * The dashboard preview is built from these rather than from a screenshot so
 * it can never drift from the real primitives, stays sharp at any DPI, and
 * renders in BOTH worlds — a PNG would be locked to one theme, which is fatal
 * with a day/night toggle above the fold.
 */

/** Illustrative only — the real list lives in cli/TAXONOMY.md. */
export const FAILURE_CLASSES = [
  { name: "missing_env_var", blurb: "referenced in code, absent in the target env" },
  { name: "test_failure", blurb: "the suite ran and something failed" },
  { name: "build_failure", blurb: "the artifact never built" },
  { name: "hardcoded_secret", blurb: "a live credential in tracked source" },
  { name: "tests_not_run", blurb: "shipped without running the suite at all" },
  { name: "config_mismatch", blurb: "dev config pointed at production" },
  { name: "preprod_check_skipped", blurb: "a required pre-deploy step never ran" },
  { name: "pending_migration", blurb: "schema change not applied to the target" },
  { name: "lockfile_drift", blurb: "manifest and lockfile disagree" },
  { name: "unfinished_work", blurb: "a stub presented as done" },
  { name: "browser_qa_failed", blurb: "the recorded QA run exited non-zero" },
  { name: "browser_qa_not_run", blurb: "QA configured, never executed" },
] as const;

export const TERMINAL_LINES = [
  { kind: "cmd", text: "proofjury guard deploy -- ./deploy.sh" },
  { kind: "ok", text: "lockfile in sync" },
  { kind: "ok", text: "migrations applied" },
  { kind: "fail", text: "missing_env_var", note: "STRIPE_SECRET_KEY absent in prod" },
  { kind: "fail", text: "tests_not_run", note: "last run was 4 commits ago" },
  { kind: "gap", text: "" },
  { kind: "verdict", text: "BLOCKED — the deploy command never ran" },
  { kind: "recall", text: "recalled chk_001 — same class, 6 days ago" },
] as const;

export const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Intercept",
    lane: "Gate run",
    body: "The gate wraps the deploy command itself, so there is no path around it. Nothing runs until the checks return.",
  },
  {
    step: "02",
    title: "Decide",
    lane: "Checks — DECIDES",
    body: "Deterministic checks alone produce the verdict. The judge writes the explanation afterwards and can never change the outcome.",
  },
  {
    step: "03",
    title: "Remember",
    lane: "Memory — context only",
    body: "Every block becomes a prior. When the same failure recurs — even worded differently — the gate cites the record that explains it.",
  },
] as const;

/** Sponsor surfaces. Only browser QA can fail the gate; see judge/page.tsx. */
export const SPONSORS = [
  {
    name: "Replay",
    role: "browser QA",
    note: "The one sponsor-backed check that can fail the gate — from a recorded exit code and a worktree digest, never model output.",
    decides: true,
  },
  {
    name: "Senso",
    role: "team conventions",
    note: "Authored policy the judge may cite, carried into findings with a [source: doc] tag.",
    decides: false,
  },
  {
    name: "Pioneer",
    role: "judge routing",
    note: "Which model answered each judge surface. Explanation only.",
    decides: false,
  },
  {
    name: "Actian",
    role: "semantic recall",
    note: "Finds the prior that matches a recurrence even when the wording differs.",
    decides: false,
  },
] as const;

/** Numbers shown in the preview chrome. Illustrative, not live. */
export const PREVIEW = {
  runs: 148,
  passed: 121,
  blocked: 27,
  blockRate: 0.18,
  recallHit: 0.62,
  autoResolved: 0.74,
  p95Ms: 940,
  runsSpark: [4, 6, 5, 9, 7, 12, 10, 14, 11, 16, 13, 18],
  blockedSpark: [1, 2, 1, 3, 2, 4, 2, 5, 3, 4, 2, 3],
  classes: [
    { name: "missing_env_var", count: 9 },
    { name: "tests_not_run", count: 7 },
    { name: "config_mismatch", count: 5 },
    { name: "lockfile_drift", count: 3 },
  ],
  traces: [
    { id: "chk_148", passed: false, action: "deploy", classes: ["missing_env_var"], recalled: "chk_112" },
    { id: "chk_147", passed: true, action: "deploy", classes: [] as string[], recalled: null },
    { id: "chk_146", passed: false, action: "release", classes: ["tests_not_run", "lockfile_drift"], recalled: null },
  ],
} as const;
