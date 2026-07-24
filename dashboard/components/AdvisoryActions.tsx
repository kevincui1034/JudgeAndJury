"use client";

import { useActionState } from "react";

import {
  labelAdvisoryAction,
  type ActionState,
} from "@/app/(app)/r/[repoId]/loop/actions";
import { cx } from "@/components/ui/primitives";

const INITIAL: ActionState = { error: null };

const TONES = {
  amber: "border-amber/35 text-amber-ink hover:bg-amber/12",
  green: "border-verdict-green/30 text-verdict-green hover:bg-verdict-green/12",
  red: "border-verdict-red/30 text-verdict-red hover:bg-verdict-red/12",
} as const;

/** One form per action — the submit button carries the action, so no
 *  client-side state juggling and it still works without JS. */
function ActionForm({
  action,
  advisoryPk,
  path,
  tone,
  children,
}: {
  action: "approve" | "reject" | "confirm";
  advisoryPk: string;
  path: string;
  tone: keyof typeof TONES;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(
    labelAdvisoryAction,
    INITIAL,
  );
  return (
    <form action={formAction} className="contents">
      <input type="hidden" name="advisoryPk" value={advisoryPk} />
      <input type="hidden" name="path" value={path} />
      <input type="hidden" name="action" value={action} />
      <button
        type="submit"
        disabled={pending}
        className={cx(
          "rounded-lg border px-2.5 py-1 text-[11.5px] transition-colors disabled:opacity-40",
          TONES[tone],
        )}
      >
        {pending ? "…" : children}
      </button>
      {state.error && (
        <span className="text-[11px] text-verdict-red">{state.error}</span>
      )}
    </form>
  );
}

export function AdvisoryActions({
  advisoryPk,
  delivery,
  label,
  path,
}: {
  advisoryPk: string;
  delivery: string;
  label: string | null;
  path: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Approve exists only for a HELD finding — the CLI enforces the same
          precondition, so offering it elsewhere would only produce an error. */}
      {delivery === "held" && !label && (
        <ActionForm action="approve" advisoryPk={advisoryPk} path={path} tone="amber">
          Approve → deliver
        </ActionForm>
      )}
      {label !== "confirmed" && (
        <ActionForm action="confirm" advisoryPk={advisoryPk} path={path} tone="green">
          Confirm
        </ActionForm>
      )}
      {label !== "rejected" && (
        <ActionForm action="reject" advisoryPk={advisoryPk} path={path} tone="red">
          Reject
        </ActionForm>
      )}
    </div>
  );
}
