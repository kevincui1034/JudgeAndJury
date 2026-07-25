import Link from "next/link";

import { SponsorMark, SponsorTag } from "@/components/sponsors/SponsorMark";
import {
  Badge,
  ClassChip,
  EmptyState,
  GlassPanel,
  Mono,
  PageHeader,
  PanelHeader,
  pct,
  RankedRow,
  SplitPanel,
  Stat,
  StatStrip,
  timeAgo,
} from "@/components/ui/primitives";
import { classReliability, recentTraces } from "@/lib/queries/highlights";
import { recallStats } from "@/lib/queries/judge";
import {
  describeGap,
  recallByClass,
  recallEdges,
  unmatchedBlocks,
} from "@/lib/queries/recall";
import { requireRepo } from "@/lib/repo";
import { SPONSORS } from "@/lib/sponsors";

export default async function MemoryPage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  const { repo } = await requireRepo(repoId);
  const [recall, reliability, recent, edges, byClass, novel] = await Promise.all([
    recallStats(repo.id),
    classReliability(repo.id),
    recentTraces(repo.id, 40),
    recallEdges(repo.id),
    recallByClass(repo.id),
    unmatchedBlocks(repo.id),
  ]);

  const actian = SPONSORS.actian;
  const recalled = recent.filter((r) => r.recalledFrom);
  const maxRel = reliability[0]?.total ?? 1;
  const labelled = reliability.reduce(
    (n, r) => n + r.accepted + r.falsePositive,
    0,
  );
  const crossEdges = edges.filter((e) => e.crossRepo).length;
  const matchedClasses = byClass.filter((c) => c.matched > 0).length;

  return (
    <div className="space-y-4 pb-2">
      <PageHeader
        title="Gate"
        accent="memory"
        sub={
          <>
            Every block becomes a prior. When the same failure recurs, the gate
          cites the record that explains it — and your labels decide which
          classes it still trusts.
          </>
        }
      />

      <StatStrip cols={4}>
        <Stat label="Blocks" value={String(recall.blocked)} tone="red" />
        <Stat
          label="Recall hit rate"
          value={pct(recall.blocked ? recall.recalled / recall.blocked : null)}
          tone="amber"
          sub="blocks matched to a prior"
        />
        <Stat
          label="Cross-repo hits"
          value={String(recall.crossRepo)}
          tone="green"
          sub="a mistake learned in another repo"
        />
        <Stat
          label="Labeled blocks"
          value={String(labelled)}
          sub="accepted or false positive"
        />
      </StatStrip>

      <SplitPanel>
        <div>
          <PanelHeader
            title="Class"
            accent="reliability"
            hint="Two or more false positives, and more of them than accepted, marks a class noisy — its priors are demoted in ranking, never excluded."
          />
          {labelled === 0 ? (
            <EmptyState
              title="Nothing labeled yet."
              hint="Open a blocked trace and mark it accepted or a false positive."
            />
          ) : (
            <div className="pb-2">
              {reliability.map((r, i) => (
                <RankedRow
                  key={r.name}
                  rank={i + 1}
                  label={
                    <span className="flex items-center gap-1.5">
                      <ClassChip name={r.name} />
                      {r.noisy && <Badge tone="faint">noisy</Badge>}
                    </span>
                  }
                  value={`${r.accepted}✓ ${r.falsePositive}✗`}
                  share={r.total / maxRel}
                  tone="var(--bot-violet)"
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <PanelHeader
            title="Recalled"
            accent="priors"
            hint={`Semantic recall matches a prior by meaning rather than by exact wording. Priors the judge may cite — ${actian.authority.toLowerCase()}, never authority.`}
            right={
              <>
                <SponsorMark sponsor={actian} />
                <SponsorTag sponsor={actian} />
              </>
            }
          />
          {recalled.length === 0 ? (
            <EmptyState
              title="No recurrences yet."
              hint="Recall fires when a failure repeats: same class, shared evidence — or, with semantic recall on, the same meaning in different words."
            />
          ) : (
            <div className="pb-2">
              {recalled.map((r) => (
                <Link
                  key={r.recordId}
                  href={`/r/${repoId}/traces/${r.recordId}`}
                  className="flex items-center gap-3 border-t border-line/70 px-5 py-2.5 transition-colors first:border-t-0 hover:bg-tint"
                >
                  <Mono className="text-body">{r.recordId}</Mono>
                  <span className="text-faint">↩</span>
                  <Badge
                    tone={r.recalledFrom!.includes(":") ? "teal" : "violet"}
                    mono
                  >
                    {r.recalledFrom}
                  </Badge>
                  {r.recalledFrom!.includes(":") && (
                    <Badge tone="faint">cross-repo</Badge>
                  )}
                  <span className="ml-auto text-[11px] text-faint">
                    {timeAgo(r.createdAt)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </SplitPanel>

      <StatStrip cols={3}>
        <Stat
          label="Recall edges"
          value={String(edges.length)}
          tone="violet"
          sub="runs that cited an earlier record"
        />
        <Stat
          label="Cross-repo edges"
          value={String(crossEdges)}
          tone="teal"
          sub="prior first seen in another repo"
        />
        <Stat
          label="Novel blocks"
          value={String(novel.total)}
          tone="red"
          sub="blocked with no prior to cite"
        />
      </StatStrip>

      <GlassPanel>
        <PanelHeader
          title="Recall"
          accent="explorer"
          hint={`The recurrence graph exactly as the CLI recorded it — each edge is a run that matched an earlier record. Priors are ${actian.authority.toLowerCase()}: the judge may cite one, and a citation on its own decides nothing.`}
          right={
            <>
              <SponsorMark sponsor={actian} />
              <SponsorTag sponsor={actian} />
            </>
          }
        />
        {edges.length === 0 ? (
          <EmptyState
            title="No recurrences recorded."
            hint="An edge appears the first time a run matches a record already in memory — same failure, whether or not the wording lines up."
          />
        ) : (
          <div className="pb-2">
            {edges.map((e) => {
              const gap = describeGap(e.priorAt, e.citingAt);
              const shared = e.sharedClasses.length > 0;
              const chips = shared ? e.sharedClasses : e.citingClasses;
              return (
                <div
                  key={e.citingPk}
                  className="border-t border-line/70 px-5 py-3 first:border-t-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/r/${repoId}/traces/${e.citingId}`}
                      className="rounded transition-colors hover:text-ink"
                    >
                      <Mono className="text-ink">{e.citingId}</Mono>
                    </Link>
                    <span aria-hidden className="text-faint">
                      →
                    </span>
                    {e.crossRepo ? (
                      <Badge
                        tone="teal"
                        mono
                        title={`prior recorded in ${e.priorRepo}`}
                      >
                        {e.recalledFrom}
                      </Badge>
                    ) : (
                      <Link href={`/r/${repoId}/traces/${e.priorId}`}>
                        <Badge tone="violet" mono>
                          {e.priorId}
                        </Badge>
                      </Link>
                    )}
                    <Badge tone={e.crossRepo ? "teal" : "faint"}>
                      {e.crossRepo ? "cross-repo" : "same repo"}
                    </Badge>
                    {chips.length > 0 && (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-faint">
                          {shared ? "shared" : "class"}
                        </span>
                        {chips.slice(0, 3).map((c) => (
                          <ClassChip key={c} name={c} />
                        ))}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-[11px] text-faint">
                      {gap ?? timeAgo(e.citingAt)}
                    </span>
                  </div>
                  {e.diagnosis && (
                    <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-faint">
                      {e.diagnosis}
                    </p>
                  )}
                  {e.hasContext && (
                    <a
                      href={`/api/proof/${e.citingPk}/context.json`}
                      className="mt-1.5 inline-flex rounded-md bg-bot-violet/10 px-1.5 py-0.5 font-mono text-[11px] text-bot-violet transition-opacity hover:opacity-80"
                    >
                      context.json — the priors this run was shown
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </GlassPanel>

      <SplitPanel>
        <div>
          <PanelHeader
            title="Hit rate"
            accent="by class"
            hint="Of the blocks in each class, how many had an earlier record to point at. A low rate means the class is young, or its recurrences do not read alike."
          />
          {byClass.length === 0 ? (
            <EmptyState
              title="No blocks yet."
              hint="Nothing has been blocked in this repo, so there is nothing to match against."
            />
          ) : (
            <div className="pb-2">
              {byClass.map((c, i) => (
                <RankedRow
                  key={c.failureClass}
                  rank={i + 1}
                  label={
                    <span className="flex flex-wrap items-center gap-1.5">
                      <ClassChip name={c.failureClass} />
                      <span className="text-[11px] text-faint">
                        {c.matched} of {c.blocks} matched
                      </span>
                      {c.crossRepo > 0 && (
                        <Badge tone="teal">{c.crossRepo} cross-repo</Badge>
                      )}
                    </span>
                  }
                  value={pct(c.hitRate)}
                  share={c.hitRate ?? 0}
                  tone="var(--bot-violet)"
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <PanelHeader
            title="Novel"
            accent="blocks"
            hint={`${novel.total} block${novel.total === 1 ? "" : "s"} matched nothing — first of their kind here. Recall only ever covers what has already happened, and these are what it could not reach. ${matchedClasses} of ${byClass.length} classes have any prior at all.`}
          />
          {novel.recent.length === 0 ? (
            <EmptyState
              title="Every block cited a prior."
              hint="Nothing blocked here without an earlier record behind it."
            />
          ) : (
            <div className="pb-2">
              {novel.recent.map((b) => (
                <Link
                  key={b.recordId}
                  href={`/r/${repoId}/traces/${b.recordId}`}
                  className="flex flex-wrap items-center gap-2 border-t border-line/70 px-5 py-2.5 transition-colors first:border-t-0 hover:bg-tint"
                >
                  <Mono className="text-body">{b.recordId}</Mono>
                  {b.failureClasses.slice(0, 2).map((c) => (
                    <ClassChip key={c} name={c} />
                  ))}
                  {b.resolutionStatus && (
                    <Badge tone="faint">{b.resolutionStatus}</Badge>
                  )}
                  <span className="ml-auto shrink-0 text-[11px] text-faint">
                    {timeAgo(b.createdAt)}
                  </span>
                </Link>
              ))}
              {novel.total > novel.recent.length && (
                <p className="border-t border-line/70 px-5 pt-2.5 text-[11px] text-faint">
                  showing {novel.recent.length} of {novel.total}
                </p>
              )}
            </div>
          )}
        </div>
      </SplitPanel>
    </div>
  );
}
