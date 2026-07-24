"use client";

/**
 * Canvas + detail drawer. Client-side only for hover/selection state —
 * the graph itself is built on the server and passed in whole.
 */
import { useState } from "react";

import { TraceCanvas, TraceLegend } from "@/components/trace/TraceCanvas";
import type { TraceGraph, TraceNode } from "@/components/trace/traceLayout";
import { Badge, DeliveryBadge, Mono, cx } from "@/components/ui/primitives";

export function TraceView({ graph }: { graph: TraceGraph }) {
  const [selected, setSelected] = useState<TraceNode | null>(null);

  return (
    <>
      <TraceCanvas
        graph={graph}
        selectedId={selected?.id ?? null}
        onSelect={(n) => setSelected((cur) => (cur?.id === n.id ? null : n))}
      />
      <TraceLegend />
      {selected && (
        <div className="border-t border-line px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] tracking-[0.14em] text-faint uppercase">
                {selected.lane}
              </p>
              <p className="mt-1 font-mono text-[13px] text-ink">
                {selected.title}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-[11px] text-faint transition-colors hover:text-body"
            >
              close
            </button>
          </div>
          <NodeDetail node={selected} />
        </div>
      )}
    </>
  );
}

function NodeDetail({ node }: { node: TraceNode }) {
  const d = (node.data ?? {}) as Record<string, unknown>;

  if (node.kind === "check") {
    return (
      <div className="mt-3 space-y-2">
        {typeof d.failureClass === "string" && (
          <Badge tone="red" mono>
            {d.failureClass}
          </Badge>
        )}
        {typeof d.evidence === "string" && d.evidence && (
          <pre className="glass-flat overflow-x-auto rounded-lg px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-body">
            {d.evidence}
          </pre>
        )}
        <p className="text-[11px] text-faint">
          Deterministic. This is the only lane that decides the verdict —
          every other node on this canvas is context.
        </p>
      </div>
    );
  }

  if (node.kind === "advisory") {
    return (
      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="amber">tier {String(d.tier)}</Badge>
          <Badge tone="neutral">
            confidence {Number(d.confidence).toFixed(2)}
          </Badge>
          <Badge tone="neutral">{String(d.kind)}</Badge>
          <DeliveryBadge delivery={(d.delivery as string) ?? null} />
          {d.label ? (
            <Badge tone={d.label === "confirmed" ? "green" : "red"}>
              {String(d.label)}
            </Badge>
          ) : null}
        </div>
        <p className="text-[12.5px] leading-relaxed text-body">
          {String(d.concern ?? "")}
        </p>
        {typeof d.target === "string" && d.target && (
          <Mono className="text-faint">{d.target}</Mono>
        )}
        {Array.isArray(d.groundedIn) && d.groundedIn.length > 0 && (
          <p className="text-[11px] text-faint">
            grounded in {(d.groundedIn as string[]).join(", ")}
          </p>
        )}
        <p className="text-[11px] text-faint">
          Model judgment. Recorded and (conditionally) surfaced — never part
          of the block/allow decision.
        </p>
      </div>
    );
  }

  if (node.kind === "judge") {
    return (
      <div className="mt-3 space-y-2">
        <p className="text-[12.5px] leading-relaxed text-body">
          {String(d.diagnosis ?? "")}
        </p>
        <p className="text-[11px] text-faint">
          The judge explains a verdict the checks already reached.
        </p>
      </div>
    );
  }

  if (node.kind === "conventions") {
    const list = (d.conventions ?? []) as {
      statement: string;
      source: string | null;
    }[];
    return (
      <ul className="mt-3 space-y-2">
        {list.map((c, i) => (
          <li key={i} className="text-[12.5px] leading-relaxed text-body">
            {c.statement}
            {c.source && (
              <span className="ml-1.5">
                <Badge tone="amber" mono>
                  {c.source}
                </Badge>
              </span>
            )}
          </li>
        ))}
      </ul>
    );
  }

  if (node.kind === "agentTurn") {
    return (
      <div className="mt-3 space-y-2">
        <p className="text-[12.5px] leading-relaxed text-body">
          {d.taskRef ? String(d.taskRef) : "No task was stated for this run."}
        </p>
        <p className="text-[11px] text-faint">
          Without a stated task the judge emits no tier-5 (&ldquo;not what was
          asked&rdquo;) findings — there is nothing to compare intent against.
        </p>
      </div>
    );
  }

  return (
    <p className={cx("mt-3 text-[12.5px] text-body")}>
      {node.subtitle ?? "—"}
    </p>
  );
}
