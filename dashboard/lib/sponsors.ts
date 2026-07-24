/**
 * The sponsor registry — one source of truth for how each integration is
 * named, described, and (critically) what authority it has.
 *
 * THE GROUND RULE, and it is not negotiable in any copy that references these:
 * sponsor surfaces are evidence, context, or transport. They never produce a
 * verdict. There is exactly ONE exception — Replay's `browser_qa` is a
 * deterministic check that CAN fail the gate, and it does so from a recorded
 * exit code and a worktree digest, never from model output.
 *
 * `decides` encodes that distinction. Any badge, chip, or sentence rendered
 * about a sponsor must read from here rather than restating it by hand.
 */

export type SponsorId = "replay" | "senso" | "pioneer" | "actian";

export interface Sponsor {
  id: SponsorId;
  name: string;
  /** What it does, in the product's own vocabulary. */
  role: string;
  /** One honest sentence about its authority. */
  authority: string;
  /** Longer marketing-side note. */
  note: string;
  /** True only for Replay's browser_qa check. */
  decides: boolean;
  /** Semantic tone from the design system — color is a verdict, never decoration. */
  tone: "red" | "amber" | "violet" | "teal";
  /** Where the dashboard shows its output. */
  surface: string;
  /**
   * The capability key reported by the CLI in repo_configs.capabilities.
   * These MUST match `_capabilities()` in cli/src/proofjury/sync.py verbatim —
   * a key that does not match renders as "not configured" on every repo,
   * including live ones, with no error anywhere.
   */
  capabilityKey: "browser_qa" | "conventions" | "judge_provider" | "semantic";
  /** Env var the CLI needs for this to be configured at all. */
  envKey: string;
}

export const SPONSORS: Record<SponsorId, Sponsor> = {
  replay: {
    id: "replay",
    name: "Replay",
    role: "browser QA",
    authority: "Can fail the gate",
    note:
      "The one sponsor-backed check that can fail the gate — and it does so from a recorded exit code and a worktree digest, never from model output.",
    decides: true,
    tone: "red",
    surface: "browser_qa check · trace evidence · recordings",
    capabilityKey: "browser_qa",
    envKey: "REPLAY_API_KEY",
  },
  senso: {
    id: "senso",
    name: "Senso",
    role: "team conventions",
    authority: "Context only",
    note:
      "Authored policy the judge may cite. Cited statements carry a [source: doc] tag into the finding, so advice is traceable to a document a human wrote.",
    decides: false,
    tone: "amber",
    surface: "conventions cited in findings",
    capabilityKey: "conventions",
    envKey: "SENSO_API_KEY",
  },
  pioneer: {
    id: "pioneer",
    name: "Pioneer",
    role: "judge routing",
    authority: "Explanation only",
    note:
      "Routes each judge surface to a model and reports which one actually answered. It shapes how a verdict is explained, never what the verdict is.",
    decides: false,
    tone: "teal",
    surface: "model routing · cost by model",
    capabilityKey: "judge_provider",
    envKey: "PIONEER_API_KEY",
  },
  actian: {
    id: "actian",
    name: "Actian",
    role: "semantic recall",
    authority: "Context only",
    note:
      "Finds the prior that matches a recurrence even when the wording is different. Priors are context the judge may cite — they can never short-circuit a verdict.",
    decides: false,
    tone: "violet",
    surface: "recall provenance · memory",
    capabilityKey: "semantic",
    envKey: "ACTIAN_VECTOR_URL",
  },
};

/** Stable display order: the one that can decide first, then context surfaces. */
export const SPONSOR_ORDER: SponsorId[] = [
  "replay",
  "actian",
  "senso",
  "pioneer",
];

export const SPONSOR_LIST: Sponsor[] = SPONSOR_ORDER.map((id) => SPONSORS[id]);
