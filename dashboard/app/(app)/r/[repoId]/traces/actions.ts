"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { records } from "@/db/schema";
import { requireRepo } from "@/lib/repo";

export interface ActionState {
  error: string | null;
}

/**
 * Set or clear `records.archived_at` for one trace.
 *
 * The repo is resolved through the ownership guard first, and the update is
 * keyed by the resolved repoPk — a recordId on its own is never enough to
 * reach a row, so one user can never archive another user's trace.
 */
async function setArchived(
  formData: FormData,
  archivedAt: Date | null,
): Promise<ActionState> {
  const repoId = String(formData.get("repoId") ?? "");
  const recordId = String(formData.get("recordId") ?? "");
  if (!repoId || !recordId) return { error: "missing trace reference" };

  const { repo } = await requireRepo(repoId);
  const updated = await db
    .update(records)
    .set({ archivedAt, updatedAt: new Date() })
    .where(and(eq(records.repoPk, repo.id), eq(records.recordId, recordId)))
    .returning({ pk: records.pk });
  if (updated.length === 0) return { error: "trace not found" };

  revalidatePath(String(formData.get("path") || "/"));
  return { error: null };
}

/**
 * Archive a trace: it drops out of the default list and into the Archived
 * view. Nothing is deleted — the record, its advisories and its proof blobs
 * stay exactly as they were, and the verdict is untouched.
 */
export async function archiveTraceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return setArchived(formData, new Date());
}

/** Put an archived trace back in the default list. */
export async function restoreTraceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return setArchived(formData, null);
}
