import { RepoSwitcher } from "@/components/shell/RepoSwitcher";
import { NavRail } from "@/components/ui/NavRail";
import { LiveDot } from "@/components/ui/LiveDot";
import { listRepos } from "@/lib/queries/traces";
import { requireRepo } from "@/lib/repo";

export default async function RepoLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  const { user, repo } = await requireRepo(repoId);
  const repos = await listRepos(user.id!);
  const base = `/r/${repoId}`;

  return (
    <>
      <NavRail
        header={
          <RepoSwitcher
            current={{ id: repoId, repoSlug: repo.repoSlug }}
            repos={repos.map((r) => ({ id: r.id, repoSlug: r.repoSlug }))}
          />
        }
        groups={[
          {
            title: "Gate",
            items: [
              { href: base, label: "Overview", icon: "overview", exact: true },
              { href: `${base}/traces`, label: "Traces", icon: "traces" },
            ],
          },
          {
            title: "The loop",
            items: [
              {
                href: `${base}/loop`,
                label: "Judge ↔ Agent",
                icon: "loop",
                hint: "Everything the judge told your coding agent",
              },
              { href: `${base}/intent`, label: "Checkpoints", icon: "checkpoints" },
              { href: `${base}/prefs`, label: "Preferences", icon: "preferences" },
            ],
          },
          {
            title: "Research",
            items: [
              { href: `${base}/memory`, label: "Memory", icon: "memory" },
              { href: `${base}/judge`, label: "Judge & models", icon: "judge" },
              { href: `${base}/config`, label: "Gate config", icon: "config" },
            ],
          },
        ]}
        footer={
          /* LIVE-REFRESH INVARIANT: this is the ONE <LiveDot> mount for the
             whole app. It polls /api/live and calls router.refresh(), which
             is how every server-rendered panel updates without client state.
             Do not move it under a wrapper whose key changes, and do not
             render it in the mobile Sheet as well. */
          <div className="glass-flat flex items-center justify-between rounded-xl px-3 py-2">
            <span className="text-[10px] text-faint">Heartbeat</span>
            <LiveDot repoId={repo.id} />
          </div>
        }
      />
      <main className="min-w-0 flex-1 px-4 pt-6 pb-16 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-[1400px]">{children}</div>
      </main>
    </>
  );
}
