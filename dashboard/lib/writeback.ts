/**
 * Web → CLI write-backs beyond advisory labels.
 *
 * All of these ride the EXISTING `label_events` feed and the existing
 * GET /repos/{repo}/labels cursor — no new down-sync protocol. The CLI
 * dispatches by `kind` and skips kinds it doesn't know, so an older CLI
 * degrades safely instead of breaking.
 *
 * `label_events.record_id` is NOT NULL, so it carries "the entity this
 * event addresses" (a record id, checkpoint id or pref id). Every payload
 * ALSO repeats its id explicitly so no handler depends on that overload.
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  checkpoints,
  intentFindings,
  labelEvents,
  preferences,
  records,
  repoConfigs,
  repos,
} from "@/db/schema";
import { EDITABLE_TABLES } from "@/lib/config-schema";

export class WriteBackError extends Error {}

async function assertOwnedRepo(repoPk: string, userId: string): Promise<void> {
  const [row] = await db
    .select({ id: repos.id })
    .from(repos)
    .where(and(eq(repos.id, repoPk), eq(repos.userId, userId)))
    .limit(1);
  if (!row) throw new WriteBackError("repo not found");
}

/* ────────────────────────── record_label ────────────────────────── */

export const RESOLUTION_STATUSES = [
  "accepted",
  "false_positive",
  "confirmed",
] as const;
export type ResolutionStatus = (typeof RESOLUTION_STATUSES)[number];

/**
 * resolve / confirm a gate record. Payload mirrors exactly what
 * `cli.py resolve` / `confirm` pass to update_resolution, which already
 * preserves any prior resolution in `resolution.history`.
 */
export async function labelRecord(opts: {
  userId: string;
  repoPk: string;
  recordId: string;
  status: ResolutionStatus;
  outcome?: "shipped" | "rolled_back" | null;
  note?: string | null;
}): Promise<void> {
  await assertOwnedRepo(opts.repoPk, opts.userId);
  if (!RESOLUTION_STATUSES.includes(opts.status)) {
    throw new WriteBackError(`invalid status: ${opts.status}`);
  }
  if (opts.status === "confirmed" && !opts.outcome) {
    throw new WriteBackError("confirmed requires an outcome");
  }

  const at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const resolution: Record<string, unknown> = {
    status: opts.status,
    note: opts.note ?? null,
    at,
  };
  if (opts.outcome) resolution.outcome = opts.outcome;

  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ pk: records.pk })
      .from(records)
      .where(
        and(eq(records.repoPk, opts.repoPk), eq(records.recordId, opts.recordId)),
      )
      .limit(1);
    if (!row) throw new WriteBackError("record not found");

    await tx
      .update(records)
      .set({
        resolutionStatus: opts.status,
        resolutionOutcome: opts.outcome ?? null,
        data: sql`jsonb_set(${records.data}, '{resolution}', ${JSON.stringify(resolution)}::jsonb)`,
        updatedAt: new Date(),
      })
      .where(eq(records.pk, row.pk));

    await tx.insert(labelEvents).values({
      repoPk: opts.repoPk,
      recordId: opts.recordId,
      kind: "record_label",
      idx: null,
      payload: { record_id: opts.recordId, ...resolution },
      source: "web",
    });
  });
}

/* ─────────────────────── intent_finding_label ─────────────────────── */

export async function labelIntentFinding(opts: {
  userId: string;
  repoPk: string;
  findingPk: string;
  label: "confirmed" | "rejected";
}): Promise<void> {
  await assertOwnedRepo(opts.repoPk, opts.userId);
  await db.transaction(async (tx) => {
    const [f] = await tx
      .select()
      .from(intentFindings)
      .where(
        and(
          eq(intentFindings.pk, opts.findingPk),
          eq(intentFindings.repoPk, opts.repoPk),
        ),
      )
      .limit(1);
    if (!f) throw new WriteBackError("finding not found");

    await tx
      .update(intentFindings)
      .set({ label: opts.label })
      .where(eq(intentFindings.pk, f.pk));

    // Keep the verbatim checkpoint JSON converged so a CLI re-push agrees.
    await tx
      .update(checkpoints)
      .set({
        data: sql`jsonb_set(${checkpoints.data}, ${`{findings,${f.idx},label}`}::text[], ${JSON.stringify(opts.label)}::jsonb)`,
        updatedAt: new Date(),
      })
      .where(eq(checkpoints.pk, f.checkpointPk));

    await tx.insert(labelEvents).values({
      repoPk: opts.repoPk,
      recordId: f.checkpointId,
      kind: "intent_finding_label",
      idx: f.idx,
      payload: { ckpt_id: f.checkpointId, index: f.idx, label: opts.label },
      source: "web",
    });
  });
}

/* ────────────────────────── pref_status ────────────────────────── */

export async function setPrefStatus(opts: {
  userId: string;
  repoPk: string;
  prefPk: string;
  status: "active" | "rejected";
}): Promise<void> {
  await assertOwnedRepo(opts.repoPk, opts.userId);
  await db.transaction(async (tx) => {
    const [pref] = await tx
      .select()
      .from(preferences)
      .where(
        and(eq(preferences.pk, opts.prefPk), eq(preferences.userId, opts.userId)),
      )
      .limit(1);
    if (!pref) throw new WriteBackError("preference not found");

    await tx
      .update(preferences)
      .set({ status: opts.status, updatedAt: new Date() })
      .where(eq(preferences.pk, pref.pk));

    await tx.insert(labelEvents).values({
      repoPk: opts.repoPk,
      recordId: pref.prefId,
      kind: "pref_status",
      idx: null,
      payload: {
        pref_id: pref.prefId,
        scope: pref.scope,
        status: opts.status,
        at: new Date().toISOString(),
      },
      source: "web",
    });
  });
}

/* ────────────────────────── config_patch ────────────────────────── */

/**
 * Queue a gate-config change. The dashboard writes a ROW; the CLI writes
 * the file — see cli/src/proofjury/configfile.py, which enforces the same
 * allowlist and refuses on a stale base_hash rather than clobbering a
 * local edit. Nothing here can change a past verdict: records are
 * immutable snapshots, config only feeds future runs.
 */
export async function patchConfig(opts: {
  userId: string;
  repoPk: string;
  table: string;
  set?: Record<string, unknown>;
  unset?: string[];
}): Promise<void> {
  await assertOwnedRepo(opts.repoPk, opts.userId);
  if (!EDITABLE_TABLES.has(opts.table)) {
    throw new WriteBackError(
      `[${opts.table}] is local-only — it can shape whether the gate runs, so it is never remotely editable`,
    );
  }
  const [cfg] = await db
    .select({ hash: repoConfigs.effectiveHash })
    .from(repoConfigs)
    .where(eq(repoConfigs.repoPk, opts.repoPk))
    .limit(1);

  await db.insert(labelEvents).values({
    repoPk: opts.repoPk,
    recordId: "-", // not-null column; config patches address no entity
    kind: "config_patch",
    idx: null,
    payload: {
      table: opts.table,
      set: opts.set ?? {},
      unset: opts.unset ?? [],
      base_hash: cfg?.hash ?? "",
      at: new Date().toISOString(),
      by: "web",
    },
    source: "web",
  });
}
