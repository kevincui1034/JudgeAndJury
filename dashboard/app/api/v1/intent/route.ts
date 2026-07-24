import { ingestIntent } from "@/lib/intent";
import { authenticateBearer } from "@/lib/tokens";

/** Same limit as /ingest — Vercel's function body cap is ~4.5 MB. */
const MAX_BODY_BYTES = 4_000_000;

export async function POST(request: Request) {
  const device = await authenticateBearer(request);
  if (!device) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_intent", detail: "body is not JSON" },
      { status: 400 },
    );
  }
  const result = await ingestIntent(device.userId, payload);
  if (result.status === "invalid") {
    return Response.json(
      { error: "invalid_intent", detail: result.detail },
      { status: 400 },
    );
  }
  return Response.json({
    status: "ok",
    checkpoints: result.checkpoints,
    prefs: result.prefs,
    ledger: result.ledger,
    config: result.config,
  });
}
