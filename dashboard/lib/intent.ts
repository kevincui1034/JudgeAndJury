/**
 * Intent-pillar ingest: checkpoints, learned preferences, the cost ledger,
 * and the repo's reported gate config — one request for the whole pillar.
 *
 * Checkpoints are high-volume and prefs/ledger are tiny, so batching them
 * into a single round trip keeps post-gate latency down (the CLI drains
 * this inside the same firewalled block as the record drain).
 *
 * Everything arrives already env-value-scrubbed by the CLI — the payload
 * builder is the scrub boundary, exactly as gate.py is for records. This
 * module never re-scrubs and never analyses code; it stores and indexes.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  checkpoints,
  intentFindings,
  ledgerEntries,
  preferences,
  repoConfigs,
  repos,
} from "@/db/schema";
import { advisorySignature } from "@/lib/signature";

/** Bounds mirror the CLI's drain limits; over-large batches are rejected. */
export const MAX_CHECKPOINTS = 50;
export const MAX_PREFS = 200;
export const MAX_LEDGER = 500;

const findingEntry = z
  .object({
    id: z.string(),
    concern: z.string(),
    kind: z.string().optional().default("intent"),
    tier: z.number().nullable().optional(),
    confidence: z.number().nullable().optional(),
    target: z.string().nullable().optional(),
    delivery: z.string(),
    label: z.string().nullable().optional(),
  })
  .passthrough();

const outcomeEntry = z
  .object({
    label: z.string().nullable().optional(),
    statement: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    confidence: z.number().nullable().optional(),
    classified_by: z.string().nullable().optional(),
    at: z.string().nullable().optional(),
  })
  .passthrough();

const checkpointEntry = z
  .object({
    id: z.string().min(1),
    created_at: z.string().min(1),
    repo_id: z.string().optional(),
    session_id: z.string().nullable().optional(),
    event: z.string(),
    task: z.string().nullable().optional(),
    branch: z.string().nullable().optional(),
    head_sha: z.string().nullable().optional(),
    digest: z.string().nullable().optional(),
    changed_files: z.array(z.string()).optional().default([]),
    diff_lines: z.number().optional().default(0),
    outcome: outcomeEntry.nullable().optional(),
    findings: z.array(findingEntry).optional().default([]),
    review_model_id: z.string().nullable().optional(),
    cli_version: z.string().optional().default(""),
    schema_version: z.string().optional().default(""),
  })
  .passthrough();

const prefEntry = z
  .object({
    id: z.string().min(1),
    statement: z.string(),
    category: z.string().nullable().optional(),
    scope: z.enum(["repo", "user"]),
    status: z.string(),
    evidence: z.array(z.string()).optional().default([]),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .passthrough();

const ledgerEntry = z.object({
  seq: z.number().int().nonnegative(),
  ts: z.string(),
  model: z.string(),
  cost_usd: z.number().optional().default(0),
});

export const intentSchema = z.object({
  repo_id: z.string().min(1),
  checkpoints: z.array(checkpointEntry).optional().default([]),
  prefs: z.array(prefEntry).optional().default([]),
  ledger: z.array(ledgerEntry).optional().default([]),
  config: z
    .object({
      hash: z.string().optional().default(""),
      effective: z.record(z.unknown()).optional().default({}),
      capabilities: z.record(z.unknown()).optional().default({}),
      conflicts: z.array(z.record(z.unknown())).optional().default([]),
    })
    .optional(),
});

export type IntentResult =
  | {
      status: "ok";
      checkpoints: number;
      prefs: number;
      ledger: number;
      config: boolean;
    }
  | { status: "invalid"; detail: string };

export async function ingestIntent(
  userId: string,
  payload: unknown,
): Promise<IntentResult> {
  const parsed = intentSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      status: "invalid",
      detail: parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
  }
  const data = parsed.data;
  if (data.checkpoints.length > MAX_CHECKPOINTS)
    return { status: "invalid", detail: `checkpoints: max ${MAX_CHECKPOINTS}` };
  if (data.prefs.length > MAX_PREFS)
    return { status: "invalid", detail: `prefs: max ${MAX_PREFS}` };
  if (data.ledger.length > MAX_LEDGER)
    return { status: "invalid", detail: `ledger: max ${MAX_LEDGER}` };

  const repoSlug = data.repo_id;
  await db
    .insert(repos)
    .values({ userId, repoSlug })
    .onConflictDoNothing({ target: [repos.userId, repos.repoSlug] });
  const [repo] = await db
    .select({ id: repos.id })
    .from(repos)
    .where(and(eq(repos.userId, userId), eq(repos.repoSlug, repoSlug)))
    .limit(1);

  let checkpointCount = 0;

  for (const ckpt of data.checkpoints) {
    const createdAt = new Date(ckpt.created_at);
    if (Number.isNaN(createdAt.getTime())) continue; // skip, never 500
    const outcome = ckpt.outcome ?? null;
    const extracted = {
      createdAt,
      sessionId: ckpt.session_id ?? null,
      event: ckpt.event,
      task: ckpt.task ?? null,
      branch: ckpt.branch ?? null,
      headSha: ckpt.head_sha ?? null,
      digest: ckpt.digest ?? null,
      changedFiles: ckpt.changed_files,
      diffLines: Math.round(ckpt.diff_lines),
      outcomeLabel: outcome?.label ?? null,
      outcomeCategory: outcome?.category ?? null,
      outcomeConfidence: outcome?.confidence ?? null,
      outcomeStatement: outcome?.statement ?? null,
      classifiedBy: outcome?.classified_by ?? null,
      reviewModelId: ckpt.review_model_id ?? null,
      cliVersion: ckpt.cli_version,
      schemaVersion: ckpt.schema_version,
      data: ckpt,
      updatedAt: new Date(),
    };

    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(checkpoints)
        .values({ repoPk: repo.id, checkpointId: ckpt.id, ...extracted })
        .onConflictDoUpdate({
          target: [checkpoints.repoPk, checkpoints.checkpointId],
          set: extracted,
        })
        .returning({ pk: checkpoints.pk });

      // Findings: delete + reinsert — delivery and labels may have moved.
      await tx
        .delete(intentFindings)
        .where(eq(intentFindings.checkpointPk, row.pk));
      if (ckpt.findings.length > 0) {
        await tx.insert(intentFindings).values(
          ckpt.findings.map((f, idx) => ({
            checkpointPk: row.pk,
            repoPk: repo.id,
            checkpointId: ckpt.id,
            idx,
            concern: f.concern,
            kind: f.kind ?? "intent",
            tier: f.tier ?? null,
            confidence: f.confidence ?? null,
            target: f.target ?? null,
            delivery: f.delivery,
            label: f.label ?? null,
            signature: advisorySignature(f.concern, f.target ?? null),
            createdAt,
          })),
        );
      }
    });
    checkpointCount++;
  }

  for (const pref of data.prefs) {
    const values = {
      userId,
      repoPk: pref.scope === "repo" ? repo.id : null,
      prefId: pref.id,
      scope: pref.scope,
      statement: pref.statement,
      category: pref.category ?? null,
      status: pref.status,
      evidence: pref.evidence,
      createdAt: new Date(pref.created_at),
      updatedAt: new Date(pref.updated_at),
    };
    // Partial unique indexes cannot be an ON CONFLICT target without
    // repeating their predicate, so resolve by hand.
    const existing = await db
      .select({ pk: preferences.pk })
      .from(preferences)
      .where(
        and(
          eq(preferences.prefId, pref.id),
          eq(preferences.scope, pref.scope),
          pref.scope === "repo"
            ? eq(preferences.repoPk, repo.id)
            : eq(preferences.userId, userId),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      await db
        .update(preferences)
        .set(values)
        .where(eq(preferences.pk, existing[0].pk));
    } else {
      await db.insert(preferences).values(values);
    }
  }

  if (data.ledger.length > 0) {
    await db
      .insert(ledgerEntries)
      .values(
        data.ledger
          .filter((l) => !Number.isNaN(new Date(l.ts).getTime()))
          .map((l) => ({
            repoPk: repo.id,
            seq: l.seq,
            ts: new Date(l.ts),
            model: l.model,
            costUsd: l.cost_usd,
          })),
      )
      .onConflictDoNothing({
        target: [ledgerEntries.repoPk, ledgerEntries.seq],
      });
  }

  let configStored = false;
  if (data.config) {
    const values = {
      effective: data.config.effective,
      effectiveHash: data.config.hash,
      capabilities: data.config.capabilities,
      conflicts: data.config.conflicts,
      reportedAt: new Date(),
    };
    await db
      .insert(repoConfigs)
      .values({ repoPk: repo.id, ...values })
      .onConflictDoUpdate({ target: repoConfigs.repoPk, set: values });
    configStored = true;
  }

  return {
    status: "ok",
    checkpoints: checkpointCount,
    prefs: data.prefs.length,
    ledger: data.ledger.length,
    config: configStored,
  };
}
