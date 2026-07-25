"use client";

/**
 * Queue a fine-tune run. A real <form> with hidden inputs, so it submits
 * and revalidates with JavaScript disabled — same shape as ConfigEditor
 * and AdvisoryActions.
 */

import { useActionState } from "react";

import {
  queueFinetuneAction,
  type FinetuneState,
} from "@/app/(app)/r/[repoId]/judge/actions";
import { Badge, cx } from "@/components/ui/primitives";

const INITIAL: FinetuneState = { error: null, queued: null };

export function FinetuneButton({
  repoId,
  path,
  trainingRows,
}: {
  repoId: string;
  path: string;
  trainingRows: number;
}) {
  const [state, formAction, pending] = useActionState(
    queueFinetuneAction,
    INITIAL,
  );
  const nothingToTrain = trainingRows === 0;

  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="repoId" value={repoId} />
      <input type="hidden" name="path" value={path} />

      <button
        type="submit"
        disabled={pending || nothingToTrain}
        className={cx(
          "rounded-lg border border-amber/35 px-3 py-1.5 text-[12px] text-amber-ink transition-colors",
          "hover:bg-amber/12 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
        )}
      >
        {pending ? "queueing…" : "Queue fine-tune"}
      </button>

      {nothingToTrain ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
          Nothing to train on yet — the corpus is built only from findings a
          human confirmed or rejected. Label a few, then queue the run.
        </p>
      ) : (
        <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
          Queues a request beside your gate config. Your own machine picks it
          up on its next sync and runs the job there, where the labeled corpus
          and the model key already live — nothing is submitted from here.
        </p>
      )}

      {(state.error || state.queued) && (
        <div className="mt-2">
          {state.error ? (
            <p className="text-[12px] text-verdict-red">{state.error}</p>
          ) : (
            <Badge tone="teal">
              queued — runs on this repo&apos;s next `proofjury sync`
            </Badge>
          )}
        </div>
      )}
    </form>
  );
}
