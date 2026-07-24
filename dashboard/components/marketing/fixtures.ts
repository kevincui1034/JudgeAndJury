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
  { kind: "fail", text: "missing_env_var", note: "STRIPE_SECRET_KEY absent in prod" },
  { kind: "gap", text: "" },
  {
    kind: "judge",
    text: "judge · tier 5 · confidence 0.91",
    note: "STRIPE_SECRET_KEY is read at payments.py:14 but never set in the prod env. The first checkout request will crash.",
  },
  {
    kind: "recall",
    text: "recalled chk_001 — matched by meaning, not wording (6 days ago)",
  },
  {
    kind: "pref",
    text: "applied learned preference · graduated from 3 corrections",
    note: "add new env vars to .env.example in the same commit",
  },
] as const;

/** The four stages of how the judge gets better. */
export const HOW_IT_LEARNS = [
  {
    step: "01",
    title: "It judges",
    lane: "finding",
    body: "Every run your agent makes, and every moment it claims done, gets reviewed. Findings carry a tier, a confidence, and the evidence behind them — never a bare opinion.",
  },
  {
    step: "02",
    title: "You label it",
    lane: "signal",
    body: "Confirm or reject, one click. That label is the entire training signal; there is no annotation queue and no separate labelling job to run.",
  },
  {
    step: "03",
    title: "It adapts",
    lane: "ranking + preferences",
    body: "Classes you keep rejecting get demoted in recall, so noisy advice fades. Corrections that repeat in one category graduate into a preference injected before the agent writes code.",
  },
  {
    step: "04",
    title: "It retrains",
    lane: "tuned model",
    body: "Labelled findings become a corpus paired with the prompts that produced them. One command returns a tuned judge, and adopting it is a single line of config — not a migration.",
  },
] as const;

/** Where the training signal actually comes from. */
export const SIGNAL_SOURCES = [
  {
    title: "Every finding you label",
    body: "Confirmed and rejected advisories become paired training rows. Rejections matter as much as confirmations — they are what teach it to stop.",
    metric: "labelled advisories",
  },
  {
    title: "Every correction you type",
    body: "When your agent says done and your next message pushes back, that is a labelled outcome. Three in one category graduate into a durable preference.",
    metric: "labelled checkpoints",
  },
  {
    title: "Every verdict it explains",
    body: "Each blocked run is stored with its checks, its diff and its diagnosis, so a recurrence months later is recognisable rather than novel.",
    metric: "resolved records",
  },
] as const;

/**
 * Sponsor copy now lives in lib/sponsors.ts so the dashboard and the landing
 * page cannot drift on the one thing that must never be misstated: which
 * integration is allowed to fail a gate. Import SPONSOR_LIST from there.
 */

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
