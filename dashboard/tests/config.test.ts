/**
 * PINNED: the config allowlist is the safety boundary for remote editing,
 * and it exists in two places — this app (the UI's mirror) and
 * cli/src/proofjury/configfile.py (the enforcement point that writes the
 * file). If they drift, the dashboard offers a control the CLI refuses,
 * or worse, implies a table is protected when it is not.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CONFIG_TABLES,
  EDITABLE_TABLES,
  LOCAL_ONLY_TABLES,
} from "@/lib/config-schema";

const PY = readFileSync(
  path.resolve(__dirname, "../../cli/src/proofjury/configfile.py"),
  "utf8",
);

/** Pull a frozenset literal's string members out of the Python source. */
function pythonSet(name: string): Set<string> {
  const start = PY.indexOf(`${name} = frozenset(`);
  expect(start, `${name} not found in configfile.py`).toBeGreaterThan(-1);
  const close = PY.indexOf(")", start);
  const body = PY.slice(start, close);
  return new Set(Array.from(body.matchAll(/"([a-z_]+)"/g)).map((m) => m[1]));
}

describe("config allowlist parity with the CLI", () => {
  it("editable tables match configfile.py exactly", () => {
    expect([...EDITABLE_TABLES].sort()).toEqual([...pythonSet("EDITABLE_TABLES")].sort());
  });

  it("local-only tables match configfile.py exactly", () => {
    expect([...LOCAL_ONLY_TABLES].sort()).toEqual(
      [...pythonSet("LOCAL_ONLY_TABLES")].sort(),
    );
  });

  it("the two sets never overlap", () => {
    for (const t of EDITABLE_TABLES) expect(LOCAL_ONLY_TABLES.has(t)).toBe(false);
  });

  it("gate-shaping tables are local-only", () => {
    // [actions] picks WHICH checks run; [hook] decides whether the gate
    // fires at all; [commands] is how checks run; [env] is what env_vars
    // is evaluated against. None may be reachable from a browser session.
    for (const t of ["actions", "hook", "commands", "env"]) {
      expect(LOCAL_ONLY_TABLES.has(t)).toBe(true);
      expect(EDITABLE_TABLES.has(t)).toBe(false);
    }
  });

  it("every editable table has a UI spec, and every spec is editable", () => {
    const specTables = CONFIG_TABLES.map((t) => t.table).sort();
    expect(specTables).toEqual([...EDITABLE_TABLES].sort());
  });

  it("every field declares a kind the editor can render", () => {
    const kinds = new Set(["bool", "number", "float01", "text", "tiers", "mode"]);
    for (const table of CONFIG_TABLES) {
      for (const field of table.fields) {
        expect(kinds.has(field.kind), `${table.table}.${field.key}`).toBe(true);
        if (field.kind === "mode") expect(field.options?.length).toBeGreaterThan(0);
      }
    }
  });
});
