"use client";

import { useActionState } from "react";

import {
  archiveTraceAction,
  restoreTraceAction,
  type ActionState,
} from "@/app/(app)/r/[repoId]/traces/actions";
import { cx } from "@/components/ui/primitives";

const INITIAL: ActionState = { error: null };

/**
 * Archive / restore one trace. A real form posting to a server action, so it
 * works with JS off; `path` rides along as a hidden input because the action
 * revalidates exactly the page the click came from.
 */
export function ArchiveButton({
  repoId,
  recordId,
  path,
  archived,
  className,
}: {
  repoId: string;
  recordId: string;
  path: string;
  /** Current state of the record — decides which direction this button goes. */
  archived: boolean;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(
    archived ? restoreTraceAction : archiveTraceAction,
    INITIAL,
  );
  return (
    <form action={formAction} className={cx("flex items-center gap-2", className)}>
      <input type="hidden" name="repoId" value={repoId} />
      <input type="hidden" name="recordId" value={recordId} />
      <input type="hidden" name="path" value={path} />
      <button
        type="submit"
        disabled={pending}
        title={
          archived
            ? "Put this trace back in the main list."
            : "Hide this trace from the main list. The record and its evidence are kept."
        }
        className={cx(
          "rounded-lg border px-2.5 py-1 text-[11.5px] whitespace-nowrap transition-colors disabled:opacity-40",
          archived
            ? "border-amber/35 text-amber-ink hover:bg-amber/12"
            : "border-line text-faint hover:bg-tint hover:text-body",
        )}
      >
        {pending ? "…" : archived ? "Restore" : "Archive"}
      </button>
      {state.error && (
        <span className="text-[11px] text-verdict-red">{state.error}</span>
      )}
    </form>
  );
}
