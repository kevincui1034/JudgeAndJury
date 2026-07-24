import {
  Badge,
  EmptyState,
  GlassPanel,
  Mono,
  PageHeader,
  PanelHeader,
  pct,
  RankedRow,
  StatTile,
  timeAgo,
} from "@/components/ui/primitives";
import {
  correctionsByCategory,
  intentStats,
  listCheckpoints,
} from "@/lib/queries/intent";
import { requireRepo } from "@/lib/repo";

export default async function IntentPage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  const { repo } = await requireRepo(repoId);
  const [stats, list, categories] = await Promise.all([
    intentStats(repo.id),
    listCheckpoints(repo.id),
    correctionsByCategory(repo.id),
  ]);
  const maxCat = categories[0]?.count ?? 1;

  return (
    <div className="space-y-4 pb-2">
      <PageHeader
        title="Agent"
        accent="checkpoints"
        sub={
          <>
            Every time the agent claimed done. Your next message is the label:
          push back and it&apos;s a correction; move on and that&apos;s implicit
          acceptance. Three corrections in one category graduate into a
          candidate preference.
          </>
        }
      />

      {stats.total === 0 ? (
        <GlassPanel>
          <EmptyState
            title="No checkpoints synced yet."
            hint="Checkpoints record when your agent finishes a turn. Run `proofjury sync` after some agent work — they upload alongside gate records."
          />
        </GlassPanel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Checkpoints" value={String(stats.total)} />
            <StatTile
              label="Correction rate"
              value={pct(stats.correctionRate)}
              tone="red"
              sub={`${stats.corrected} corrected · ${stats.accepted} accepted`}
            />
            <StatTile
              label="Unlabeled"
              value={String(stats.unlabeled)}
              sub="classifier was unsure, or no next message yet"
            />
            <StatTile
              label="Lines reviewed"
              value={String(stats.diffLines)}
              sub="across all checkpoints"
            />
          </div>

          {categories.length > 0 && (
            <GlassPanel>
              <PanelHeader
                title="Corrections"
                accent="by category"
                hint="Three in one category graduate into a candidate preference."
              />
              <div className="pb-2">
                {categories.map((c, i) => (
                  <RankedRow
                    key={c.category}
                    rank={i + 1}
                    label={<Badge tone="violet">{c.category}</Badge>}
                    value={String(c.count)}
                    share={c.count / maxCat}
                    tone="var(--bot-violet)"
                  />
                ))}
              </div>
            </GlassPanel>
          )}

          <GlassPanel>
            <PanelHeader title="Recent" accent="checkpoints" />
            <div className="pb-2">
              {list.map((c) => (
                <div
                  key={c.pk}
                  className="border-t border-line/70 px-5 py-3.5 first:border-t-0"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Mono className="text-body">{c.checkpointId}</Mono>
                    <Badge tone="neutral">{c.event}</Badge>
                    {c.outcomeLabel === "corrected" && (
                      <Badge tone="red">corrected</Badge>
                    )}
                    {c.outcomeLabel === "accepted_implicit" && (
                      <Badge tone="green">accepted</Badge>
                    )}
                    {!c.outcomeLabel && <Badge tone="faint">unlabeled</Badge>}
                    {c.outcomeCategory && (
                      <Badge tone="violet">{c.outcomeCategory}</Badge>
                    )}
                    {c.findingCount > 0 && (
                      <Badge tone="amber">
                        {c.findingCount} finding
                        {c.findingCount === 1 ? "" : "s"}
                      </Badge>
                    )}
                    <span className="ml-auto text-[11px] text-faint">
                      +{c.diffLines} lines · {timeAgo(c.createdAt)}
                    </span>
                  </div>
                  {c.task && (
                    <p className="mt-1.5 text-[12.5px] text-body">{c.task}</p>
                  )}
                  {c.outcomeStatement && (
                    <p className="mt-1 text-[12px] text-faint">
                      you wanted: {c.outcomeStatement}
                    </p>
                  )}
                  {c.changedFiles.length > 0 && (
                    <Mono className="mt-1 block text-faint">
                      {c.changedFiles.slice(0, 4).join(", ")}
                      {c.changedFiles.length > 4 &&
                        ` +${c.changedFiles.length - 4}`}
                    </Mono>
                  )}
                </div>
              ))}
            </div>
          </GlassPanel>
        </>
      )}
    </div>
  );
}
