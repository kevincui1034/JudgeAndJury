/**
 * Proof-file storage. Proof files are scrubbed but still private code
 * context: the browser reads them ONLY through the authed proxy route
 * (app/api/proof/...), never a direct storage URL.
 *
 * Drivers: LocalDirStorage under dashboard/.data/blob/ (dev + tests);
 * R2Storage (Cloudflare R2, S3-compatible) in production. R2 buckets are
 * private by default — put() returns url:null and the proxy streams via
 * get(), so no object is ever publicly reachable.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ProofStorage {
  /** Store `body` at `key`; returns a fetchable URL only if the driver
   *  exposes one (R2/local do not — they're read back through get()). */
  put(key: string, body: string): Promise<{ url: string | null }>;
  /** Read back by key; null when missing. */
  get(key: string): Promise<string | null>;
}

/** Reject path traversal — keys are {userId}/{repoSlug}/{recordId}/{name}. */
function safeKey(key: string): string {
  const normalized = path.posix.normalize(key);
  if (normalized.startsWith("..") || path.posix.isAbsolute(normalized)) {
    throw new Error(`unsafe storage key: ${key}`);
  }
  return normalized;
}

export class LocalDirStorage implements ProofStorage {
  constructor(
    private baseDir: string = path.join(process.cwd(), ".data", "blob"),
  ) {}

  async put(key: string, body: string): Promise<{ url: string | null }> {
    const rel = safeKey(key);
    const file = path.join(this.baseDir, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body, "utf8");
    return { url: null };
  }

  async get(key: string): Promise<string | null> {
    try {
      return await readFile(path.join(this.baseDir, safeKey(key)), "utf8");
    } catch {
      return null;
    }
  }
}

/**
 * Proof files in Postgres — the default driver.
 *
 * Chosen over object storage because it removes an entire vendor from the
 * deploy: with Supabase (or any Postgres) already required for records,
 * blobs need no second service, no second set of credentials, and no
 * public-bucket footgun. The size ceiling is enforced upstream (the CLI
 * truncates at 1 MB per file, ingest rejects bodies over 4 MB), so rows
 * stay small.
 *
 * put() returns url:null like every other driver — proof content reaches
 * the browser only through the authed proxy route.
 */
export class PostgresStorage implements ProofStorage {
  async put(key: string, body: string): Promise<{ url: string | null }> {
    const safe = safeKey(key);
    const { db } = await import("@/db");
    const { proofBlobs } = await import("@/db/schema");
    const values = {
      content: body,
      sizeBytes: Buffer.byteLength(body, "utf8"),
      updatedAt: new Date(),
    };
    await db
      .insert(proofBlobs)
      .values({ key: safe, ...values })
      .onConflictDoUpdate({ target: proofBlobs.key, set: values });
    return { url: null };
  }

  async get(key: string): Promise<string | null> {
    try {
      const safe = safeKey(key);
      const { db } = await import("@/db");
      const { proofBlobs } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      const [row] = await db
        .select({ content: proofBlobs.content })
        .from(proofBlobs)
        .where(eq(proofBlobs.key, safe))
        .limit(1);
      return row?.content ?? null;
    } catch {
      return null;
    }
  }
}

/**
 * Any S3-compatible object store — Supabase Storage, Cloudflare R2, MinIO.
 *
 * Kept because object storage is the right call at volume, but it is no
 * longer the default. The SDK is dynamic-imported so the other drivers
 * never load it, and `forcePathStyle` defaults on because Supabase
 * Storage and MinIO both require it (R2 tolerates it).
 *
 * Config is read from STORAGE_* / SUPABASE_STORAGE_* / R2_* — see
 * resolveS3Config. The R2_* names are kept working so an existing
 * deployment keeps its environment.
 */
export interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

const env = (...names: string[]): string | undefined => {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return undefined;
};

/**
 * Resolve S3 settings from whichever vendor's variables are present.
 * Supabase exposes its S3 endpoint at <project>/storage/v1/s3, which we
 * derive from SUPABASE_URL so only the keys need setting by hand.
 */
export function resolveS3Config(): S3Config | null {
  const supabaseUrl = env("SUPABASE_URL");
  const derivedSupabaseEndpoint = supabaseUrl
    ? `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/s3`
    : undefined;

  const endpoint = env("STORAGE_ENDPOINT", "R2_ENDPOINT") ?? derivedSupabaseEndpoint;
  const bucket = env("STORAGE_BUCKET", "R2_BUCKET", "SUPABASE_STORAGE_BUCKET");
  if (!endpoint || !bucket) return null;

  return {
    endpoint,
    bucket,
    region: env("STORAGE_REGION", "R2_REGION", "SUPABASE_REGION") ?? "auto",
    accessKeyId:
      env("STORAGE_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID", "SUPABASE_STORAGE_KEY_ID") ?? "",
    secretAccessKey:
      env(
        "STORAGE_SECRET_ACCESS_KEY",
        "R2_SECRET_ACCESS_KEY",
        "SUPABASE_STORAGE_ACCESS_KEY",
      ) ?? "",
    forcePathStyle:
      env("STORAGE_FORCE_PATH_STYLE", "R2_FORCE_PATH_STYLE") !== "false",
  };
}

export class S3Storage implements ProofStorage {
  private clientPromise?: Promise<import("@aws-sdk/client-s3").S3Client>;
  private config: S3Config;

  constructor(config: S3Config | null = resolveS3Config()) {
    if (!config) {
      throw new Error(
        "S3 storage is not configured (need an endpoint + bucket, or SUPABASE_URL + bucket)",
      );
    }
    this.config = config;
  }

  private get bucket(): string {
    return this.config.bucket;
  }

  private client() {
    if (!this.clientPromise) {
      const c = this.config;
      this.clientPromise = import("@aws-sdk/client-s3").then(
        ({ S3Client }) =>
          new S3Client({
            region: c.region,
            endpoint: c.endpoint,
            forcePathStyle: c.forcePathStyle,
            credentials: {
              accessKeyId: c.accessKeyId,
              secretAccessKey: c.secretAccessKey,
            },
          }),
      );
    }
    return this.clientPromise;
  }

  async put(key: string, body: string): Promise<{ url: string | null }> {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: safeKey(key),
        Body: body,
        ContentType: "text/plain; charset=utf-8",
      }),
    );
    // Private bucket by design — served only via the authed proxy.
    return { url: null };
  }

  async get(key: string): Promise<string | null> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    try {
      const result = await client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }),
      );
      const body = result.Body as
        | { transformToString?: () => Promise<string> }
        | undefined;
      return body?.transformToString ? await body.transformToString() : null;
    } catch {
      // Missing object or read failure → treated as not found (the proxy
      // route then returns 404). Never leak the storage error to callers.
      return null;
    }
  }
}

/** Back-compat alias — the driver is vendor-neutral now. */
export { S3Storage as R2Storage };

/**
 * Driver selection.
 *
 * Postgres is the DEFAULT: it needs no second vendor, and it fixes a real
 * deployment trap in the previous fallback — LocalDirStorage on a
 * serverless host writes to an ephemeral filesystem, so proof files would
 * silently disappear between requests with no error anywhere.
 *
 * BLOB_DRIVER forces a driver explicitly ("local" | "postgres" | "s3").
 */
export function getStorage(): ProofStorage {
  const driver = process.env.BLOB_DRIVER;
  if (driver === "local") return new LocalDirStorage();
  if (driver === "postgres") return new PostgresStorage();
  if (driver === "s3") return new S3Storage();

  // Object storage only when it is actually configured...
  if (resolveS3Config()) return new S3Storage();
  // ...otherwise Postgres, which is always present for this app.
  if (process.env.DATABASE_URL) return new PostgresStorage();
  return new LocalDirStorage();
}
