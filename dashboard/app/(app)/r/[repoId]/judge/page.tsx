import { eq } from "drizzle-orm";
import { Activity, CircleDollarSign, Cpu, Layers, Plug } from "lucide-react";

import { FinetuneButton } from "@/components/FinetuneButton";
import {
  AuthorityBadge,
  SponsorMark,
  SponsorTag,
} from "@/components/sponsors/SponsorMark";
import {
  Badge,
  EmptyState,
  GlassPanel,
  Mono,
  PageHeader,
  PanelHeader,
  RankedRow,
  SplitPanel,
  Stat,
  StatStrip,
  timeAgo,
} from "@/components/ui/primitives";
import { db } from "@/db";
import { repoConfigs } from "@/db/schema";
import {
  browserQa,
  citedConventions,
  costByModel,
  finetuneReadiness,
  modelsBySurface,
  recallStats,
} from "@/lib/queries/judge";
import { requireRepo } from "@/lib/repo";
import { resolveSensoDoc, SENSO_DOCS } from "@/lib/senso-docs";
import { SPONSORS, SPONSOR_LIST, type Sponsor } from "@/lib/sponsors";

export default async function JudgePage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  const { repo } = await requireRepo(repoId);

  const [surfaces, costs, conventions, qa, tune, recall, [cfg]] =
    await Promise.all([
      modelsBySurface(repo.id),
      costByModel(repo.id),
      citedConventions(repo.id),
      browserQa(repo.id),
      finetuneReadiness(repo.id),
      recallStats(repo.id),
      db
        .select()
        .from(repoConfigs)
        .where(eq(repoConfigs.repoPk, repo.id))
        .limit(1),
    ]);

  const caps = (cfg?.capabilities ?? {}) as Record<string, unknown>;
  const totalCost = costs.reduce((n, c) => n + c.cost, 0);
  const totalCalls = costs.reduce((n, c) => n + c.calls, 0);
  const servedModels = new Set(surfaces.map((s) => s.model));
  const maxCost = costs[0]?.cost || 1;

  /**
   * Fold the cited `[source: …]` tags onto the published documents.
   *
   * Citations are free text produced upstream, so a tag that resolves to
   * nothing known is NOT dropped — it lands in `unresolvedCitations` and
   * renders with its raw source. Hiding it would hide a real citation.
   */
  const citedBySlug = new Map<string, string[]>();
  const unresolvedCitations: { source: string; statements: string[] }[] = [];
  for (const row of conventions) {
    const doc = resolveSensoDoc(row.source);
    if (!doc) {
      unresolvedCitations.push(row);
      continue;
    }
    const seen = citedBySlug.get(doc.slug) ?? [];
    for (const s of row.statements) if (!seen.includes(s)) seen.push(s);
    citedBySlug.set(doc.slug, seen);
  }
  const citedDocs = SENSO_DOCS.filter((d) => citedBySlug.has(d.slug)).length;

  /**
   * The value the CLI reported for a sponsor's capability. The registry's
   * capabilityKey is typed to the exact set emitted by _capabilities() in
   * cli/src/proofjury/sync.py, so no alias layer is needed — if that ever
   * drifts, the union in lib/sponsors.ts is what should be corrected.
   */
  function capabilityValue(sponsor: Sponsor): unknown {
    const v = caps[sponsor.capabilityKey];
    if (v !== undefined && v !== null && v !== "" && v !== "none") return v;
    return undefined;
  }

  return (
    <div className="space-y-4 pb-2">
      <PageHeader
        title="Judge"
        accent="&amp; models"
        sub={
          <>
            Which model answered each judge surface, what it cost, and which
            authored policy it cited. All of it explains verdicts the
            deterministic checks already reached.
          </>
        }
      />

      {/* ── one surface, four readings of the same judge activity ── */}
      <StatStrip cols={4}>
        <Stat
          label="Models served"
          value={String(servedModels.size)}
          tone="amber"
          sub="distinct models that answered"
          icon={Cpu}
        />
        <Stat
          label="Judge calls"
          value={String(totalCalls || "—")}
          sub="ledger lines uploaded by the CLI"
          icon={Activity}
        />
        <Stat
          label="Judge spend"
          value={totalCalls ? `$${totalCost.toFixed(4)}` : "—"}
          sub={
            totalCalls && totalCost === 0
              ? "credit-billed — no USD rate"
              : undefined
          }
          icon={CircleDollarSign}
        />
        <Stat
          label="Training rows ready"
          value={String(tune.trainingRows)}
          tone="green"
          sub="labeled advisories + checkpoints"
          icon={Layers}
        />
      </StatStrip>

      {/* ── the four integrations, and what each is allowed to decide ──
          Configured state is computed CLI-side and uploaded as names and
          booleans only; no secret ever leaves the machine. */}
      <GlassPanel>
        <PanelHeader
          title="Integrations"
          accent="on this repo"
          icon={Plug}
          hint="What each partner surface contributes, where its output lands, and what it is allowed to decide."
          right={
            cfg ? (
              <span className="text-[11px] text-faint">
                reported {timeAgo(cfg.reportedAt)}
              </span>
            ) : (
              <Badge tone="faint">no config reported</Badge>
            )
          }
        />
        <div className="pb-2">
          {SPONSOR_LIST.map((s) => {
            const value = capabilityValue(s);
            const on = Boolean(value);
            // judge_provider reports a provider name, the rest report booleans.
            const detail = typeof value === "string" ? value : null;
            return (
              <div
                key={s.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line/70 px-5 py-3"
              >
                <SponsorMark sponsor={s} />
                <div className="w-40 min-w-0 shrink-0">
                  <p className="truncate text-[13px] text-ink">{s.name}</p>
                  <p className="truncate text-[11px] text-faint">{s.role}</p>
                </div>
                <AuthorityBadge sponsor={s} />
                <Badge tone={on ? "green" : "faint"}>
                  {on ? "configured" : "not configured"}
                </Badge>
                {detail && (
                  <Badge tone="amber" mono>
                    {detail}
                  </Badge>
                )}
                <span
                  className="min-w-0 flex-1 truncate text-right text-[11.5px] text-faint"
                  title={s.note}
                >
                  {s.surface}
                </span>
              </div>
            );
          })}
        </div>
        <p className="border-t border-line/70 px-5 py-3 text-[11.5px] leading-relaxed text-faint">
          Exactly one of these can fail the gate, and it does so from a recorded
          exit code and a worktree digest rather than model output. The rest are
          evidence, context, or transport — they shape how a verdict is
          explained, never what it is.
        </p>
      </GlassPanel>

      {/* ── Pioneer: the router made visible ── */}
      <GlassPanel>
        <PanelHeader
          title="Model"
          accent="routing"
          hint="Every request asks for the router; the record says which model actually answered. That mapping IS the routing decision."
          right={<SponsorTag sponsor={SPONSORS.pioneer} />}
        />
        {surfaces.length === 0 ? (
          <EmptyState
            title="No LLM calls recorded yet."
            hint="The judge is offline-first — with no key configured it writes deterministic diagnoses and nothing appears here."
          />
        ) : (
          <div className="pb-2">
            <div className="flex items-center gap-3 border-t border-line/70 px-5 py-2 text-[10px] tracking-wide text-faint uppercase">
              <span className="w-44">surface</span>
              <span className="flex-1">requested → served</span>
              <span>calls</span>
            </div>
            {surfaces.map((s) => (
              <div
                key={`${s.surface}:${s.model}`}
                className="flex items-center gap-3 border-t border-line/70 px-5 py-2.5"
              >
                <span className="w-44 shrink-0 text-[12.5px] text-body">
                  {s.surface}
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  {s.model.startsWith("deterministic/") ? (
                    // No model was requested at all — the offline judge ran.
                    // Printing a router name here would be a lie.
                    <>
                      <Mono className="text-faint">no LLM call</Mono>
                      <span className="text-faint">→</span>
                      <Mono className="truncate text-body">{s.model}</Mono>
                    </>
                  ) : (
                    <>
                      <Mono className="text-faint">
                        {String(caps.judge_model ?? "Pioneer/Auto")}
                      </Mono>
                      <span className="text-faint">→</span>
                      <Mono className="truncate text-amber-ink">{s.model}</Mono>
                    </>
                  )}
                </span>
                <span className="tnum shrink-0 text-[13px] text-ink">
                  {s.calls}
                </span>
              </div>
            ))}
          </div>
        )}
      </GlassPanel>

      {/* ── two readings of the same judge run: what it cost, what it recalled ── */}
      <SplitPanel>
        <div>
          <PanelHeader
            title="Cost"
            accent="by model"
            right={<SponsorTag sponsor={SPONSORS.pioneer} />}
          />
          {costs.length === 0 ? (
            <EmptyState
              title="No ledger entries yet."
              hint="The CLI appends one line per LLM call; they upload with the intent sync."
            />
          ) : (
            <div className="pb-2">
              {costs.map((c, i) => (
                <RankedRow
                  key={c.model}
                  rank={i + 1}
                  label={<Mono className="text-body">{c.model}</Mono>}
                  value={c.cost > 0 ? `$${c.cost.toFixed(4)}` : `${c.calls} calls`}
                  share={c.cost / maxCost}
                  tone="var(--amber)"
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <PanelHeader
            title="Recall"
            accent="provenance"
            hint="Priors are context, never authority — they can never short-circuit a verdict."
            right={<SponsorTag sponsor={SPONSORS.actian} />}
          />
          <div className="grid grid-cols-3 gap-3 px-5 pb-5">
            {[
              { label: "same-repo", value: recall.sameRepo, tone: "text-bot-violet" },
              { label: "cross-repo", value: recall.crossRepo, tone: "text-bot-teal" },
              { label: "no prior", value: Math.max(0, recall.blocked - recall.recalled), tone: "text-faint" },
            ].map((s) => (
              <div key={s.label} className="glass-flat rounded-xl px-3 py-3">
                <p className={`tnum text-[22px] leading-none ${s.tone}`}>
                  {s.value}
                </p>
                <p className="mt-1.5 text-[11px] text-faint">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </SplitPanel>

      {/* ── Senso: the published conventions, and which ones the judge cited ──
          The document list is the authored policy itself; the statements under
          each one are parsed back out of the stored prompt, so a row is only
          marked cited when a real [source: …] tag resolved to it. */}
      <GlassPanel>
        <PanelHeader
          title="Team"
          accent="conventions"
          hint="Policy this team published, and the statements the judge actually pulled from each document."
          right={
            <>
              <Badge tone={citedDocs ? "amber" : "faint"}>
                {citedDocs}/{SENSO_DOCS.length} cited
              </Badge>
              <SponsorTag sponsor={SPONSORS.senso} />
            </>
          }
        />

        <div>
          {SENSO_DOCS.map((doc) => {
            const statements = citedBySlug.get(doc.slug);
            return (
              <div
                key={doc.slug}
                className="border-t border-line/70 px-5 py-3.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                  <div className="min-w-0">
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13.5px] text-ink underline-offset-2 transition-colors hover:text-amber-ink hover:underline"
                    >
                      {doc.title} ↗
                    </a>
                    <p className="mt-0.5 max-w-2xl text-[11.5px] leading-relaxed text-faint">
                      {doc.summary}
                    </p>
                  </div>
                  <Badge tone={statements ? "amber" : "faint"}>
                    {statements
                      ? `cited · ${statements.length} statement${statements.length === 1 ? "" : "s"}`
                      : "not cited yet"}
                  </Badge>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Mono className="text-faint">[source: {doc.slug}]</Mono>
                  {doc.topics.map((t) => (
                    <Badge key={t} tone="faint">
                      {t}
                    </Badge>
                  ))}
                </div>

                {statements && (
                  <ul className="mt-2.5 space-y-1 border-l border-amber/30 pl-3">
                    {statements.map((s) => (
                      <li key={s} className="text-[12.5px] text-body">
                        {s}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        {/* A citation whose source is not one of the published documents is
            still a citation — render it verbatim rather than losing it. */}
        {unresolvedCitations.length > 0 && (
          <div className="border-t border-line/70 px-5 py-3.5">
            <p className="text-[10px] tracking-wide text-faint uppercase">
              cited, not a published document
            </p>
            <div className="mt-2 space-y-3">
              {unresolvedCitations.map((row) => (
                <div key={row.source}>
                  <Badge tone="amber" mono>
                    {row.source}
                  </Badge>
                  <ul className="mt-1.5 space-y-1">
                    {row.statements.map((s) => (
                      <li key={s} className="text-[12.5px] text-body">
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {conventions.length === 0 && (
          <EmptyState
            title="Nothing cited on this repo yet."
            hint="Enable [conventions] and point it at a knowledge base; cited statements then carry a [source: doc] tag into findings, and the documents above light up here."
          />
        )}

        <div className="flex items-start gap-2.5 border-t border-line/70 px-5 py-3">
          <SponsorMark sponsor={SPONSORS.senso} />
          <p className="text-[11.5px] leading-relaxed text-faint">
            <span className="text-body">{SPONSORS.senso.authority}.</span> A
            cited convention explains a verdict the deterministic checks already
            reached — it can never produce one, and no document above can change
            whether this repo&apos;s gate passed.
          </p>
        </div>
      </GlassPanel>

      {/* ── Replay: browser QA ── */}
      <GlassPanel>
        <PanelHeader
          title="Browser"
          accent="QA"
          hint="The one sponsor-backed check that can fail the gate — from a recorded exit code and a worktree digest, never model output."
          right={
            <>
              <AuthorityBadge sponsor={SPONSORS.replay} />
              <SponsorTag sponsor={SPONSORS.replay} />
            </>
          }
        />
        {qa.length === 0 ? (
          <EmptyState
            title="No browser-QA runs recorded."
            hint="Configure [commands] qa, then `proofjury run qa -- <cmd>`. Until then the check is skipped entirely."
          />
        ) : (
          <div className="pb-2">
            {qa.map((r) => (
              <div
                key={r.recordId}
                className="flex flex-wrap items-center gap-3 border-t border-line/70 px-5 py-3 first:border-t-0"
              >
                <Mono className="text-body">{r.recordId}</Mono>
                {r.failureClass ? (
                  <Badge tone="red" mono>
                    {r.failureClass}
                  </Badge>
                ) : (
                  <Badge tone="green">passed</Badge>
                )}
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">
                  {r.evidence}
                </span>
                {r.recordings.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="glass-flat rounded-lg px-2.5 py-1 text-[11.5px] text-amber-ink transition-colors hover:border-amber"
                  >
                    ▶ watch
                  </a>
                ))}
                <span className="text-[11px] text-faint">
                  {timeAgo(r.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </GlassPanel>

      {/* ── fine-tune readiness ── */}
      <GlassPanel>
        <PanelHeader
          title="Fine-tune"
          accent="readiness"
          hint="The dataset is built by the CLI from the same prompts it ran — duplicating those prompts here would guarantee drift."
        />
        <div className="grid gap-4 px-5 pb-5 md:grid-cols-2">
          <div className="space-y-1.5 text-[12.5px] text-body">
            <p>
              <span className="tnum text-ink">{tune.labeledAdvisories}</span>{" "}
              labeled advisories
            </p>
            <p>
              <span className="tnum text-ink">{tune.labeledCheckpoints}</span>{" "}
              labeled checkpoints
            </p>
            <p>
              <span className="tnum text-ink">{tune.labeledRecords}</span>{" "}
              resolved gate records
            </p>
            <p className="pt-1 text-[11.5px] text-faint">
              Every judge input is persisted verbatim beside the outcome you
              labeled, so the corpus is a projection of memory — not an ETL job.
            </p>
          </div>
          <div className="glass-flat rounded-xl px-4 py-3">
            <p className="text-[11px] text-faint">Build and submit locally:</p>
            <code className="mt-1.5 block font-mono text-[12px] text-amber-ink">
              proofjury memory finetune --dry-run
            </code>

            {/* Queueing writes a row the way a config change does; the
                machine that holds the prompts runs the job. */}
            <FinetuneButton
              repoId={repoId}
              path={`/r/${repoId}/judge`}
              trainingRows={tune.trainingRows}
            />

            <p className="mt-3 border-t border-line/70 pt-2.5 text-[11.5px] leading-relaxed text-faint">
              When the job completes, set{" "}
              <Mono>[advisory].model</Mono> to the returned job id on the Gate
              config page — a tuned model is just a model id, so adopting it is
              config, not code.
            </p>
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}
