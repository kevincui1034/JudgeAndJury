"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { CONFIG_TABLES } from "@/lib/config-schema";
import { getRepo } from "@/lib/queries/traces";
import { patchConfig, WriteBackError } from "@/lib/writeback";

export interface ConfigState {
  error: string | null;
  queued: string | null;
}

/** Coerce a form value using the field's declared kind. */
function coerce(kind: string, raw: FormDataEntryValue | null): unknown {
  const value = raw === null ? "" : String(raw);
  switch (kind) {
    case "bool":
      return value === "on" || value === "true";
    case "number":
      return value === "" ? null : Math.round(Number(value));
    case "float01":
      return value === "" ? null : Number(value);
    case "tiers":
      return value
        .split(",")
        .map((t) => Number(t.trim()))
        .filter((t) => t === 4 || t === 5);
    default:
      return value.trim() === "" ? null : value.trim();
  }
}

export async function saveConfigAction(
  _prev: ConfigState,
  formData: FormData,
): Promise<ConfigState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "not signed in", queued: null };

  const repoId = String(formData.get("repoId"));
  const table = String(formData.get("table"));
  const repo = await getRepo(session.user.id, repoId);
  if (!repo) return { error: "repo not found", queued: null };

  const spec = CONFIG_TABLES.find((t) => t.table === table);
  if (!spec) return { error: `unknown table: ${table}`, queued: null };

  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const field of spec.fields) {
    const value = coerce(field.kind, formData.get(field.key));
    if (value === null || (Array.isArray(value) && value.length === 0)) {
      unset.push(field.key);
    } else {
      set[field.key] = value;
    }
  }

  try {
    await patchConfig({
      userId: session.user.id,
      repoPk: repo.id,
      table,
      set,
      unset,
    });
  } catch (error) {
    if (error instanceof WriteBackError) return { error: error.message, queued: null };
    throw error;
  }
  revalidatePath(`/r/${repoId}/config`);
  return { error: null, queued: table };
}
