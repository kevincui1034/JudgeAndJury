/** Intent-pillar reads: checkpoints, findings, preferences, the loop feed. */
import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  advisories,
  checkpoints,
  intentFindings,
  preferences,
} from "@/db/schema";

export async function listCheckpoints(repoPk: string, limit = 40) {
  return db
    .select({
      pk: checkpoints.pk,
      checkpointId: checkpoints.checkpointId,
      createdAt: checkpoints.createdAt,
      event: checkpoints.event,
      task: checkpoints.task,
      changedFiles: checkpoints.changedFiles,
      diffLines: checkpoints.diffLines,
      outcomeLabel: checkpoints.outcomeLabel,
      outcomeCategory: checkpoints.outcomeCategory,
      outcomeStatement: checkpoints.outcomeStatement,
      reviewModelId: checkpoints.reviewModelId,
      classifiedBy: checkpoints.classifiedBy,
      findingCount: sql<number>`(
        SELECT count(*)::int FROM intent_findings f
        WHERE f.checkpoint_pk = ${checkpoints.pk})`,
    })
    .from(checkpoints)
    .where(eq(checkpoints.repoPk, repoPk))
    .orderBy(desc(checkpoints.createdAt))
    .limit(limit);
}

export async function intentStats(repoPk: string) {
  const result = await db.execute(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE outcome_label = 'corrected')::int AS corrected,
           count(*) FILTER (WHERE outcome_label = 'accepted_implicit')::int AS accepted,
           count(*) FILTER (WHERE outcome_label IS NULL)::int AS unlabeled,
           coalesce(sum(diff_lines), 0)::int AS diff_lines
    FROM checkpoints WHERE repo_pk = ${repoPk}
  `);
  const row = result.rows[0] as {
    total: number;
    corrected: number;
    accepted: number;
    unlabeled: number;
    diff_lines: number;
  };
  const judged = row.corrected + row.accepted;
  return {
    total: row.total,
    corrected: row.corrected,
    accepted: row.accepted,
    unlabeled: row.unlabeled,
    diffLines: row.diff_lines,
    // What fraction of the agent's claimed-done work the user pushed back on.
    correctionRate: judged > 0 ? row.corrected / judged : null,
  };
}

export async function correctionsByCategory(repoPk: string) {
  const result = await db.execute(sql`
    SELECT outcome_category AS category, count(*)::int AS n
    FROM checkpoints
    WHERE repo_pk = ${repoPk} AND outcome_label = 'corrected'
      AND outcome_category IS NOT NULL AND outcome_category <> ''
    GROUP BY 1 ORDER BY 2 DESC, 1
  `);
  return (result.rows as { category: string; n: number }[]).map((r) => ({
    category: r.category,
    count: Number(r.n),
  }));
}

export async function listPreferences(repoPk: string, userId: string) {
  return db
    .select()
    .from(preferences)
    .where(
      sql`(${preferences.repoPk} = ${repoPk} OR (${preferences.scope} = 'user' AND ${preferences.userId} = ${userId}))`,
    )
    .orderBy(desc(preferences.updatedAt));
}

/**
 * The loop feed: everything the judge said to the agent, newest first —
 * gate advisories and checkpoint intent findings interleaved. These are
 * two different surfaces in the CLI but one conversation to a human.
 */
export interface LoopItem {
  source: "gate" | "checkpoint";
  pk: string;
  parentId: string; // chk_012 | ckpt_007
  idx: number;
  concern: string;
  tier: number | null;
  confidence: number | null;
  target: string | null;
  delivery: string;
  label: string | null;
  retraction: string | null;
  createdAt: Date;
}

export async function loopFeed(repoPk: string, limit = 60): Promise<LoopItem[]> {
  const [gate, intent] = await Promise.all([
    db
      .select()
      .from(advisories)
      .where(eq(advisories.repoPk, repoPk))
      .orderBy(desc(advisories.createdAt))
      .limit(limit),
    db
      .select()
      .from(intentFindings)
      .where(eq(intentFindings.repoPk, repoPk))
      .orderBy(desc(intentFindings.createdAt))
      .limit(limit),
  ]);

  const items: LoopItem[] = [
    ...gate.map((a) => ({
      source: "gate" as const,
      pk: a.pk,
      parentId: a.recordId,
      idx: a.idx,
      concern: a.concern,
      tier: a.tier,
      confidence: a.confidence,
      target: a.target,
      delivery: a.delivery,
      label: a.label,
      retraction: a.retraction,
      createdAt: a.createdAt,
    })),
    ...intent.map((f) => ({
      source: "checkpoint" as const,
      pk: f.pk,
      parentId: f.checkpointId,
      idx: f.idx,
      concern: f.concern,
      tier: f.tier,
      confidence: f.confidence,
      target: f.target,
      delivery: f.delivery,
      label: f.label,
      retraction: null,
      createdAt: f.createdAt,
    })),
  ];
  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return items.slice(0, limit);
}

export async function getCheckpoint(repoPk: string, checkpointId: string) {
  const [row] = await db
    .select()
    .from(checkpoints)
    .where(
      and(
        eq(checkpoints.repoPk, repoPk),
        eq(checkpoints.checkpointId, checkpointId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const findings = await db
    .select()
    .from(intentFindings)
    .where(eq(intentFindings.checkpointPk, row.pk))
    .orderBy(intentFindings.idx);
  return { checkpoint: row, findings };
}
