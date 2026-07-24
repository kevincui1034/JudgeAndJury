import Link from "next/link";
import {
  Activity,
  CircleCheck,
  ListTree,
  RotateCcw,
  ShieldX,
  Timer,
  TriangleAlert,
} from "lucide-react";

import { VerdictTimeseries } from "@/components/charts/VerdictTimeseries";
import { OverlayCard } from "@/components/ui/OverlayCard";
import {
  Badge,
  ClassChip,
  EmptyState,
  GlassPanel,
  Mono,
  PageHeader,
  PanelHeader,
  RankedRow,
  Sparkline,
  StatTile,
  VerdictBadge,
  cx,
  ms,
  pct,
  timeAgo,
} from "@/components/ui/primitives";
import {
  classReliability,
  heldAdvisoryCount,
  lastBlock,
  modelsServed,
  recentTraces,
  verdictBuckets,
} from "@/lib/queries/highlights";
import { failureClassCounts, overviewStats } from "@/lib/queries/overview";
import { requireRepo } from "@/lib/repo";

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  const { repo } = await requireRepo(repoId);
  const pk = repo.id;

  const [stats, buckets, classes, block, held, models, recent, reliability] =
    await Promise.all([
      overviewStats(pk),
      verdictBuckets(pk),
      failureClassCounts(pk),
      lastBlock(pk),
      heldAdvisoryCount(pk),
      modelsServed(pk),
      recentTraces(pk),
      classReliability(pk),
    ]);

  const base = `/r/${repoId}`;
  // Sparklines follow the same bucketing as the chart, so a short history
  // still shows a shape instead of a single flat point.
  const runsSpark = buckets.points.map((d) => d.passed + d.blocked);
  const blockedSpark = buckets.points.map((d) => d.blocked);
  const blockRate = stats.total > 0 ? stats.blocked / stats.total : null;
  const maxClass = classes[0]?.count ?? 1;
  const maxRel = reliability[0]?.total ?? 1;
  // Reliability only means something once a human has judged some blocks.
  const labelled = reliability.reduce(
    (n, r) => n + r.accepted + r.falsePositive,
    0,
  );
  const hasTrend = buckets.points.length >= 2;

  const overlays = [
    block && {
      key: "block",
      node: (
        <OverlayCard
          label="Last block"
          value={<Mono>{block.recordId}</Mono>}
          tone="red"
          href={`${base}/traces/${block.recordId}`}
          sub={
            <span className="flex flex-wrap items-center gap-1">
              {block.failureClasses.slice(0, 2).map((c) => (
                <ClassChip key={c} name={c} />
              ))}
              <span>{timeAgo(block.createdAt)}</span>
            </span>
          }
        />
      ),
    },
    held > 0 && {
      key: "held",
      node: (
        <OverlayCard
          label="Awaiting you"
          value={`${held} advisor${held === 1 ? "y" : "ies"}`}
          tone="violet"
          href={`${base}/loop`}
          sub="held findings — approve to deliver them to the agent"
        />
      ),
    },
    models.length > 0 && {
      key: "router",
      node: (
        <OverlayCard
          label="Router"
          value={`${models.length} model${models.length === 1 ? "" : "s"}`}
          tone="amber"
          href={`${base}/judge`}
          sub={`served ${models.reduce((n, m) => n + m.calls, 0)} judge calls`}
        />
      ),
    },
  ].filter(Boolean) as { key: string; node: React.ReactNode }[];

  if (stats.total === 0) {
    return (
      <div className="space-y-4">
        <PageTitle repoSlug={repo.repoSlug} />
        <GlassPanel>
          <EmptyState
            title="No gate runs synced yet."
            hint="Run the gate locally, then `proofjury sync`. Records upload only after you connect — nothing leaves your machine before that."
            action={
              <code className="glass-flat rounded-lg px-3 py-1.5 font-mono text-[12px] text-body">
                proofjury guard deploy -- ./deploy.sh
              </code>
            }
          />
        </GlassPanel>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-2">
      <PageTitle repoSlug={repo.repoSlug} />

      {/* ── row 1: stat tiles with inline sparklines ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label="Gate runs"
          value={String(stats.total)}
          sub={`${stats.passed} passed · ${stats.blocked} blocked`}
          spark={<Sparkline points={runsSpark} tone="var(--body)" />}
          href={`${base}/traces`}
          icon={Activity}
        />
        <StatTile
          label="Blocked"
          value={pct(blockRate)}
          sub="deploys stopped before prod"
          tone="red"
          spark={<Sparkline points={blockedSpark} tone="var(--verdict-red)" />}
          href={`${base}/traces?verdict=blocked`}
          icon={ShieldX}
        />
        <StatTile
          label="Recall hit rate"
          value={pct(stats.recallHitRate)}
          sub="blocks matched to a prior"
          tone="amber"
          href={`${base}/memory`}
          icon={RotateCcw}
        />
        <StatTile
          label="Auto-resolved"
          value={pct(stats.autoResolveRate)}
          sub="blocks later closed by a pass"
          tone="green"
          icon={CircleCheck}
        />
        <StatTile
          label="p95 gate time"
          value={ms(stats.p95DurationMs)}
          sub="checks + recall + judge"
          icon={Timer}
        />
      </div>

      {/* ── row 2: timeseries with floating glass overlays ── */}
      <GlassPanel className="relative overflow-hidden">
        <PanelHeader
          title="Verdicts"
          accent="over time"
          hint="Deterministic checks alone decide these outcomes."
          right={
            <div className="flex items-center gap-3 text-[11px] text-faint">
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-verdict-green" /> passed
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-verdict-red" /> blocked
              </span>
            </div>
          }
        />
        {/* The overlays used to float ON the plot. That is a dark-world
            idiom: an opaque white card on a white chart reads as a rendering
            artifact rather than as depth. Side-by-side works in both worlds,
            and it converges with the no-trend branch below. */}
        <div className="grid gap-4 px-5 pb-5 xl:grid-cols-[minmax(0,1fr)_248px]">
          <div className="min-w-0">
            {hasTrend ? (
              <VerdictTimeseries data={buckets.points} unit={buckets.unit} />
            ) : (
              <div className="glass-flat flex h-full items-center gap-6 rounded-xl px-5 py-6">
                <div>
                  <p className="tnum text-[30px] leading-none font-semibold text-ink">
                    {stats.total}
                  </p>
                  <p className="mt-1.5 text-[11px] text-faint">
                    runs in a single session
                  </p>
                </div>
                <div className="h-10 w-px bg-line" />
                <div className="flex-1">
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-tint-strong">
                    <div
                      className="bg-verdict-green"
                      style={{ width: `${(stats.passed / stats.total) * 100}%` }}
                    />
                    <div
                      className="bg-verdict-red"
                      style={{ width: `${(stats.blocked / stats.total) * 100}%` }}
                    />
                  </div>
                  <p className="mt-2 text-[11px] text-faint">
                    {stats.passed} passed · {stats.blocked} blocked — a trend
                    line needs more than one {buckets.unit} of history.
                  </p>
                </div>
              </div>
            )}
          </div>

          {overlays.length > 0 && (
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-1 xl:content-start">
              {overlays.map((o) => (
                <div key={o.key}>{o.node}</div>
              ))}
            </div>
          )}
        </div>
      </GlassPanel>

      {/* ── row 3: ranked tables ── */}
      <div className="grid gap-3 xl:grid-cols-2">
        <GlassPanel>
          <PanelHeader
            title="Failure"
            accent="classes"
          icon={TriangleAlert}
            hint="What actually blocks deploys in this repo."
            right={
              <Link
                href={`${base}/traces?verdict=blocked`}
                className="text-[11px] text-faint transition-colors hover:text-body"
              >
                view all →
              </Link>
            }
          />
          {classes.length === 0 ? (
            <EmptyState title="No failures recorded yet." />
          ) : (
            <div className="pb-2">
              {classes.slice(0, 6).map((c, i) => (
                <RankedRow
                  key={c.name}
                  rank={i + 1}
                  label={<ClassChip name={c.name} />}
                  value={String(c.count)}
                  share={c.count / maxClass}
                  tone="var(--verdict-red)"
                />
              ))}
            </div>
          )}
        </GlassPanel>

        <GlassPanel>
          <PanelHeader
            title="Class"
            accent="reliability"
          icon={RotateCcw}
            hint="Was the block right? Labels you apply train recall ranking."
            right={
              <Link
                href={`${base}/memory`}
                className="text-[11px] text-faint transition-colors hover:text-body"
              >
                memory →
              </Link>
            }
          />
          {labelled === 0 ? (
            <EmptyState
              title="Nothing labeled yet."
              hint="Open a blocked trace and mark it accepted or a false positive. Labels are what teach recall which classes to trust — and they become the fine-tune corpus."
            />
          ) : (
            <div className="pb-2">
              {reliability.slice(0, 6).map((r, i) => (
                <RankedRow
                  key={r.name}
                  rank={i + 1}
                  label={
                    <span className="flex items-center gap-1.5">
                      <ClassChip name={r.name} />
                      {r.noisy && (
                        <Badge tone="faint" title="More false positives than accepted — priors in this class are demoted in recall">
                          noisy
                        </Badge>
                      )}
                    </span>
                  }
                  value={`${r.accepted}✓ ${r.falsePositive}✗`}
                  share={r.total / maxRel}
                  tone="var(--bot-violet)"
                />
              ))}
            </div>
          )}
        </GlassPanel>
      </div>

      {/* ── row 4: recent traces ── */}
      <GlassPanel>
        <PanelHeader
          title="Recent"
          accent="traces"
          icon={ListTree}
          right={
            <Link
              href={`${base}/traces`}
              className="text-[11px] text-faint transition-colors hover:text-body"
            >
              all traces →
            </Link>
          }
        />
        <div className="pb-2">
          {recent.map((t) => (
            <Link
              key={t.recordId}
              href={`${base}/traces/${t.recordId}`}
              className="flex items-center gap-3 border-t border-line/70 px-5 py-2.5 transition-colors first:border-t-0 hover:bg-tint"
            >
              <Mono className="w-16 shrink-0 text-body">{t.recordId}</Mono>
              <VerdictBadge passed={t.gatePassed} />
              <span className="w-16 shrink-0 text-[12px] text-faint">{t.action}</span>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                {t.failureClasses.slice(0, 3).map((c) => (
                  <ClassChip key={c} name={c} />
                ))}
                {t.recalledFrom && (
                  <Badge tone="violet" mono title="Recalled from a prior record">
                    ↩ {t.recalledFrom}
                  </Badge>
                )}
                {t.advisoryCount > 0 && (
                  <Badge tone="amber">
                    {t.advisoryCount} advisor{t.advisoryCount === 1 ? "y" : "ies"}
                  </Badge>
                )}
              </div>
              <span className="shrink-0 text-[11px] text-faint">{t.agentSource}</span>
              <span className="w-16 shrink-0 text-right text-[11px] text-faint">
                {timeAgo(t.createdAt)}
              </span>
            </Link>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}

function PageTitle({ repoSlug }: { repoSlug: string }) {
  return (
    <PageHeader
      title="Gate"
      accent="Overview"
      sub={
        <>
          Every intercepted command in <Mono className="text-body">{repoSlug}</Mono>,
          with the evidence behind its verdict.
        </>
      }
    />
  );
}
