/**
 * Deterministic lane layout for the agent↔judge trace canvas.
 *
 * This is NOT a general graph — it is a fixed pipeline, and node count is
 * bounded by CLI constants (<=5 advisories via ADVISORY_DEFAULTS.max_findings,
 * ~10 checks, ~5 priors). So lanes are assigned by MEANING, not by a force
 * simulation: a force layout re-arranges on every mount, which is unstable
 * on stage and makes every screenshot different.
 *
 * The return shape is intentionally React-Flow's ({nodes:[{id,x,y,...}],
 * edges:[{from,to,...}]}) so `@xyflow/react` can drop in behind this
 * function later without touching any caller.
 */

export type LaneId =
  | "agent"
  | "gate"
  | "checks"
  | "memory"
  | "judge"
  | "advisory"
  | "delivery"
  | "human";

export type NodeKind =
  | "agentTurn"
  | "command"
  | "gateRun"
  | "check"
  | "prior"
  | "conventions"
  | "judge"
  | "advisory"
  | "delivery"
  | "label"
  | "record";

/** Port colour encodes CHANNEL, matching the design-system rule. */
export type PortTone =
  | "agent"
  | "decides"
  | "context"
  | "memory"
  | "pass"
  | "block"
  | "inert";

export type EdgeKind = "causal" | "context" | "suppressed" | "feedback";

export interface TraceNode {
  id: string;
  lane: LaneId;
  kind: NodeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  subtitle?: string;
  tone: PortTone;
  /** Arbitrary payload the renderer reads for detail/drawer content. */
  data?: Record<string, unknown>;
}

export interface TraceEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string;
}

export interface TraceGraph {
  nodes: TraceNode[];
  edges: TraceEdge[];
  width: number;
  height: number;
  lanes: { id: LaneId; label: string; x: number; note?: string }[];
}

export const LANE_ORDER: { id: LaneId; label: string; note?: string }[] = [
  { id: "agent", label: "Agent", note: "your coding agent" },
  { id: "gate", label: "Gate run" },
  { id: "checks", label: "Checks", note: "DECIDES" },
  { id: "memory", label: "Memory", note: "context only" },
  { id: "judge", label: "Judge", note: "explains only" },
  { id: "advisory", label: "Advisory", note: "never blocks" },
  { id: "delivery", label: "Delivered to agent" },
  { id: "human", label: "You" },
];

const COL_W = 186;
const COL_GAP = 30;
export const NODE_W = 186;
const NODE_H = 60;
const ROW_GAP = 12;
const PAD_X = 20;
/** Headroom for the lane header strip AND the feedback edge that arcs
 *  back over the top of the canvas. */
const PAD_Y = 88;

export function laneX(index: number): number {
  return PAD_X + index * (COL_W + COL_GAP);
}

export interface TraceInput {
  recordId: string;
  createdAt: string;
  action: string;
  agentSource: string;
  taskRef: string | null;
  gatePassed: boolean;
  gateDurationMs: number;
  judgeModelId: string | null;
  diagnosis: string;
  recalledFrom: string | null;
  resolves: string | null;
  resolutionStatus: string | null;
  resolutionOutcome: string | null;
  checks: {
    name: string;
    passed: boolean;
    failure_class?: string | null;
    evidence?: string;
  }[];
  advisories: {
    idx: number;
    concern: string;
    kind: string;
    tier: number;
    confidence: number;
    target: string | null;
    delivery: string | null;
    label: string | null;
    retraction: string | null;
    groundedIn?: string[];
  }[];
  /** Convention statements parsed out of the stored advisory_input. */
  conventions: { statement: string; source: string | null }[];
  resolvedBy: string | null;
}

export function buildTraceGraph(input: TraceInput): TraceGraph {
  const nodes: TraceNode[] = [];
  const edges: TraceEdge[] = [];
  const rowCursor = new Map<LaneId, number>();

  // x is assigned in a final pass: lanes with no nodes are dropped so an
  // empty Memory lane (a run with no recalled prior) does not leave a
  // dead column pushing everything else off-screen.
  function add(
    node: Omit<TraceNode, "x" | "y" | "w" | "h">,
    opts: { tall?: boolean } = {},
  ): TraceNode {
    const row = rowCursor.get(node.lane) ?? 0;
    const h = opts.tall ? NODE_H + 24 : NODE_H;
    const placed: TraceNode = {
      ...node,
      x: 0,
      y: PAD_Y + row,
      w: NODE_W,
      h,
    };
    rowCursor.set(node.lane, row + h + ROW_GAP);
    nodes.push(placed);
    return placed;
  }

  function link(from: string, to: string, kind: EdgeKind, label?: string) {
    edges.push({ id: `${from}->${to}`, from, to, kind, label });
  }

  // ── 1. agent ──────────────────────────────────────────────────────────
  const turn = add({
    id: "agent",
    lane: "agent",
    kind: "agentTurn",
    tone: "agent",
    title: input.agentSource,
    subtitle: input.taskRef ?? "no stated task",
    data: { taskRef: input.taskRef },
  }, { tall: true });

  const command = add({
    id: "command",
    lane: "agent",
    kind: "command",
    tone: "agent",
    title: `${input.action}`,
    subtitle: "intercepted at the tool boundary",
  });
  link(turn.id, command.id, "causal");

  // ── 2. gate run ───────────────────────────────────────────────────────
  const gate = add({
    id: "gate",
    lane: "gate",
    kind: "gateRun",
    tone: input.gatePassed ? "pass" : "block",
    title: input.recordId,
    subtitle: `${input.gatePassed ? "passed" : "blocked"} · ${input.gateDurationMs}ms`,
    data: { createdAt: input.createdAt },
  });
  link(command.id, gate.id, "causal");

  // ── 3. checks — the ONLY lane that decides ────────────────────────────
  const failed = input.checks.filter((c) => !c.passed);
  const shown = failed.length > 0 ? failed : input.checks.slice(0, 4);
  for (const check of shown) {
    const node = add({
      id: `check:${check.name}`,
      lane: "checks",
      kind: "check",
      tone: check.passed ? "pass" : "decides",
      title: check.name,
      subtitle: check.passed
        ? "passed"
        : (check.failure_class ?? "failed"),
      data: { evidence: check.evidence, failureClass: check.failure_class },
    }, { tall: !check.passed });
    link(gate.id, node.id, "causal");
  }
  if (failed.length === 0 && input.checks.length > shown.length) {
    const more = add({
      id: "check:more",
      lane: "checks",
      kind: "check",
      tone: "pass",
      title: `+${input.checks.length - shown.length} more`,
      subtitle: "all passed",
    });
    link(gate.id, more.id, "causal");
  }

  // ── 4. memory — priors are context, never authority ───────────────────
  if (input.recalledFrom) {
    const foreign = input.recalledFrom.includes(":");
    const prior = add({
      id: "prior",
      lane: "memory",
      kind: "prior",
      tone: "memory",
      title: input.recalledFrom,
      subtitle: foreign ? "cross-repo prior" : "prior in this repo",
      data: { foreign },
    });
    link(gate.id, prior.id, "context", "recalled");
    link(prior.id, "judge", "context");
  }

  // ── 5. judge — explains, never decides ────────────────────────────────
  if (input.conventions.length > 0) {
    const conv = add({
      id: "conventions",
      lane: "memory",
      kind: "conventions",
      tone: "context",
      title: `${input.conventions.length} team convention${input.conventions.length === 1 ? "" : "s"}`,
      subtitle: input.conventions[0]?.source ?? "authored policy",
      data: { conventions: input.conventions },
    });
    link(conv.id, "judge", "context", "cited");
  }

  const judge = add({
    id: "judge",
    lane: "judge",
    kind: "judge",
    tone: "context",
    title: input.judgeModelId ?? "deterministic",
    subtitle: input.diagnosis.slice(0, 90),
    data: { diagnosis: input.diagnosis },
  }, { tall: true });
  link(gate.id, judge.id, "causal");

  // ── 6. advisory findings ──────────────────────────────────────────────
  for (const a of input.advisories) {
    const suppressed =
      a.delivery === "suppressed" || a.label === "rejected";
    const node = add({
      id: `adv:${a.idx}`,
      lane: "advisory",
      kind: "advisory",
      tone: suppressed ? "inert" : "context",
      title: `tier ${a.tier} · ${a.confidence.toFixed(2)}`,
      subtitle: a.concern.slice(0, 90),
      data: a,
    }, { tall: true });
    link(judge.id, node.id, suppressed ? "suppressed" : "context");
  }

  // ── 7. delivery back to the agent ─────────────────────────────────────
  const delivered = input.advisories.filter(
    (a) => a.delivery === "injected" || a.delivery === "sent",
  );
  const deliveryNode = add({
    id: "delivery",
    lane: "delivery",
    kind: "delivery",
    tone: input.gatePassed ? "context" : "block",
    title: input.gatePassed
      ? delivered.length > 0
        ? "additionalContext"
        : "no decision"
      : "permissionDecision: deny",
    subtitle: input.gatePassed
      ? delivered.length > 0
        ? `${delivered.length} advisory note${delivered.length === 1 ? "" : "s"} — context only`
        : "gate passed, nothing to say"
      : "checks + diagnosis + fix steps",
    data: { delivered: delivered.length },
  }, { tall: true });
  if (!input.gatePassed) link(gate.id, deliveryNode.id, "causal");
  for (const a of delivered) link(`adv:${a.idx}`, deliveryNode.id, "context");

  // The loop-closing edge — this is literally "how the judge interacts
  // with the coding agent", so it gets its own edge kind and is drawn
  // curving back over the top of the canvas.
  link(deliveryNode.id, turn.id, "feedback", "back to the agent");

  // ── 8. human ──────────────────────────────────────────────────────────
  const label = add({
    id: "label",
    lane: "human",
    kind: "label",
    tone: input.resolutionStatus ? "pass" : "inert",
    title: input.resolutionStatus ?? "unlabeled",
    subtitle: input.resolutionOutcome
      ? `outcome: ${input.resolutionOutcome}`
      : "was the block right?",
    data: { status: input.resolutionStatus },
  });
  link(deliveryNode.id, label.id, "causal");

  const memoryWrite = add({
    id: "record",
    lane: "human",
    kind: "record",
    tone: "memory",
    title: "memory.jsonl",
    subtitle: input.resolvedBy
      ? `later resolved by ${input.resolvedBy}`
      : "becomes a prior for future runs",
  });
  link(label.id, memoryWrite.id, "context");

  // ── final pass: compact away empty lanes, then assign x ───────────────
  const used = LANE_ORDER.filter((l) => nodes.some((n) => n.lane === l.id));
  const xOf = new Map<LaneId, number>(
    used.map((l, i) => [l.id, laneX(i)]),
  );
  for (const node of nodes) node.x = xOf.get(node.lane) ?? PAD_X;

  const width = laneX(Math.max(used.length - 1, 0)) + NODE_W + PAD_X;
  const height =
    Math.max(...Array.from(rowCursor.values()), 200) + PAD_Y + 12;

  return {
    nodes,
    edges,
    width,
    height,
    lanes: used.map((l) => ({ ...l, x: xOf.get(l.id) ?? PAD_X })),
  };
}
