/**
 * Recall explorer reads — the recurrence graph, drawn entirely from what
 * the CLI already uploaded.
 *
 * `records.recalled_from` is the prior a run matched. The dashboard never
 * talks to the vector store: ACTIAN_VECTOR_URL is a CLI-side secret and the
 * match has already been made by the time a record reaches ingest. What is
 * below is therefore the recall HISTORY as recorded, not a live search — and
 * it stays readable offline.
 *
 * A prior is context the judge may cite. Nothing here ranks, re-scores, or
 * decides anything; see SPONSORS.actian.authority for the rule this obeys.
 */
import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db";

/**
 * `records.archived_at` arrived in a later migration, so a database that has
 * not been migrated yet does not have the column at all — and referencing a
 * missing column is a hard error, not an empty result. Probe once per process
 * and shape the filter accordingly: an un-migrated DB simply has nothing
 * archived to hide.
 */
let archiveColumn: boolean | null = null;

async function hasArchiveColumn(): Promise<boolean> {
  if (archiveColumn === null) {
    const probe = await db.execute(sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'records' AND column_name = 'archived_at'
      LIMIT 1
    `);
    archiveColumn = probe.rows.length > 0;
  }
  return archiveColumn;
}

/** ` AND <alias>.archived_at IS NULL`, or nothing when the column is absent. */
async function liveOnly(alias: string): Promise<SQL> {
  if (!(await hasArchiveColumn())) return sql.empty();
  return sql` AND ${sql.raw(alias)}.archived_at IS NULL`;
}

/** Splits the stored pointer: "chk_012" (same repo) or "other:chk_012". */
function splitPointer(raw: string): { repo: string | null; recordId: string } {
  const at = raw.indexOf(":");
  if (at === -1) return { repo: null, recordId: raw };
  return { repo: raw.slice(0, at), recordId: raw.slice(at + 1) };
}

/**
 * Human phrasing for the distance between a prior and its recurrence.
 * Returns null when the prior lives in another repo, where we hold no
 * timestamp for it and guessing one would be a lie.
 */
export function describeGap(
  priorAt: Date | null,
  citingAt: Date,
): string | null {
  if (!priorAt) return null;
  const secs = Math.round((citingAt.getTime() - priorAt.getTime()) / 1000);
  if (!Number.isFinite(secs) || secs < 0) return null;
  const unit = (n: number, word: string) =>
    `caught again ${n} ${word}${n === 1 ? "" : "s"} later`;
  if (secs < 60) return "caught again moments later";
  const mins = Math.round(secs / 60);
  if (mins < 60) return unit(mins, "minute");
  const hours = Math.round(mins / 60);
  if (hours < 48) return unit(hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 60) return unit(days, "day");
  return unit(Math.round(days / 30), "month");
}

export interface RecallEdge {
  /** records.pk of the citing trace — the key the proof proxy takes. */
  citingPk: string;
  citingId: string;
  citingAt: Date;
  citingClasses: string[];
  gatePassed: boolean;
  diagnosis: string;
  resolutionStatus: string | null;
  /** Raw pointer as the CLI wrote it. */
  recalledFrom: string;
  /** The prior's own id, colon prefix stripped. */
  priorId: string;
  /** Repo the prior came from, or null when it is this one. */
  priorRepo: string | null;
  crossRepo: boolean;
  /** Present only when the prior is in this repo and still visible. */
  priorAt: Date | null;
  priorClasses: string[];
  /** Classes the two runs have in common — why they read as the same mistake. */
  sharedClasses: string[];
  /** True when the citing trace uploaded a context.json (the recalled priors). */
  hasContext: boolean;
}

/**
 * Every trace that cited a prior, newest first. This is the graph the
 * explorer renders: one edge per citation.
 *
 * The prior is joined only within this repo — a cross-repo pointer names a
 * record we do not hold here, so its timestamp and classes stay null rather
 * than being sourced from a row that merely shares an id.
 */
export async function recallEdges(
  repoPk: string,
  limit = 60,
): Promise<RecallEdge[]> {
  const [liveCiting, livePrior] = await Promise.all([
    liveOnly("c"),
    liveOnly("p"),
  ]);
  const result = await db.execute(sql`
    SELECT c.pk           AS citing_pk,
           c.record_id    AS citing_id,
           c.created_at   AS citing_at,
           c.failure_classes AS citing_classes,
           c.gate_passed,
           c.diagnosis,
           c.resolution_status,
           c.recalled_from,
           p.created_at   AS prior_at,
           p.failure_classes AS prior_classes,
           EXISTS (
             SELECT 1 FROM proof_files f
             WHERE f.record_pk = c.pk AND f.name = 'context.json'
           ) AS has_context
    FROM records c
    LEFT JOIN records p
      ON p.repo_pk = c.repo_pk
     AND p.record_id = c.recalled_from${livePrior}
    WHERE c.repo_pk = ${repoPk}${liveCiting}
      AND c.recalled_from IS NOT NULL
      AND c.recalled_from <> ''
    ORDER BY c.created_at DESC, c.pk DESC
    LIMIT ${limit}
  `);
  return (
    result.rows as {
      citing_pk: string;
      citing_id: string;
      citing_at: string;
      citing_classes: string[] | null;
      gate_passed: boolean;
      diagnosis: string | null;
      resolution_status: string | null;
      recalled_from: string;
      prior_at: string | null;
      prior_classes: string[] | null;
      has_context: boolean;
    }[]
  ).map((row) => {
    const { repo, recordId } = splitPointer(row.recalled_from);
    const citingClasses = row.citing_classes ?? [];
    const priorClasses = row.prior_classes ?? [];
    const priorSet = new Set(priorClasses);
    return {
      citingPk: row.citing_pk,
      citingId: row.citing_id,
      citingAt: new Date(row.citing_at),
      citingClasses,
      gatePassed: row.gate_passed,
      diagnosis: row.diagnosis ?? "",
      resolutionStatus: row.resolution_status,
      recalledFrom: row.recalled_from,
      priorId: recordId,
      priorRepo: repo,
      crossRepo: repo !== null,
      priorAt: row.prior_at ? new Date(row.prior_at) : null,
      priorClasses,
      sharedClasses: citingClasses.filter((c) => priorSet.has(c)),
      hasContext: row.has_context,
    };
  });
}

export interface RecallClassRow {
  failureClass: string;
  blocks: number;
  matched: number;
  crossRepo: number;
  /** matched / blocks, or null when the class has never blocked. */
  hitRate: number | null;
}

/**
 * Per failure class: how often it blocked, and how often that block had a
 * prior to point at. Where the rate is low the class is either new or its
 * recurrences do not read as similar — both worth seeing.
 */
export async function recallByClass(repoPk: string): Promise<RecallClassRow[]> {
  const live = await liveOnly("records");
  const result = await db.execute(sql`
    SELECT cls AS failure_class,
           count(*)::int AS blocks,
           count(*) FILTER (
             WHERE recalled_from IS NOT NULL AND recalled_from <> ''
           )::int AS matched,
           count(*) FILTER (WHERE recalled_from LIKE '%:%')::int AS cross_repo
    FROM records, unnest(failure_classes) AS cls
    WHERE repo_pk = ${repoPk}${live}
      AND NOT gate_passed
    GROUP BY 1
    ORDER BY 2 DESC, 1
  `);
  return (
    result.rows as {
      failure_class: string;
      blocks: number;
      matched: number;
      cross_repo: number;
    }[]
  ).map((row) => {
    const blocks = Number(row.blocks);
    const matched = Number(row.matched);
    return {
      failureClass: row.failure_class,
      blocks,
      matched,
      crossRepo: Number(row.cross_repo),
      hitRate: blocks ? matched / blocks : null,
    };
  });
}

export interface NovelBlock {
  recordId: string;
  createdAt: Date;
  failureClasses: string[];
  diagnosis: string;
  resolutionStatus: string | null;
}

export interface UnmatchedBlocks {
  /** Every block with no prior, not just the sample below. */
  total: number;
  recent: NovelBlock[];
}

/**
 * Blocks that cited nothing — failures with no precedent in this repo.
 *
 * This is the negative space, and it belongs on the page: recall only ever
 * covers the mistakes that have happened before, and a panel that showed
 * only its hits would read as if it covered everything.
 */
export async function unmatchedBlocks(
  repoPk: string,
  limit = 12,
): Promise<UnmatchedBlocks> {
  const live = await liveOnly("records");
  const [totals, recent] = await Promise.all([
    db.execute(sql`
      SELECT count(*)::int AS n
      FROM records
      WHERE repo_pk = ${repoPk}${live}
        AND NOT gate_passed
        AND (recalled_from IS NULL OR recalled_from = '')
    `),
    db.execute(sql`
      SELECT record_id, created_at, failure_classes, diagnosis, resolution_status
      FROM records
      WHERE repo_pk = ${repoPk}${live}
        AND NOT gate_passed
        AND (recalled_from IS NULL OR recalled_from = '')
      ORDER BY created_at DESC, pk DESC
      LIMIT ${limit}
    `),
  ]);
  return {
    total: Number((totals.rows[0] as { n: number } | undefined)?.n ?? 0),
    recent: (
      recent.rows as {
        record_id: string;
        created_at: string;
        failure_classes: string[] | null;
        diagnosis: string | null;
        resolution_status: string | null;
      }[]
    ).map((row) => ({
      recordId: row.record_id,
      createdAt: new Date(row.created_at),
      failureClasses: row.failure_classes ?? [],
      diagnosis: row.diagnosis ?? "",
      resolutionStatus: row.resolution_status,
    })),
  };
}
