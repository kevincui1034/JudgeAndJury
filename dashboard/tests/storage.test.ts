import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LocalDirStorage,
  PostgresStorage,
  S3Storage,
  getStorage,
  resolveS3Config,
} from "@/lib/storage";

const S3_VARS = [
  "STORAGE_ENDPOINT",
  "STORAGE_BUCKET",
  "R2_ENDPOINT",
  "R2_BUCKET",
  "SUPABASE_URL",
  "SUPABASE_STORAGE_BUCKET",
];

describe("getStorage selection", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  beforeEach(() => {
    for (const v of S3_VARS) delete process.env[v];
    delete process.env.BLOB_DRIVER;
  });

  it("BLOB_DRIVER=local wins over any configured object storage", () => {
    process.env.BLOB_DRIVER = "local";
    process.env.R2_ENDPOINT = "https://acct.r2.cloudflarestorage.com";
    process.env.R2_BUCKET = "proofs";
    expect(getStorage()).toBeInstanceOf(LocalDirStorage);
  });

  it("uses S3 when an endpoint+bucket are configured", () => {
    process.env.R2_ENDPOINT = "https://acct.r2.cloudflarestorage.com";
    process.env.R2_BUCKET = "proofs";
    expect(getStorage()).toBeInstanceOf(S3Storage);
  });

  it("defaults to Postgres when no object storage is configured", () => {
    // The old fallback was LocalDirStorage, which on a serverless host
    // writes to an ephemeral disk — proof files would vanish silently.
    process.env.DATABASE_URL = "postgres://x/y";
    expect(getStorage()).toBeInstanceOf(PostgresStorage);
  });
});

describe("resolveS3Config", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  beforeEach(() => {
    for (const v of S3_VARS) delete process.env[v];
  });

  it("derives the Supabase Storage endpoint from SUPABASE_URL", () => {
    process.env.SUPABASE_URL = "https://abcdefg.supabase.co";
    process.env.SUPABASE_STORAGE_BUCKET = "proofs";
    const cfg = resolveS3Config();
    expect(cfg?.endpoint).toBe("https://abcdefg.supabase.co/storage/v1/s3");
    expect(cfg?.bucket).toBe("proofs");
    // Supabase Storage and MinIO both require path-style addressing.
    expect(cfg?.forcePathStyle).toBe(true);
  });

  it("still honours the original R2_* variables", () => {
    process.env.R2_ENDPOINT = "https://acct.r2.cloudflarestorage.com";
    process.env.R2_BUCKET = "proofs";
    expect(resolveS3Config()?.endpoint).toBe(
      "https://acct.r2.cloudflarestorage.com",
    );
  });

  it("is null when nothing is configured", () => {
    expect(resolveS3Config()).toBeNull();
  });
});

describe("PostgresStorage", () => {
  it("round-trips, overwrites, and rejects traversal keys", async () => {
    const storage = new PostgresStorage();
    const key = `u1/repo/chk_${Date.now()}/checks.json`;
    await storage.put(key, "[1,2,3]");
    expect(await storage.get(key)).toBe("[1,2,3]");
    // Re-ingest of a changed record must overwrite, not duplicate.
    await storage.put(key, "[4,5,6]");
    expect(await storage.get(key)).toBe("[4,5,6]");
    expect(await storage.get("u1/repo/missing/x.json")).toBeNull();
    await expect(storage.put("../escape", "x")).rejects.toThrow("unsafe");
  });
});

describe("LocalDirStorage", () => {
  it("round-trips and rejects traversal keys", async () => {
    const dir = `/tmp/proofjury-storage-test-${process.pid}`;
    const storage = new LocalDirStorage(dir);
    await storage.put("u1/repo/chk_001/checks.json", "[1,2,3]");
    expect(await storage.get("u1/repo/chk_001/checks.json")).toBe("[1,2,3]");
    expect(await storage.get("u1/repo/missing/x.json")).toBeNull();
    await expect(storage.put("../escape", "x")).rejects.toThrow("unsafe");
  });
});

/**
 * Real S3-API round-trip — runs only when R2/MinIO creds are present
 * (kept out of the default suite so CI stays hermetic). Self-provisions
 * its bucket, so it works against a fresh MinIO or a real R2 account:
 *
 *   R2_ENDPOINT=http://localhost:9000 R2_BUCKET=proofs \
 *   R2_ACCESS_KEY_ID=minioadmin R2_SECRET_ACCESS_KEY=minioadmin \
 *   npx vitest run tests/storage.test.ts
 */
describe.skipIf(!process.env.R2_ENDPOINT)("S3Storage (S3 API)", () => {
  beforeEach(async () => {
    const { S3Client, CreateBucketCommand } = await import(
      "@aws-sdk/client-s3"
    );
    const client = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
      },
    });
    try {
      await client.send(
        new CreateBucketCommand({ Bucket: process.env.R2_BUCKET }),
      );
    } catch {
      // already exists — fine
    }
  });

  it("round-trips a proof file", async () => {
    const storage = new S3Storage();
    const key = `u1/repo/chk_${Date.now()}/impact.json`;
    const result = await storage.put(key, '{"depth":2}');
    expect(result.url).toBeNull(); // private bucket
    expect(await storage.get(key)).toBe('{"depth":2}');
    expect(await storage.get("u1/repo/nope/x.json")).toBeNull();
  });
});
