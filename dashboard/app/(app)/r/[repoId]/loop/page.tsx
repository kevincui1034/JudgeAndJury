import Link from "next/link";

import { AdvisoryActions } from "@/components/AdvisoryActions";
import {
  Badge,
  cx,
  DeliveryBadge,
  EmptyState,
  GlassPanel,
  Mono,
  PageHeader,
  PanelHeader,
  StatTile,
  timeAgo,
} from "@/components/ui/primitives";
import { loopFeed } from "@/lib/queries/intent";
import { requireRepo } from "@/lib/repo";

export default async function LoopPage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  const { repo } = await requireRepo(repoId);
  const feed = await loopFeed(repo.id);
  const path = `/r/${repoId}/loop`;

  const held = feed.filter((f) => f.delivery === "held" && !f.label).length;
  const delivered = feed.filter(
    (f) => f.delivery === "injected" || f.delivery === "sent",
  ).length;
  const labelled = feed.filter((f) => f.label).length;

  return (
    <div className="space-y-4 pb-2">
      <PageHeader
        title="Judge"
        accent="↔ Agent"
        sub={
          <>
            Everything the judge has told your coding agent — gate advisories and
          checkpoint intent findings in one conversation. None of it blocked
          anything; what you approve here reaches the agent on its next gate
          run.
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Total findings" value={String(feed.length)} />
        <StatTile
          label="Delivered to agent"
          value={String(delivered)}
          tone="amber"
          sub="injected or drained"
        />
        <StatTile
          label="Awaiting you"
          value={String(held)}
          tone={held > 0 ? "red" : "neutral"}
          sub="held below the auto-inject bar"
        />
        <StatTile
          label="You labeled"
          value={String(labelled)}
          tone="green"
          sub="feeds recall + the fine-tune corpus"
        />
      </div>

      <GlassPanel>
        <PanelHeader
          title="The"
          accent="conversation"
          hint="Newest first. Gate advisories run at deploy time; intent findings run when the agent claims done."
        />
        {feed.length === 0 ? (
          <EmptyState
            title="The judge hasn't said anything yet."
            hint="Advisory findings need a configured LLM key and a diff to review. Checkpoint findings need `proofjury sync` after the agent finishes a turn."
          />
        ) : (
          <div className="pb-2">
            {feed.map((item) => (
              <div
                key={item.pk}
                className="border-t border-line/70 px-5 py-4 first:border-t-0"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={item.source === "gate" ? "red" : "teal"}>
                    {item.source === "gate" ? "gate" : "checkpoint"}
                  </Badge>
                  <Link
                    href={
                      item.source === "gate"
                        ? `/r/${repoId}/traces/${item.parentId}`
                        : `/r/${repoId}/intent`
                    }
                    className="transition-colors hover:text-ink"
                  >
                    <Mono className="text-faint">
                      {item.parentId}#{item.idx}
                    </Mono>
                  </Link>
                  {item.tier !== null && (
                    <Badge tone="neutral">tier {item.tier}</Badge>
                  )}
                  {item.confidence !== null && (
                    <Badge tone="neutral">{item.confidence.toFixed(2)}</Badge>
                  )}
                  <DeliveryBadge delivery={item.delivery} />
                  {item.label && (
                    <Badge tone={item.label === "confirmed" ? "green" : "red"}>
                      {item.label}
                    </Badge>
                  )}
                  {item.retraction && (
                    <Badge tone="faint">retraction {item.retraction}</Badge>
                  )}
                  <span className="ml-auto text-[11px] text-faint">
                    {timeAgo(item.createdAt)}
                  </span>
                </div>

                <p
                  className={cx(
                    "mt-2 text-[13px] leading-relaxed",
                    item.label === "rejected" ? "text-faint line-through" : "text-body",
                  )}
                >
                  {item.concern}
                </p>
                {item.target && (
                  <Mono className="mt-1 block text-faint">{item.target}</Mono>
                )}

                <div className="mt-3">
                  {item.source === "gate" ? (
                    <AdvisoryActions
                      advisoryPk={item.pk}
                      delivery={item.delivery}
                      label={item.label}
                      path={path}
                    />
                  ) : (
                    <p className="text-[11px] text-faint">
                      Checkpoint findings are read-only until the intent
                      write-back channel lands.
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
