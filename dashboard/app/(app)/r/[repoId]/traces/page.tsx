import Link from "next/link";

import { ArchiveButton } from "@/components/ArchiveButton";
import {
  Badge,
  ClassChip,
  cx,
  EmptyState,
  GlassPanel,
  Mono,
  PageHeader,
  timeAgo,
  VerdictBadge,
} from "@/components/ui/primitives";
import {
  archivedTraceCount,
  listTraces,
  traceFacets,
} from "@/lib/queries/traces";
import { requireRepo } from "@/lib/repo";

interface Search {
  verdict?: string;
  action?: string;
  failureClass?: string;
  agent?: string;
  /** "1" = show the archived traces instead of the live ones. */
  archived?: string;
}

function Pill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "rounded-full border px-3 py-1 text-[12px] transition-colors",
        active
          ? "border-amber/40 bg-amber/12 text-amber-ink"
          : "border-glass-border text-body hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}

export default async function TracesPage({
  params,
  searchParams,
}: {
  params: Promise<{ repoId: string }>;
  searchParams: Promise<Search>;
}) {
  const { repoId } = await params;
  const sp = await searchParams;
  const { repo } = await requireRepo(repoId);
  const archived = sp.archived === "1";

  const [rows, facets, archivedCount] = await Promise.all([
    listTraces(repo.id, {
      verdict:
        sp.verdict === "passed" || sp.verdict === "blocked"
          ? sp.verdict
          : undefined,
      action: sp.action,
      failureClass: sp.failureClass,
      agent: sp.agent,
      archived,
    }),
    traceFacets(repo.id, archived),
    archivedTraceCount(repo.id),
  ]);

  const base = `/r/${repoId}/traces`;
  const q = (patch: Search) => {
    const merged = { ...sp, ...patch };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `${base}?${s}` : base;
  };

  return (
    <div className="space-y-4 pb-2">
      <PageHeader
        title="Gate"
        accent="traces"
        sub={
          archived ? (
            <>
              Traces you moved out of the main list. Each one is kept in full —
              the record, its evidence and its verdict are unchanged.
            </>
          ) : (
            <>
              Every intercepted command, with the evidence behind its verdict.
            </>
          )
        }
      />

      <GlassPanel>
        <div className="flex flex-wrap items-center gap-1.5 px-5 pt-4 pb-3">
          <Pill href={q({ verdict: undefined })} active={!sp.verdict}>
            All
          </Pill>
          <Pill href={q({ verdict: "blocked" })} active={sp.verdict === "blocked"}>
            Blocked
          </Pill>
          <Pill href={q({ verdict: "passed" })} active={sp.verdict === "passed"}>
            Passed
          </Pill>
          <span className="mx-2 h-4 w-px bg-line" />
          <Pill href={q({ archived: archived ? undefined : "1" })} active={archived}>
            Archived{archivedCount > 0 && ` · ${archivedCount}`}
          </Pill>
          {facets.failureClasses.length > 0 && (
            <span className="mx-2 h-4 w-px bg-line" />
          )}
          {facets.failureClasses.slice(0, 6).map((c) => (
            <Pill
              key={c}
              href={q({ failureClass: sp.failureClass === c ? undefined : c })}
              active={sp.failureClass === c}
            >
              {c}
            </Pill>
          ))}
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title={archived ? "Nothing archived here." : "No traces match."}
            hint={
              archived
                ? "Archiving a trace moves it here and leaves the record untouched."
                : "Clear the filters, or run the gate and sync."
            }
          />
        ) : (
          <div className="pb-2">
            {rows.map((t) => (
              <div
                key={t.pk}
                className={cx(
                  "flex items-center gap-3 border-t border-line/70 pr-4 pl-5 transition-colors first:border-t-0 hover:bg-tint",
                  t.archivedAt && "opacity-55",
                )}
              >
                <Link
                  href={`${base}/${t.recordId}`}
                  className="flex min-w-0 flex-1 items-center gap-3 py-3"
                >
                  <Mono className="w-16 shrink-0 text-body">{t.recordId}</Mono>
                  <VerdictBadge passed={t.gatePassed} />
                  <span className="w-16 shrink-0 text-[12px] text-faint">
                    {t.action}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                    {t.archivedAt && <Badge tone="faint">archived</Badge>}
                    {t.failureClasses.slice(0, 4).map((c) => (
                      <ClassChip key={c} name={c} />
                    ))}
                    {t.recalledFrom && (
                      <Badge tone="violet" mono>
                        ↩ {t.recalledFrom}
                      </Badge>
                    )}
                    {Number(t.advisoryCount) > 0 && (
                      <Badge tone="amber">{t.advisoryCount} advisory</Badge>
                    )}
                    {t.resolutionStatus && (
                      <Badge
                        tone={
                          t.resolutionStatus === "false_positive"
                            ? "red"
                            : "green"
                        }
                      >
                        {t.resolutionStatus}
                      </Badge>
                    )}
                  </div>
                  <span className="shrink-0 text-[11px] text-faint">
                    {t.agentSource}
                  </span>
                  <span className="w-16 shrink-0 text-right text-[11px] text-faint">
                    {timeAgo(t.createdAt)}
                  </span>
                </Link>
                <ArchiveButton
                  repoId={repoId}
                  recordId={t.recordId}
                  path={base}
                  archived={Boolean(t.archivedAt)}
                  className="shrink-0"
                />
              </div>
            ))}
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
