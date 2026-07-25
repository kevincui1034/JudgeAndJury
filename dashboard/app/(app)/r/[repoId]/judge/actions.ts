"use server";

/**
 * Queue a fine-tune run for the CLI to execute.
 *
 * The dashboard CANNOT build the corpus. `records` stores only
 * `inputs_hash`, `checkpoints` stores `task`/`digest`, and `advisories`
 * has no input column — memory/finetune.py is explicit that raw prompts
 * never touch disk, so they are not in this database and never will be.
 * Re-declaring ADVISORY_SYSTEM_PROMPT in TypeScript to compensate would
 * drift from the CLI the first time that prompt changes, silently.
 *
 * So this queues a ROW and the machine that already holds the labeled
 * corpus and the model key does the work — exactly the mechanism the
 * config page uses (lib/writeback.ts `patchConfig` → `label_events` →
 * cli/src/proofjury/configfile.py on the next `proofjury sync`).
 */

import { revalidatePath } from "next/cache";

import { finetuneReadiness } from "@/lib/queries/judge";
import { requireRepo } from "@/lib/repo";
import { patchConfig, WriteBackError } from "@/lib/writeback";

export interface FinetuneState {
  error: string | null;
  queued: string | null;
}

/**
 * The [memory] key the request lands under in `.proofjury.toml`.
 *
 * NOT exported: a "use server" module may only export async functions, and
 * exporting a plain const here is a bundler-level build error that neither
 * tsc nor eslint reports. Nothing outside this file needs them.
 */
const FINETUNE_TABLE = "memory";
const FINETUNE_KEY = "finetune_requested_at";

export async function queueFinetuneAction(
  _prev: FinetuneState,
  formData: FormData,
): Promise<FinetuneState> {
  const repoId = String(formData.get("repoId") ?? "");
  const path = String(formData.get("path") || `/r/${repoId}/judge`);

  // Never trust a repoId alone — this redirects when signed out and 404s
  // when the repo is not this user's, the same guard every page uses.
  const { user, repo } = await requireRepo(repoId);
  if (!user.id) return { error: "not signed in", queued: null };

  // Same precondition the CLI enforces before it builds a dataset: an
  // unlabeled record is an unanswered question, not training data.
  const tune = await finetuneReadiness(repo.id);
  if (tune.trainingRows === 0) {
    return {
      error:
        "nothing labeled to train on yet — confirm or reject some findings first",
      queued: null,
    };
  }

  try {
    await patchConfig({
      userId: user.id,
      repoPk: repo.id,
      table: FINETUNE_TABLE,
      set: { [FINETUNE_KEY]: new Date().toISOString() },
    });
  } catch (error) {
    if (error instanceof WriteBackError) {
      return { error: error.message, queued: null };
    }
    throw error;
  }

  revalidatePath(path);
  return { error: null, queued: FINETUNE_TABLE };
}
