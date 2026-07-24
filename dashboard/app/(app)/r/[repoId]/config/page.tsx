import { eq } from "drizzle-orm";
import { Clock, Lock, TriangleAlert } from "lucide-react";

import { ConfigEditor } from "@/components/ConfigEditor";
import {
  Badge,
  GlassPanel,
  Mono,
  PageHeader,
  PanelHeader,
  SplitPanel,
  timeAgo,
} from "@/components/ui/primitives";
import { db } from "@/db";
import { labelEvents, repoConfigs } from "@/db/schema";
import { CONFIG_TABLES, LOCAL_ONLY_TABLES } from "@/lib/config-schema";
import { requireRepo } from "@/lib/repo";
import { and, desc } from "drizzle-orm";

export default async function ConfigPage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  const { repo } = await requireRepo(repoId);

  const [[cfg], queued] = await Promise.all([
    db
      .select()
      .from(repoConfigs)
      .where(eq(repoConfigs.repoPk, repo.id))
      .limit(1),
    db
      .select()
      .from(labelEvents)
      .where(
        and(
          eq(labelEvents.repoPk, repo.id),
          eq(labelEvents.kind, "config_patch"),
        ),
      )
      .orderBy(desc(labelEvents.id))
      .limit(5),
  ]);

  const effective = (cfg?.effective ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const conflicts = (cfg?.conflicts ?? []) as Record<string, unknown>[];

  return (
    <div className="space-y-4 pb-2">
      <PageHeader
        title="Gate"
        accent="config"
        sub={
          <>
            Tune what the judge advises. Changes queue here and are written to{" "}
          <Mono>.proofjury.toml</Mono> by your own machine on its next sync —
          the dashboard never writes the file. Nothing here can change a past
          verdict: records are immutable, config feeds future runs only.
          </>
        }
      />

      {!cfg && (
        <GlassPanel>
          <div className="px-5 py-4">
            <p className="text-[13px] text-body">
              This repo hasn&apos;t reported its config yet.
            </p>
            <p className="mt-1 text-[12px] text-faint">
              Run <Mono>proofjury sync</Mono> — the CLI uploads{" "}
              <Mono>.proofjury.toml</Mono> alongside checkpoints. You can still
              queue changes; they apply when it does.
            </p>
          </div>
        </GlassPanel>
      )}

      {conflicts.length > 0 && (
        <GlassPanel className="verdict-block">
          <PanelHeader
            title="Conflicts"
            accent={`(${conflicts.length})`}
            icon={TriangleAlert}
            hint="Your local file changed after the dashboard read it, so the CLI refused these rather than clobbering the edit. Re-queue them."
          />
          <div className="px-5 pb-4 text-[12px] text-body">
            {conflicts.map((c, i) => (
              <p key={i} className="font-mono">
                [{String(c.table)}] — {String(c.reason)}
              </p>
            ))}
          </div>
        </GlassPanel>
      )}

      <SplitPanel>
        <div>
          <PanelHeader
            title="Queued"
            accent="changes"
            icon={Clock}
            hint="Waiting for the next `proofjury sync` on the machine running this repo."
          />
          {queued.length === 0 ? (
            <p className="px-5 pb-5 text-[12px] text-faint">
              Nothing queued. Changes you make below land here until the CLI
              picks them up.
            </p>
          ) : (
            <div className="pb-3">
              {queued.map((q) => {
                const p = q.payload as Record<string, unknown>;
                return (
                  <div
                    key={q.id}
                    className="flex items-center gap-3 border-t border-line/70 px-5 py-2.5 first:border-t-0"
                  >
                    <Badge tone="teal" mono>
                      [{String(p.table)}]
                    </Badge>
                    <Mono className="min-w-0 flex-1 truncate text-faint">
                      {JSON.stringify(p.set)}
                    </Mono>
                    <span className="shrink-0 text-[11px] text-faint">
                      {timeAgo(q.createdAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <PanelHeader
            title="Local"
            accent="only"
            icon={Lock}
            hint="These decide whether and how the gate runs, so they are never remotely editable — a stolen dashboard session must not be able to weaken the gate."
          />
          <div className="flex flex-wrap gap-1.5 px-5 pb-5">
            {[...LOCAL_ONLY_TABLES].sort().map((t) => (
              <Badge key={t} tone="faint" mono>
                [{t}]
              </Badge>
            ))}
          </div>
        </div>
      </SplitPanel>

      {/* One surface, hairline-divided per table — seven floating cards read as
          seven unrelated settings screens when they are one config file. */}
      <GlassPanel className="divide-y divide-line overflow-hidden">
        {CONFIG_TABLES.map((spec) => (
          <ConfigEditor
            key={spec.table}
            spec={spec}
            current={effective[spec.table] ?? {}}
            repoId={repoId}
          />
        ))}
      </GlassPanel>
    </div>
  );
}
