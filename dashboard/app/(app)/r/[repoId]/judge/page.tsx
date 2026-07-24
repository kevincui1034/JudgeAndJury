import { eq } from "drizzle-orm";

import {
  Badge,
  EmptyState,
  GlassPanel,
  Mono,
  PageHeader,
  PanelHeader,
  RankedRow,
  StatTile,
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

      {/* capability chips — computed CLI-side, no secrets uploaded */}
      {cfg && (
        <div className="flex flex-wrap gap-1.5 px-1">
          <Badge tone={caps.judge_provider ? "amber" : "faint"} mono>
            judge: {String(caps.judge_provider ?? "none")}
          </Badge>
          <Badge tone={caps.semantic ? "violet" : "faint"}>
            semantic recall {caps.semantic ? "on" : "off"}
          </Badge>
          <Badge tone={caps.conventions ? "amber" : "faint"}>
            conventions {caps.conventions ? "on" : "off"}
          </Badge>
          <Badge tone={caps.browser_qa ? "green" : "faint"}>
            browser QA {caps.browser_qa ? "configured" : "not configured"}
          </Badge>
          <span className="self-center text-[11px] text-faint">
            reported {timeAgo(cfg.reportedAt)}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Models served"
          value={String(servedModels.size)}
          tone="amber"
          sub="distinct models that answered"
        />
        <StatTile label="Judge calls" value={String(totalCalls || "—")} />
        <StatTile
          label="Judge spend"
          value={totalCalls ? `$${totalCost.toFixed(4)}` : "—"}
          sub={totalCalls && totalCost === 0 ? "credit-billed — no USD rate" : undefined}
        />
        <StatTile
          label="Training rows ready"
          value={String(tune.trainingRows)}
          tone="green"
          sub="labeled advisories + checkpoints"
        />
      </div>

      {/* ── Pioneer: the router made visible ── */}
      <GlassPanel>
        <PanelHeader
          title="Model"
          accent="routing"
          hint="Every request asks for the router; the record says which model actually answered. That mapping IS the routing decision."
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

      <div className="grid gap-3 xl:grid-cols-2">
        {/* ── cost ── */}
        <GlassPanel>
          <PanelHeader title="Cost" accent="by model" />
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
        </GlassPanel>

        {/* ── recall provenance ── */}
        <GlassPanel>
          <PanelHeader
            title="Recall"
            accent="provenance"
            hint="Priors are context, never authority — they can never short-circuit a verdict."
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
        </GlassPanel>
      </div>

      {/* ── Senso: cited conventions ── */}
      <GlassPanel>
        <PanelHeader
          title="Team"
          accent="conventions cited"
          hint="Authored policy the judge referenced, parsed back out of the stored prompt with its source citation."
        />
        {conventions.length === 0 ? (
          <EmptyState
            title="No conventions cited."
            hint="Enable [conventions] and point it at a knowledge base; cited statements then carry a [source: doc] tag into findings."
          />
        ) : (
          <div className="pb-2">
            {conventions.map((doc) => (
              <div
                key={doc.source}
                className="border-t border-line/70 px-5 py-3 first:border-t-0"
              >
                <Badge tone="amber" mono>
                  {doc.source}
                </Badge>
                <ul className="mt-2 space-y-1">
                  {doc.statements.map((s) => (
                    <li key={s} className="text-[12.5px] text-body">
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </GlassPanel>

      {/* ── Replay: browser QA ── */}
      <GlassPanel>
        <PanelHeader
          title="Browser"
          accent="QA"
          hint="The one sponsor-backed check that can fail the gate — from a recorded exit code and a worktree digest, never model output."
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
            <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
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
