/**
 * The gate-config surface a dashboard may edit.
 *
 * MUST stay in lockstep with cli/src/proofjury/configfile.py — the CLI is
 * the enforcement point (it writes the file), this is the UI's mirror.
 * tests/config.test.ts pins that the two lists match.
 *
 * The split is not arbitrary: every EDITABLE table governs a surface that
 * is already incapable of blocking a deploy. The local-only set is exactly
 * the set that decides whether or how the gate runs at all.
 */

export const EDITABLE_TABLES = new Set([
  "advisory",
  "impact",
  "memory",
  "semantic",
  "conventions",
  "checkpoint",
  "prefs",
]);

export const LOCAL_ONLY_TABLES = new Set([
  "commands",
  "env",
  "actions",
  "hook",
  "session",
  "checks",
]);

export type FieldKind = "bool" | "number" | "float01" | "text" | "tiers" | "mode";

export interface ConfigField {
  key: string;
  label: string;
  kind: FieldKind;
  hint: string;
  default: unknown;
  min?: number;
  max?: number;
  options?: string[];
}

export interface ConfigTable {
  table: string;
  title: string;
  blurb: string;
  fields: ConfigField[];
}

/** Mirrors the *_DEFAULTS dicts in cli/src/proofjury/config.py. */
export const CONFIG_TABLES: ConfigTable[] = [
  {
    table: "advisory",
    title: "Advisory judge",
    blurb:
      "Model judgment on the diff. Findings are recorded and conditionally surfaced to the agent — they never block.",
    fields: [
      { key: "enabled", label: "Enabled", kind: "bool", default: true, hint: "Runs only when an LLM key is configured." },
      { key: "auto_inject_min_confidence", label: "Auto-inject at", kind: "float01", default: 0.7, hint: "At or above this confidence the finding goes straight to the agent." },
      { key: "hold_min_confidence", label: "Hold at", kind: "float01", default: 0.4, hint: "At or above this it waits for you; below it is recorded only." },
      { key: "max_findings", label: "Max findings", kind: "number", default: 5, min: 0, hint: "Per gate run." },
      { key: "diff_min_lines", label: "Min diff lines", kind: "number", default: 1, min: 0, hint: "Smaller diffs skip the judge entirely." },
      { key: "tiers", label: "Tiers", kind: "tiers", default: [4, 5], hint: "4 = bad engineering, 5 = not what was asked." },
      { key: "model", label: "Model override", kind: "text", default: null, hint: "Blank uses the resolved judge model. Set a tuned job id here after a fine-tune." },
    ],
  },
  {
    table: "checkpoint",
    title: "Checkpoints",
    blurb:
      "Records what the agent did when it claims done, and reviews it against the stated task.",
    fields: [
      { key: "enabled", label: "Enabled", kind: "bool", default: true, hint: "" },
      { key: "mode", label: "Mode", kind: "mode", default: "advise", options: ["passive", "advise", "active"], hint: "passive records only; advise reviews in the background; active can send the agent back once per turn." },
      { key: "min_diff_lines", label: "Min diff lines", kind: "number", default: 1, min: 0, hint: "" },
      { key: "max_per_hour", label: "Max per hour", kind: "number", default: 12, min: 0, hint: "Rate cap on recorded checkpoints." },
      { key: "auto_inject_min_confidence", label: "Auto-inject at", kind: "float01", default: 0.7, hint: "" },
      { key: "active_min_confidence", label: "Active-mode bar", kind: "float01", default: 0.85, hint: "Only a tier-5 finding at or above this can send the agent back." },
      { key: "model", label: "Model override", kind: "text", default: null, hint: "Never inherits the advisory model — checkpoint volume would multiply cost." },
    ],
  },
  {
    table: "semantic",
    title: "Semantic recall",
    blurb: "Recall priors by meaning, not just by failure class and shared tokens.",
    fields: [
      { key: "enabled", label: "Enabled", kind: "bool", default: true, hint: "Also needs the Actian client installed and an embedding-capable key." },
      { key: "top_k", label: "Candidates", kind: "number", default: 5, min: 1, hint: "" },
      { key: "embed_model", label: "Embedding model", kind: "text", default: null, hint: "" },
    ],
  },
  {
    table: "conventions",
    title: "Team conventions",
    blurb:
      "Authored policy fetched from a Senso KB and cited in advisory findings.",
    fields: [
      { key: "enabled", label: "Enabled", kind: "bool", default: false, hint: "Off by default — the only context surface that leaves your machine." },
      { key: "senso_kb", label: "Knowledge base", kind: "text", default: null, hint: "Blank falls back to SENSO_KB_ID." },
      { key: "max_results", label: "Max statements", kind: "number", default: 5, min: 1, hint: "" },
    ],
  },
  {
    table: "impact",
    title: "Blast radius",
    blurb: "Deterministic reverse-import graph. Context for the judge, never a verdict.",
    fields: [
      { key: "enabled", label: "Enabled", kind: "bool", default: true, hint: "" },
      { key: "depth", label: "Depth", kind: "number", default: 2, min: 1, hint: "" },
      { key: "max_files", label: "Max dependents", kind: "number", default: 50, min: 1, hint: "" },
    ],
  },
  {
    table: "memory",
    title: "Cross-repo memory",
    blurb: "Read other local repos' already-scrubbed stores for priors.",
    fields: [
      { key: "cross_repo", label: "Cross-repo recall", kind: "bool", default: true, hint: "Foreign priors are context only and always rank below local ones." },
    ],
  },
  {
    table: "prefs",
    title: "Learned preferences",
    blurb: "Repeated corrections graduate into preferences you approve.",
    fields: [
      { key: "enabled", label: "Enabled", kind: "bool", default: true, hint: "" },
      { key: "inject_at_session_start", label: "Inject at session start", kind: "bool", default: true, hint: "" },
      { key: "graduation_min_corrections", label: "Corrections to graduate", kind: "number", default: 3, min: 1, hint: "" },
    ],
  },
];
