/** Intent-pillar ingest: checkpoints, findings, prefs, ledger, config. */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  checkpoints,
  intentFindings,
  ledgerEntries,
  preferences,
  repoConfigs,
  repos,
} from "@/db/schema";
import { ingestIntent, MAX_CHECKPOINTS } from "@/lib/intent";
import { makeUser, sampleCheckpoint, truncateAll } from "./helpers";

let userId: string;

beforeEach(async () => {
  await truncateAll();
  userId = await makeUser();
});

async function repoPk(): Promise<string> {
  const [row] = await db
    .select({ id: repos.id })
    .from(repos)
    .where(and(eq(repos.userId, userId), eq(repos.repoSlug, "demo-app")))
    .limit(1);
  return row.id;
}

describe("ingestIntent", () => {
  it("stores a checkpoint with its outcome extracted", async () => {
    const result = await ingestIntent(userId, {
      repo_id: "demo-app",
      checkpoints: [sampleCheckpoint()],
    });
    expect(result).toMatchObject({ status: "ok", checkpoints: 1 });

    const [row] = await db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.repoPk, await repoPk()));
    expect(row.checkpointId).toBe("ckpt_001");
    expect(row.outcomeLabel).toBe("corrected");
    expect(row.outcomeCategory).toBe("size");
    expect(row.reviewModelId).toBe("pioneer/qwen3-32b");
    expect(row.changedFiles).toEqual(["payments.py"]);
    // Full record kept verbatim alongside the extracted columns.
    expect((row.data as Record<string, unknown>).diff_excerpt).toContain("refund");
  });

  it("is idempotent on (repo, checkpoint_id)", async () => {
    await ingestIntent(userId, { repo_id: "demo-app", checkpoints: [sampleCheckpoint()] });
    await ingestIntent(userId, { repo_id: "demo-app", checkpoints: [sampleCheckpoint()] });
    const rows = await db.select().from(checkpoints);
    expect(rows).toHaveLength(1);
  });

  it("re-pushes replace findings so labels and delivery can move", async () => {
    const withFinding = sampleCheckpoint({
      findings: [
        {
          id: "ckpt_001#0",
          concern: "This does not match the stated task",
          kind: "intent",
          tier: 5,
          confidence: 0.91,
          target: "payments.py:3",
          delivery: "staged",
        },
      ],
    });
    await ingestIntent(userId, { repo_id: "demo-app", checkpoints: [withFinding] });

    const first = await db.select().from(intentFindings);
    expect(first).toHaveLength(1);
    expect(first[0].delivery).toBe("staged");
    expect(first[0].signature).toBeTruthy(); // same advisorySignature as the gate

    const delivered = sampleCheckpoint({
      findings: [
        {
          ...(withFinding.findings as Record<string, unknown>[])[0],
          delivery: "sent",
        },
      ],
    });
    await ingestIntent(userId, { repo_id: "demo-app", checkpoints: [delivered] });
    const second = await db.select().from(intentFindings);
    expect(second).toHaveLength(1);
    expect(second[0].delivery).toBe("sent");
  });

  it("stores repo- and user-scope preferences side by side", async () => {
    await ingestIntent(userId, {
      repo_id: "demo-app",
      prefs: [
        {
          id: "pref_001",
          statement: "prefers small modules",
          category: "size",
          scope: "repo",
          status: "candidate",
          evidence: ["ckpt_001"],
          created_at: "2026-07-18T12:00:00Z",
          updated_at: "2026-07-18T12:00:00Z",
        },
        {
          id: "pref_001", // same id, different scope — must not collide
          statement: "prefers explicit type hints",
          category: "other",
          scope: "user",
          status: "active",
          evidence: [],
          created_at: "2026-07-18T12:00:00Z",
          updated_at: "2026-07-18T12:00:00Z",
        },
      ],
    });
    const rows = await db.select().from(preferences);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.scope === "user")[0].repoPk).toBeNull();
  });

  it("updates a preference in place when its status changes", async () => {
    const pref = {
      id: "pref_001",
      statement: "prefers small modules",
      category: "size",
      scope: "repo" as const,
      status: "candidate",
      evidence: [],
      created_at: "2026-07-18T12:00:00Z",
      updated_at: "2026-07-18T12:00:00Z",
    };
    await ingestIntent(userId, { repo_id: "demo-app", prefs: [pref] });
    await ingestIntent(userId, {
      repo_id: "demo-app",
      prefs: [{ ...pref, status: "active", updated_at: "2026-07-18T13:00:00Z" }],
    });
    const rows = await db.select().from(preferences);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("active");
  });

  it("dedupes ledger lines by seq so re-drains cannot double-count cost", async () => {
    const entry = { seq: 0, ts: "2026-07-18T12:00:00Z", model: "pioneer/gpt-4.1", cost_usd: 0.5 };
    await ingestIntent(userId, { repo_id: "demo-app", ledger: [entry] });
    await ingestIntent(userId, { repo_id: "demo-app", ledger: [entry] });
    const rows = await db.select().from(ledgerEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0].costUsd).toBeCloseTo(0.5);
  });

  it("stores the reported config with its hash", async () => {
    await ingestIntent(userId, {
      repo_id: "demo-app",
      config: {
        hash: "sha256-abc",
        effective: { advisory: { enabled: true } },
        capabilities: { semantic: false },
        conflicts: [],
      },
    });
    const [row] = await db.select().from(repoConfigs);
    expect(row.effectiveHash).toBe("sha256-abc");
    expect(row.effective).toMatchObject({ advisory: { enabled: true } });
  });

  it("rejects an over-large checkpoint batch rather than truncating it", async () => {
    const many = Array.from({ length: MAX_CHECKPOINTS + 1 }, (_, i) =>
      sampleCheckpoint({ id: `ckpt_${String(i).padStart(3, "0")}` }),
    );
    const result = await ingestIntent(userId, {
      repo_id: "demo-app",
      checkpoints: many,
    });
    expect(result.status).toBe("invalid");
  });

  it("rejects a malformed payload", async () => {
    const result = await ingestIntent(userId, { repo_id: "" });
    expect(result.status).toBe("invalid");
  });

  it("scopes everything to the calling user", async () => {
    const other = await makeUser("other");
    await ingestIntent(userId, { repo_id: "demo-app", checkpoints: [sampleCheckpoint()] });
    await ingestIntent(other, { repo_id: "demo-app", checkpoints: [sampleCheckpoint()] });
    const repoRows = await db.select().from(repos);
    expect(repoRows).toHaveLength(2); // same slug, two owners, no leakage
  });
});
