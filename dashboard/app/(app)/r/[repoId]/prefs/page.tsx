import { BookMarked } from "lucide-react";

import {
  Badge,
  EmptyState,
  GlassPanel,
  Mono,
  PageHeader,
  PanelHeader,
  Stat,
  StatStrip,
  timeAgo,
} from "@/components/ui/primitives";
import { listPreferences } from "@/lib/queries/intent";
import { requireRepo } from "@/lib/repo";

const STATUS_TONE = {
  active: "green",
  candidate: "amber",
  rejected: "faint",
} as const;

export default async function PrefsPage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  const { repo, user } = await requireRepo(repoId);
  const prefs = await listPreferences(repo.id, user.id!);

  const active = prefs.filter((p) => p.status === "active").length;
  const candidates = prefs.filter((p) => p.status === "candidate").length;
  const rejected = prefs.filter((p) => p.status === "rejected").length;

  return (
    <div className="space-y-4 pb-2">
      <PageHeader
        title="Learned"
        accent="preferences"
        sub={
          <>
            Distilled from repeated corrections. Only <em>active</em>{" "}
          preferences are injected at session start — a candidate waits for a
          human, because a preference the agent follows forever should not be
          created by a classifier alone.
          </>
        }
      />

      {prefs.length > 0 && (
        <StatStrip cols={3}>
          <Stat
            label="Active"
            value={String(active)}
            tone="green"
            sub="injected at session start"
          />
          <Stat
            label="Candidates"
            value={String(candidates)}
            tone={candidates > 0 ? "amber" : "neutral"}
            sub="waiting on you"
          />
          <Stat label="Rejected" value={String(rejected)} sub="never injected" />
        </StatStrip>
      )}

      <GlassPanel>
        <PanelHeader
          title="Preferences"
          accent={`(${prefs.length})`}
          icon={BookMarked}
        />
        {prefs.length === 0 ? (
          <EmptyState
            title="No preferences yet."
            hint="Three corrections sharing a category graduate into a candidate. Sync after some agent work to see them here."
          />
        ) : (
          <div className="pb-2">
            {prefs.map((p) => (
              <div
                key={p.pk}
                className="border-t border-line/70 px-5 py-3.5 first:border-t-0"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Mono className="text-faint">{p.prefId}</Mono>
                  <Badge
                    tone={
                      STATUS_TONE[p.status as keyof typeof STATUS_TONE] ??
                      "neutral"
                    }
                  >
                    {p.status}
                  </Badge>
                  <Badge tone="neutral">{p.scope} scope</Badge>
                  {p.category && <Badge tone="violet">{p.category}</Badge>}
                  <span className="ml-auto text-[11px] text-faint">
                    {timeAgo(p.updatedAt)}
                  </span>
                </div>
                <p className="mt-1.5 text-[13px] text-body">{p.statement}</p>
                {p.evidence.length > 0 && (
                  <p className="mt-1 text-[11px] text-faint">
                    from {p.evidence.join(", ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
