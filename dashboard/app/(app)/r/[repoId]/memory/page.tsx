import Link from "next/link";

import { SponsorMark, SponsorTag } from "@/components/sponsors/SponsorMark";
import {
  Badge,
  ClassChip,
  EmptyState,
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
import { requireRepo } from "@/lib/repo";
import { SPONSORS } from "@/lib/sponsors";

export default async function MemoryPage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  const { repo } = await requireRepo(repoId);
  const [recall, reliability, recent] = await Promise.all([
    recallStats(repo.id),
    classReliability(repo.id),
    recentTraces(repo.id, 40),
  ]);

  const actian = SPONSORS.actian;
  const recalled = recent.filter((r) => r.recalledFrom);
  const maxRel = reliability[0]?.total ?? 1;
  const labelled = reliability.reduce(
    (n, r) => n + r.accepted + r.falsePositive,
    0,
  );

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
    </div>
  );
}
