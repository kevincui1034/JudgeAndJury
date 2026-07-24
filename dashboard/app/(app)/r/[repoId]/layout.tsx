import { NavRail } from "@/components/ui/NavRail";
import { requireRepo } from "@/lib/repo";

export default async function RepoLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  const { repo } = await requireRepo(repoId);
  const base = `/r/${repoId}`;

  return (
    <>
      <NavRail
        groups={[
          {
            title: "Gate",
            items: [
              { href: base, label: "Overview", glyph: "◈" },
              { href: `${base}/traces`, label: "Traces", glyph: "≡" },
            ],
          },
          {
            title: "The loop",
            items: [
              {
                href: `${base}/loop`,
                label: "Judge ↔ Agent",
                glyph: "⇄",
                hint: "Everything the judge told your coding agent",
              },
              { href: `${base}/intent`, label: "Checkpoints", glyph: "◷" },
              { href: `${base}/prefs`, label: "Preferences", glyph: "★" },
            ],
          },
          {
            title: "Research",
            items: [
              { href: `${base}/memory`, label: "Memory", glyph: "⟲" },
              { href: `${base}/judge`, label: "Judge & models", glyph: "⚖" },
              { href: `${base}/config`, label: "Gate config", glyph: "⚙" },
            ],
          },
        ]}
        footer={
          <div className="glass-flat rounded-xl px-3 py-2.5">
            <p className="truncate font-mono text-[11px] text-body">
              {repo.repoSlug}
            </p>
            <p className="mt-0.5 text-[10px] text-faint">connected repo</p>
          </div>
        }
      />
      <main className="min-w-0 flex-1">{children}</main>
    </>
  );
}
