import Link from "next/link";

import {
  EmptyState,
  GlassPanel,
  Mono,
  PanelHeader,
  pct,
  timeAgo,
} from "@/components/ui/primitives";
import { listRepos } from "@/lib/queries/traces";
import { requireUser } from "@/lib/repo";

export default async function ReposPage() {
  const user = await requireUser();
  const repos = await listRepos(user.id!);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 py-6">
      <div className="px-1">
        <h1 className="text-[34px] leading-none font-medium tracking-tight text-ink">
          Connected <span className="text-amber-ink">repos</span>
        </h1>
        <p className="mt-2 text-[13px] text-faint">
          Every gate run your coding agent triggers, as a trace.
        </p>
      </div>

      <GlassPanel>
        <PanelHeader title="Repos" accent={`(${repos.length})`} />
        {repos.length === 0 ? (
          <EmptyState
            title="No repos connected."
            hint="Run `proofjury connect` in a repo, approve the device code, then `proofjury sync`."
            action={
              <code className="glass-flat rounded-lg px-3 py-1.5 font-mono text-[12px] text-body">
                proofjury connect
              </code>
            }
          />
        ) : (
          <div className="pb-2">
            {repos.map((r) => (
              <Link
                key={r.id}
                href={`/r/${r.id}`}
                className="flex items-center gap-4 border-t border-line/70 px-5 py-3.5 transition-colors first:border-t-0 hover:bg-tint"
              >
                <div className="min-w-0 flex-1">
                  <Mono className="text-[13px] text-ink">{r.repoSlug}</Mono>
                  <p className="mt-1 text-[11px] text-faint">
                    {r.recordCount} run{r.recordCount === 1 ? "" : "s"} · last{" "}
                    {timeAgo(r.lastActivity)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="tnum text-[15px] text-ink">
                    {r.passRate === null ? "—" : pct(Number(r.passRate))}
                  </p>
                  <p className="text-[10px] tracking-wide text-faint uppercase">
                    pass rate
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
