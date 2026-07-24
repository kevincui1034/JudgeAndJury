/**
 * Derived highlights for the overview overlay cards and sparklines.
 *
 * Kept separate from the ported `overview.ts` so that file stays verbatim
 * against its Vitest coverage. Everything here is repo-scoped by repoPk,
 * which the page has already resolved through requireRepo().
 */
import { sql } from "drizzle-orm";

import { db } from "@/db";

export interface BucketPoint {
  bucket: string; // ISO instant at the bucket start
  passed: number;
  blocked: number;
}

/**
 * Verdicts over time, bucketed by HOUR when the repo's history is short
 * and by DAY otherwise.
 *
 * A day-bucketed chart of a demo (or a first afternoon of real use)
 * collapses to a single point and reads as broken. The CLI writes
 * `created_at` at second precision, so hourly buckets are always
 * available — this only changes how they are grouped for display.
 */
export type BucketUnit = "minute" | "hour" | "day";

export async function verdictBuckets(
  repoPk: string,
): Promise<{ points: BucketPoint[]; unit: BucketUnit }> {
  const span = await db.execute(sql`
    SELECT extract(epoch FROM (max(created_at) - min(created_at)))::float8 AS secs
    FROM records WHERE repo_pk = ${repoPk}
  `);
  const secs = Number((span.rows[0] as { secs: number | null })?.secs ?? 0);
  const unit: BucketUnit =
    secs <= 2 * 3600 ? "minute" : secs <= 2 * 24 * 3600 ? "hour" : "day";

  const result = await db.execute(sql`
    SELECT date_trunc(${unit}, created_at) AS bucket,
           count(*) FILTER (WHERE gate_passed)     AS passed,
           count(*) FILTER (WHERE NOT gate_passed) AS blocked
    FROM records WHERE repo_pk = ${repoPk}
    GROUP BY 1 ORDER BY 1
  `);
  const points = (
    result.rows as { bucket: string; passed: string; blocked: string }[]
  ).map((row) => ({
    bucket: new Date(row.bucket).toISOString(),
    passed: Number(row.passed),
    blocked: Number(row.blocked),
  }));
  return { points, unit };
}

export interface LastBlock {
  recordId: string;
  createdAt: Date;
  failureClasses: string[];
  action: string;
}

export async function lastBlock(repoPk: string): Promise<LastBlock | null> {
  const result = await db.execute(sql`
    SELECT record_id, created_at, failure_classes, action
    FROM records
    WHERE repo_pk = ${repoPk} AND NOT gate_passed
    ORDER BY created_at DESC, pk DESC
    LIMIT 1
  `);
  const row = result.rows[0] as
    | { record_id: string; created_at: string; failure_classes: string[]; action: string }
    | undefined;
  if (!row) return null;
  return {
    recordId: row.record_id,
    createdAt: new Date(row.created_at),
    failureClasses: row.failure_classes ?? [],
    action: row.action,
  };
}

/** Advisory findings waiting on a human decision (delivery = "held"). */
export async function heldAdvisoryCount(repoPk: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT count(*)::int AS n FROM advisories
    WHERE repo_pk = ${repoPk} AND delivery = 'held' AND label IS NULL
  `);
  return (result.rows[0] as { n: number }).n;
}

export interface ModelServed {
  model: string;
  calls: number;
}

/**
 * Which models actually answered, across every judge surface.
 *
 * Pioneer namespaces the served model as `pioneer/<model>` while the
 * REQUEST is always `Pioneer/Auto`, so counting distinct served ids is a
 * direct readout of the router's per-prompt choices — no inference.
 */
export async function modelsServed(repoPk: string): Promise<ModelServed[]> {
  const result = await db.execute(sql`
    SELECT model, count(*)::int AS calls FROM (
      SELECT judge_model_id AS model FROM records
        WHERE repo_pk = ${repoPk} AND judge_model_id IS NOT NULL
          AND judge_model_id <> '' AND judge_model_id <> 'none'
      UNION ALL
      SELECT judge_model_id AS model FROM advisories
        WHERE repo_pk = ${repoPk} AND judge_model_id IS NOT NULL
          AND judge_model_id <> ''
    ) t
    GROUP BY model ORDER BY calls DESC, model
  `);
  return (result.rows as { model: string; calls: number }[]).map((r) => ({
    model: r.model,
    calls: Number(r.calls),
  }));
}

export interface RecentTrace {
  recordId: string;
  createdAt: Date;
  action: string;
  agentSource: string;
  gatePassed: boolean;
  failureClasses: string[];
  recalledFrom: string | null;
  advisoryCount: number;
}

export async function recentTraces(
  repoPk: string,
  limit = 8,
): Promise<RecentTrace[]> {
  const result = await db.execute(sql`
    SELECT r.record_id, r.created_at, r.action, r.agent_source, r.gate_passed,
           r.failure_classes, r.recalled_from,
           (SELECT count(*)::int FROM advisories a WHERE a.record_pk = r.pk) AS advisory_count
    FROM records r
    WHERE r.repo_pk = ${repoPk}
    ORDER BY r.created_at DESC, r.pk DESC
    LIMIT ${limit}
  `);
  return (
    result.rows as {
      record_id: string;
      created_at: string;
      action: string;
      agent_source: string;
      gate_passed: boolean;
      failure_classes: string[];
      recalled_from: string | null;
      advisory_count: number;
    }[]
  ).map((r) => ({
    recordId: r.record_id,
    createdAt: new Date(r.created_at),
    action: r.action,
    agentSource: r.agent_source,
    gatePassed: r.gate_passed,
    failureClasses: r.failure_classes ?? [],
    recalledFrom: r.recalled_from,
    advisoryCount: Number(r.advisory_count),
  }));
}

/** Per-failure-class label counts — the CLI's `class_reliability`. */
export interface ClassReliability {
  name: string;
  total: number;
  accepted: number;
  falsePositive: number;
  noisy: boolean;
}

export async function classReliability(
  repoPk: string,
): Promise<ClassReliability[]> {
  const result = await db.execute(sql`
    SELECT unnest(failure_classes) AS name,
           count(*)::int AS total,
           count(*) FILTER (WHERE resolution_status = 'accepted')::int AS accepted,
           count(*) FILTER (WHERE resolution_status = 'false_positive')::int AS false_positive
    FROM records
    WHERE repo_pk = ${repoPk} AND NOT gate_passed
    GROUP BY 1 ORDER BY 2 DESC, 1
  `);
  return (
    result.rows as {
      name: string;
      total: number;
      accepted: number;
      false_positive: number;
    }[]
  ).map((r) => {
    const accepted = Number(r.accepted);
    const falsePositive = Number(r.false_positive);
    return {
      name: r.name,
      total: Number(r.total),
      accepted,
      falsePositive,
      // Mirrors recall.py: >= 2 false positives AND more of them than accepted.
      noisy: falsePositive >= 2 && falsePositive > accepted,
    };
  });
}
