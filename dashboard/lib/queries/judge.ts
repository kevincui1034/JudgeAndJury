/**
 * Judge-surface reads: which models answered, what they cost, which
 * authored conventions were cited, and what browser-QA evidence exists.
 *
 * Everything here reads text the CLI already stored. Nothing calls a
 * model and nothing analyses user code — "their agent computes, we
 * visualize".
 */
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { parseConventions, replayLinks } from "@/lib/conventions";

export interface SurfaceModel {
  surface: string;
  model: string;
  calls: number;
}

/**
 * Which model actually answered, per judge surface.
 *
 * Pioneer namespaces the served model as `pioneer/<model>` while the
 * REQUEST is always `Pioneer/Auto`, so counting served ids per surface is
 * a direct readout of the router's per-prompt choices — not an inference.
 */
export async function modelsBySurface(repoPk: string): Promise<SurfaceModel[]> {
  const result = await db.execute(sql`
    SELECT surface, model, count(*)::int AS calls FROM (
      SELECT 'gate diagnosis' AS surface, judge_model_id AS model
        FROM records WHERE repo_pk = ${repoPk}
          AND judge_model_id IS NOT NULL AND judge_model_id NOT IN ('', 'none')
      UNION ALL
      SELECT 'advisory review', judge_model_id
        FROM advisories WHERE repo_pk = ${repoPk}
          AND judge_model_id IS NOT NULL AND judge_model_id <> ''
      UNION ALL
      SELECT 'intent reviewer', review_model_id
        FROM checkpoints WHERE repo_pk = ${repoPk}
          AND review_model_id IS NOT NULL AND review_model_id <> ''
      UNION ALL
      SELECT 'correction classifier', classified_by
        FROM checkpoints WHERE repo_pk = ${repoPk}
          AND classified_by IS NOT NULL AND classified_by <> ''
    ) t
    GROUP BY 1, 2 ORDER BY 3 DESC, 1, 2
  `);
  return (result.rows as { surface: string; model: string; calls: number }[]).map(
    (r) => ({ surface: r.surface, model: r.model, calls: Number(r.calls) }),
  );
}

export async function costByModel(repoPk: string) {
  const result = await db.execute(sql`
    SELECT model, count(*)::int AS calls, coalesce(sum(cost_usd), 0)::float8 AS cost
    FROM ledger_entries WHERE repo_pk = ${repoPk}
    GROUP BY 1 ORDER BY 3 DESC, 1
  `);
  return (result.rows as { model: string; calls: number; cost: number }[]).map(
    (r) => ({ model: r.model, calls: Number(r.calls), cost: Number(r.cost) }),
  );
}

/** Conventions cited across stored advisory prompts, ranked by document. */
export async function citedConventions(repoPk: string) {
  const result = await db.execute(sql`
    SELECT data->>'advisory_input' AS prompt
    FROM records
    WHERE repo_pk = ${repoPk} AND data->>'advisory_input' <> ''
  `);
  const byDoc = new Map<string, { source: string; statements: Set<string> }>();
  for (const row of result.rows as { prompt: string }[]) {
    for (const c of parseConventions(row.prompt)) {
      const key = c.source ?? "(uncited)";
      const slot = byDoc.get(key) ?? { source: key, statements: new Set<string>() };
      slot.statements.add(c.statement);
      byDoc.set(key, slot);
    }
  }
  return Array.from(byDoc.values())
    .map((d) => ({ source: d.source, statements: [...d.statements] }))
    .sort((a, b) => b.statements.length - a.statements.length);
}

/** Browser-QA evidence: recordings and the QA verdict per record. */
export async function browserQa(repoPk: string) {
  const result = await db.execute(sql`
    SELECT record_id, created_at, gate_passed, data->'checks' AS checks
    FROM records
    WHERE repo_pk = ${repoPk}
      AND (failure_classes && ARRAY['browser_qa_failed','browser_qa_not_run']
           OR data::text LIKE '%app.replay.io%')
    ORDER BY created_at DESC LIMIT 25
  `);
  return (
    result.rows as {
      record_id: string;
      created_at: string;
      gate_passed: boolean;
      checks: { name: string; passed: boolean; failure_class?: string; evidence?: string }[];
    }[]
  ).map((r) => {
    const qa = (r.checks ?? []).find((c) => c.name === "browser_qa");
    return {
      recordId: r.record_id,
      createdAt: new Date(r.created_at),
      failureClass: qa?.failure_class ?? null,
      evidence: qa?.evidence ?? "",
      recordings: replayLinks(qa?.evidence),
    };
  });
}

/**
 * Fine-tune readiness, computed from the DB.
 *
 * Deliberately NOT a server-side dataset build: memory/finetune.py pairs
 * prompts with confirmed findings using ADVISORY_SYSTEM_PROMPT, and
 * duplicating that prompt in TS would guarantee drift. The dashboard
 * reports how much labeled signal exists; the CLI builds the corpus.
 */
export async function finetuneReadiness(repoPk: string) {
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM records
        WHERE repo_pk = ${repoPk}
          AND resolution_status IN ('accepted','false_positive','confirmed')) AS labeled_records,
      (SELECT count(*)::int FROM advisories
        WHERE repo_pk = ${repoPk} AND label IS NOT NULL) AS labeled_advisories,
      (SELECT count(*)::int FROM checkpoints
        WHERE repo_pk = ${repoPk}
          AND outcome_label IN ('corrected','accepted_implicit')) AS labeled_checkpoints
  `);
  const row = result.rows[0] as {
    labeled_records: number;
    labeled_advisories: number;
    labeled_checkpoints: number;
  };
  return {
    labeledRecords: Number(row.labeled_records),
    labeledAdvisories: Number(row.labeled_advisories),
    labeledCheckpoints: Number(row.labeled_checkpoints),
    // finetune.py pairs advisories and checkpoints; records supply the
    // resolution labels that drive recall ranking.
    trainingRows: Number(row.labeled_advisories) + Number(row.labeled_checkpoints),
  };
}

/** Recall provenance: same-repo vs cross-repo, and how often it fires. */
export async function recallStats(repoPk: string) {
  const result = await db.execute(sql`
    SELECT count(*) FILTER (WHERE NOT gate_passed)::int AS blocked,
           count(*) FILTER (WHERE recalled_from IS NOT NULL)::int AS recalled,
           count(*) FILTER (WHERE recalled_from LIKE '%:%')::int AS cross_repo
    FROM records WHERE repo_pk = ${repoPk}
  `);
  const row = result.rows[0] as {
    blocked: number;
    recalled: number;
    cross_repo: number;
  };
  return {
    blocked: Number(row.blocked),
    recalled: Number(row.recalled),
    crossRepo: Number(row.cross_repo),
    sameRepo: Number(row.recalled) - Number(row.cross_repo),
  };
}
