"use client";

/**
 * The agent↔judge trace canvas.
 *
 * SVG edge layer underneath, absolutely-positioned HTML cards on top.
 * Cards are HTML rather than SVG <foreignObject> so they get real focus
 * order, real hover, and real buttons; the edges are SVG because that is
 * the only sane way to draw curves.
 *
 * Hover any node to isolate its causal path — the same hover-dim idea the
 * original ImpactGraph used, which is the fastest way to answer "what
 * caused this?" without reading the whole canvas.
 */
import { useMemo, useState } from "react";

import { cx } from "@/components/ui/primitives";
import {
  NODE_W,
  type EdgeKind,
  type PortTone,
  type TraceGraph,
  type TraceNode,
} from "@/components/trace/traceLayout";

const TONE_BORDER: Record<PortTone, string> = {
  agent: "rgb(45 212 191 / 0.45)",
  decides: "rgb(242 113 106 / 0.55)",
  context: "rgb(245 184 61 / 0.4)",
  memory: "rgb(167 139 250 / 0.45)",
  pass: "rgb(74 222 128 / 0.4)",
  block: "rgb(242 113 106 / 0.55)",
  inert: "rgb(255 255 255 / 0.08)",
};

const TONE_DOT: Record<PortTone, string> = {
  agent: "var(--bot-teal)",
  decides: "var(--verdict-red)",
  context: "var(--amber)",
  memory: "var(--bot-violet)",
  pass: "var(--verdict-green)",
  block: "var(--verdict-red)",
  inert: "var(--faint)",
};

const EDGE_STROKE: Record<EdgeKind, string> = {
  causal: "var(--line-2)",
  context: "var(--amber)",
  suppressed: "var(--faint)",
  feedback: "var(--bot-teal)",
};

const EDGE_DASH: Record<EdgeKind, string | undefined> = {
  causal: undefined,
  context: "5 4",
  suppressed: "2 5",
  feedback: "7 5",
};

export function TraceCanvas({
  graph,
  onSelect,
  selectedId,
}: {
  graph: TraceGraph;
  onSelect?: (node: TraceNode) => void;
  selectedId?: string | null;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const byId = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n])),
    [graph.nodes],
  );

  /** Nodes on the hovered node's immediate causal path. */
  const related = useMemo(() => {
    if (!hovered) return null;
    const set = new Set<string>([hovered]);
    for (const e of graph.edges) {
      if (e.from === hovered) set.add(e.to);
      if (e.to === hovered) set.add(e.from);
    }
    return set;
  }, [hovered, graph.edges]);

  const dim = (id: string) => related !== null && !related.has(id);

  return (
    <div className="dot-grid overflow-x-auto rounded-2xl">
      <div
        className="relative"
        style={{ width: graph.width, height: graph.height }}
      >
        {/* lane headers */}
        {graph.lanes.map((lane) => (
          <div
            key={lane.id}
            className="absolute top-3"
            style={{ left: lane.x, width: NODE_W }}
          >
            <p className="text-[10px] tracking-[0.14em] text-faint uppercase">
              {lane.label}
            </p>
            {lane.note && (
              <p
                className={cx(
                  "mt-0.5 text-[10px]",
                  lane.note === "DECIDES"
                    ? "font-medium tracking-wide text-verdict-red"
                    : "text-faint/70",
                )}
              >
                {lane.note}
              </p>
            )}
          </div>
        ))}

        {/* edges */}
        <svg
          className="pointer-events-none absolute inset-0"
          width={graph.width}
          height={graph.height}
          aria-hidden
        >
          {graph.edges.map((edge) => {
            const from = byId.get(edge.from);
            const to = byId.get(edge.to);
            if (!from || !to) return null;
            const active =
              hovered === edge.from || hovered === edge.to || !hovered;
            const stroke = EDGE_STROKE[edge.kind];

            let d: string;
            if (edge.kind === "feedback") {
              // Loop back over the top — the judge answering the agent.
              // Peaks at y=16 so it stays inside the canvas headroom
              // (traceLayout reserves PAD_Y for exactly this).
              const x1 = from.x + from.w / 2;
              const x2 = to.x + to.w / 2;
              const y1 = from.y;
              const y2 = to.y;
              d = `M ${x1} ${y1} C ${x1} 16, ${x2} 16, ${x2} ${y2}`;
            } else {
              const x1 = from.x + from.w;
              const y1 = from.y + from.h / 2;
              const x2 = to.x;
              const y2 = to.y + to.h / 2;
              const mx = (x1 + x2) / 2;
              d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
            }

            return (
              <path
                key={edge.id}
                d={d}
                fill="none"
                stroke={stroke}
                strokeWidth={hovered && active ? 1.9 : 1.3}
                strokeDasharray={EDGE_DASH[edge.kind]}
                opacity={active ? (edge.kind === "suppressed" ? 0.4 : 0.75) : 0.12}
              />
            );
          })}
        </svg>

        {/* nodes */}
        {graph.nodes.map((node) => {
          const selected = selectedId === node.id;
          return (
            <button
              key={node.id}
              type="button"
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(node.id)}
              onBlur={() => setHovered(null)}
              onClick={() => onSelect?.(node)}
              className={cx(
                "glass-flat absolute rounded-xl px-3 py-2 text-left transition-all",
                "hover:-translate-y-px focus:outline-none focus-visible:ring-1 focus-visible:ring-amber",
                dim(node.id) ? "opacity-25" : "opacity-100",
                node.kind === "check" && node.tone === "decides" && "!border-2",
              )}
              style={{
                left: node.x,
                top: node.y,
                width: node.w,
                height: node.h,
                borderColor: TONE_BORDER[node.tone],
                boxShadow: selected
                  ? `0 0 0 1px ${TONE_DOT[node.tone]}`
                  : undefined,
              }}
            >
              <div className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: TONE_DOT[node.tone] }}
                />
                <span className="truncate font-mono text-[11.5px] text-ink">
                  {node.title}
                </span>
              </div>
              {node.subtitle && (
                <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-faint">
                  {node.subtitle}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TraceLegend() {
  const items: { tone: PortTone; label: string }[] = [
    { tone: "agent", label: "agent" },
    { tone: "decides", label: "decides the verdict" },
    { tone: "context", label: "judge → agent context" },
    { tone: "memory", label: "memory / recall" },
    { tone: "inert", label: "suppressed" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3 text-[11px] text-faint">
      {items.map((i) => (
        <span key={i.tone} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-1.5 rounded-full"
            style={{ background: TONE_DOT[i.tone] }}
          />
          {i.label}
        </span>
      ))}
      <span className="ml-auto">hover a node to isolate its causal path</span>
    </div>
  );
}
