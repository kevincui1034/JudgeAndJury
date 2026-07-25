import Link from "next/link";
import { notFound } from "next/navigation";

import { ArchiveButton } from "@/components/ArchiveButton";
import {
  AuthorityBadge,
  SponsorMark,
  SponsorTag,
} from "@/components/sponsors/SponsorMark";
import { TraceView } from "@/components/trace/TraceView";
import { buildTraceGraph } from "@/components/trace/traceLayout";
import {
  Badge,
  ClassChip,
  GlassPanel,
  Mono,
  PanelHeader,
  VerdictBadge,
  ms,
  timeAgo,
} from "@/components/ui/primitives";
import { parseConventions, replayLinks } from "@/lib/conventions";
import { getTrace } from "@/lib/queries/traces";
import { requireRepo } from "@/lib/repo";
import { SPONSORS } from "@/lib/sponsors";

interface RawCheck {
  name: string;
  passed: boolean;
  failure_class?: string | null;
  evidence?: string;
}

export default async function TracePage({
  params,
}: {
  params: Promise<{ repoId: string; recordId: string }>;
}) {
  const { repoId, recordId } = await params;
  const { repo } = await requireRepo(repoId);
  const trace = await getTrace(repo.id, recordId);
  if (!trace) notFound();

  const { record, advisories, resolvedBy } = trace;
  const data = record.data as Record<string, unknown>;
  const checks = (data.checks ?? []) as RawCheck[];
  const conventions = parseConventions(data.advisory_input as string);

  const graph = buildTraceGraph({
    recordId: record.recordId,
    createdAt: record.createdAt.toISOString(),
    action: record.action,
    agentSource: record.agentSource,
    taskRef: (data.task_ref as string) ?? null,
    gatePassed: record.gatePassed,
    gateDurationMs: record.gateDurationMs,
    judgeModelId: record.judgeModelId,
    diagnosis: record.diagnosis,
    recalledFrom: record.recalledFrom,
    resolves: record.resolves,
    resolutionStatus: record.resolutionStatus,
    resolutionOutcome: record.resolutionOutcome,
    checks,
    advisories: advisories.map((a) => ({
      idx: a.idx,
      concern: a.concern,
      // kind/tier are nullable in the DB (a malformed model reply is
      // dropped by the CLI, but the column stays permissive).
      kind: a.kind ?? "discovery",
      tier: a.tier ?? 4,
      confidence: Number(a.confidence ?? 0),
      target: a.target,
      delivery: a.delivery,
      label: a.label,
      retraction: a.retraction,
      groundedIn: [],
    })),
    conventions,
    resolvedBy: resolvedBy?.recordId ?? null,
  });

  const recordings = checks.flatMap((c) => replayLinks(c.evidence));
  const base = `/r/${repoId}`;
  const isArchived = Boolean(record.archivedAt);
  const replay = SPONSORS.replay;
  const actian = SPONSORS.actian;

  return (
    <div className="space-y-4 pb-2">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1 pt-1">
        <div>
          <Link
            href={isArchived ? `${base}/traces?archived=1` : `${base}/traces`}
            className="text-[11px] text-faint transition-colors hover:text-body"
          >
            {isArchived ? "← archived traces" : "← all traces"}
          </Link>
          <h1 className="mt-1 flex items-center gap-3 text-[34px] leading-none font-medium tracking-tight text-ink">
            <Mono className="!text-[30px]">{record.recordId}</Mono>
            <VerdictBadge passed={record.gatePassed} />
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-faint">
            <span>{record.action}</span>
            <span>·</span>
            <span>{record.agentSource}</span>
            <span>·</span>
            <span>{ms(record.gateDurationMs)}</span>
            <span>·</span>
            <span>{timeAgo(record.createdAt)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(record.failureClasses ?? []).map((c) => (
            <ClassChip key={c} name={c} />
          ))}
          {record.resolutionStatus && (
            <Badge
              tone={record.resolutionStatus === "false_positive" ? "red" : "green"}
            >
              {record.resolutionStatus}
            </Badge>
          )}
          {record.recalledFrom && (
            <span
              className="inline-flex items-center gap-1.5"
              title={actian.note}
            >
              <span className="text-[11px] text-faint">↩ recalled from</span>
              <Badge
                tone={record.recalledFrom.includes(":") ? "teal" : "violet"}
                mono
              >
                {record.recalledFrom}
              </Badge>
              <SponsorTag sponsor={actian} />
            </span>
          )}
          {isArchived && <Badge tone="faint">archived</Badge>}
          <ArchiveButton
            repoId={repoId}
            recordId={record.recordId}
            path={`${base}/traces/${record.recordId}`}
            archived={isArchived}
          />
        </div>
      </div>

      {isArchived && (
        <GlassPanel className="px-5 py-3">
          <p className="text-[12px] leading-relaxed text-body">
            <span className="text-ink">This trace is archived.</span> It is
            hidden from the main Gate list and shows up under the Archived
            filter. Nothing was removed — the record, its advisories, its
            evidence and its {record.gatePassed ? "passed" : "blocked"} verdict
            are exactly as they were. Restore it any time.
          </p>
        </GlassPanel>
      )}

      {/* ── the canvas ── */}
      <GlassPanel className="overflow-hidden">
        <PanelHeader
          title="Judge"
          accent="↔ Agent"
          hint="The causal chain for this run. Only the Checks lane decides the verdict; the loop-back edge is what the agent actually received."
        />
        <TraceView graph={graph} />
      </GlassPanel>

      {/* ── diagnosis + evidence ── */}
      <div className="grid gap-3 xl:grid-cols-2">
        <GlassPanel>
          <PanelHeader
            title="Diagnosis"
            accent={record.judgeModelId ?? undefined}
            hint="Explanation only — written after the verdict was already decided."
          />
          <p className="px-5 pb-5 text-[13px] leading-relaxed text-body">
            {record.diagnosis}
          </p>
        </GlassPanel>

        <GlassPanel>
          <PanelHeader title="Check" accent="evidence" />
          <div className="pb-2">
            {checks
              .filter((c) => !c.passed)
              .map((c) => (
                <div
                  key={c.name}
                  className="border-t border-line/70 px-5 py-3 first:border-t-0"
                >
                  <div className="flex items-center gap-2">
                    <Mono className="text-ink">{c.name}</Mono>
                    {c.failure_class && <ClassChip name={c.failure_class} />}
                  </div>
                  {c.evidence && (
                    <p className="mt-1.5 font-mono text-[11.5px] leading-relaxed text-faint">
                      {c.evidence}
                    </p>
                  )}
                </div>
              ))}
            {checks.every((c) => c.passed) && (
              <p className="px-5 pb-4 text-[12px] text-faint">
                All checks passed — nothing to show.
              </p>
            )}
          </div>
        </GlassPanel>
      </div>

      {/* ── Replay recordings, when browser QA ran ── */}
      {recordings.length > 0 && (
        <GlassPanel>
          <PanelHeader
            title="Browser QA"
            accent="recordings"
            hint={`Captured by the browser-QA run this gate checked. The ${replay.capabilityKey} result comes from a recorded exit code and a worktree digest, never from model output.`}
            right={
              <>
                <SponsorMark sponsor={replay} />
                <SponsorTag sponsor={replay} />
                <AuthorityBadge sponsor={replay} />
              </>
            }
          />
          <div className="flex flex-wrap gap-2 px-5 pb-5">
            {recordings.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="glass-flat rounded-lg px-3 py-1.5 font-mono text-[11.5px] text-amber-ink transition-colors hover:border-amber"
              >
                ▶ watch recording
              </a>
            ))}
          </div>
        </GlassPanel>
      )}
    </div>
  );
}
