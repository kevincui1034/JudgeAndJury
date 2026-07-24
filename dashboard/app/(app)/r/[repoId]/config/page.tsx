import { eq } from "drizzle-orm";

import { ConfigEditor } from "@/components/ConfigEditor";
import {
  Badge,
  GlassPanel,
  Mono,
  PanelHeader,
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
      <div className="px-1 pt-1">
        <h1 className="text-[34px] leading-none font-medium tracking-tight text-ink">
          Gate <span className="text-amber-ink">config</span>
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-faint">
          Tune what the judge advises. Changes queue here and are written to{" "}
          <Mono>.proofjury.toml</Mono> by your own machine on its next sync —
          the dashboard never writes the file. Nothing here can change a past
          verdict: records are immutable, config feeds future runs only.
        </p>
      </div>

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

      {queued.length > 0 && (
        <GlassPanel>
          <PanelHeader
            title="Queued"
            accent="changes"
            hint="Waiting for the next `proofjury sync` on the machine running this repo."
          />
          <div className="pb-2">
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
                  <span className="text-[11px] text-faint">
                    {timeAgo(q.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>
        </GlassPanel>
      )}

      {CONFIG_TABLES.map((spec) => (
        <GlassPanel key={spec.table}>
          <ConfigEditor
            spec={spec}
            current={effective[spec.table] ?? {}}
            repoId={repoId}
          />
        </GlassPanel>
      ))}

      <GlassPanel>
        <PanelHeader
          title="Local"
          accent="only"
          hint="These decide whether and how the gate runs, so they are never remotely editable — a stolen dashboard session must not be able to weaken the gate."
        />
        <div className="flex flex-wrap gap-1.5 px-5 pb-5">
          {[...LOCAL_ONLY_TABLES].sort().map((t) => (
            <Badge key={t} tone="faint" mono>
              [{t}]
            </Badge>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}
