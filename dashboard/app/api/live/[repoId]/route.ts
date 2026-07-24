import { sql } from "drizzle-orm";

import { auth } from "@/auth";
import { db } from "@/db";

/**
 * Heartbeat: the newest cursor across the three tables a repo grows.
 *
 * Polling rather than SSE on purpose — Postgres LISTEN/NOTIFY needs a
 * persistent connection, and transaction poolers (Neon pooled, Supabase
 * 6543) do not support it. One indexed query is cheaper than holding a
 * connection open per viewer on serverless.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ repoId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { repoId } = await params;

  const result = await db.execute(sql`
    SELECT
      (SELECT extract(epoch FROM max(ingested_at))::bigint FROM records r
        JOIN repos ON repos.id = r.repo_pk
        WHERE r.repo_pk = ${repoId} AND repos.user_id = ${session.user.id}) AS records,
      (SELECT extract(epoch FROM max(ingested_at))::bigint FROM checkpoints c
        JOIN repos ON repos.id = c.repo_pk
        WHERE c.repo_pk = ${repoId} AND repos.user_id = ${session.user.id}) AS checkpoints,
      (SELECT max(id)::bigint FROM label_events e
        JOIN repos ON repos.id = e.repo_pk
        WHERE e.repo_pk = ${repoId} AND repos.user_id = ${session.user.id}) AS events
  `);
  const row = result.rows[0] as {
    records: number | null;
    checkpoints: number | null;
    events: number | null;
  };
  return Response.json({
    cursor: `${row.records ?? 0}:${row.checkpoints ?? 0}:${row.events ?? 0}`,
  });
}
