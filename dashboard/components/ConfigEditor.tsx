"use client";

import { useActionState } from "react";

import {
  saveConfigAction,
  type ConfigState,
} from "@/app/(app)/r/[repoId]/config/actions";
import type { ConfigTable } from "@/lib/config-schema";
import { Badge, cx } from "@/components/ui/primitives";

const INITIAL: ConfigState = { error: null, queued: null };

const INPUT =
  "rounded-lg border border-line-2 bg-surface-2 px-2.5 py-1 text-[12.5px] text-ink transition-colors focus:border-amber focus:ring-2 focus:ring-amber/25 focus:outline-none";

export function ConfigEditor({
  spec,
  current,
  repoId,
}: {
  spec: ConfigTable;
  current: Record<string, unknown>;
  repoId: string;
}) {
  const [state, formAction, pending] = useActionState(saveConfigAction, INITIAL);
  const val = (key: string, fallback: unknown) =>
    current[key] === undefined ? fallback : current[key];

  return (
    <form action={formAction}>
      <input type="hidden" name="repoId" value={repoId} />
      <input type="hidden" name="table" value={spec.table} />

      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-2">
        <div className="min-w-0">
          <h3 className="text-[14px] font-medium text-ink">
            {spec.title}{" "}
            <span className="font-mono text-[11px] text-faint">
              [{spec.table}]
            </span>
          </h3>
          <p className="mt-0.5 max-w-xl text-[11.5px] leading-relaxed text-faint">
            {spec.blurb}
          </p>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-amber/35 px-3 py-1.5 text-[12px] text-amber-ink transition-colors hover:bg-amber/12 disabled:opacity-40"
        >
          {pending ? "queueing…" : "Queue change"}
        </button>
      </div>

      <div className="grid gap-x-6 gap-y-3 px-5 pb-4 md:grid-cols-2">
        {spec.fields.map((field) => {
          const v = val(field.key, field.default);
          return (
            <label key={field.key} className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-[12px] text-body">
                {field.label}
                <span className="font-mono text-[10px] text-faint">
                  {field.key}
                </span>
              </span>

              {field.kind === "bool" ? (
                <input
                  type="checkbox"
                  name={field.key}
                  defaultChecked={Boolean(v)}
                  className="size-4 accent-[var(--amber)]"
                />
              ) : field.kind === "mode" ? (
                <select
                  name={field.key}
                  defaultValue={String(v ?? "")}
                  className={INPUT}
                >
                  {field.options?.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : field.kind === "float01" ? (
                <input
                  type="number"
                  name={field.key}
                  step="0.05"
                  min={0}
                  max={1}
                  defaultValue={v === null || v === undefined ? "" : String(v)}
                  className={INPUT}
                />
              ) : field.kind === "number" ? (
                <input
                  type="number"
                  name={field.key}
                  min={field.min ?? 0}
                  defaultValue={v === null || v === undefined ? "" : String(v)}
                  className={INPUT}
                />
              ) : field.kind === "tiers" ? (
                <input
                  type="text"
                  name={field.key}
                  defaultValue={Array.isArray(v) ? v.join(", ") : "4, 5"}
                  className={cx(INPUT, "font-mono")}
                />
              ) : (
                <input
                  type="text"
                  name={field.key}
                  defaultValue={v === null || v === undefined ? "" : String(v)}
                  placeholder="(default)"
                  className={cx(INPUT, "font-mono")}
                />
              )}

              {field.hint && (
                <span className="text-[11px] leading-snug text-faint">
                  {field.hint}
                </span>
              )}
            </label>
          );
        })}
      </div>

      {(state.error || state.queued === spec.table) && (
        <div className="px-5 pb-4">
          {state.error ? (
            <p className="text-[12px] text-verdict-red">{state.error}</p>
          ) : (
            <Badge tone="teal">
              queued — applies on this repo&apos;s next `proofjury sync`
            </Badge>
          )}
        </div>
      )}
    </form>
  );
}
