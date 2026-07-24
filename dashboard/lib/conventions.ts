/**
 * Team conventions (Senso) — parsed out of the STORED advisory prompt.
 *
 * No new plumbing is needed: the CLI already embeds conventions into
 * `advisory_input` (and `checkpoint_input`) as
 *   - <statement> [source: <doc>]
 * under a "Team conventions authored by this org" header. Reading them
 * back out is rendering stored text, which keeps the cloud side on the
 * right side of "their agent computes, we visualize" — nothing here
 * analyses user code.
 */

const HEADER = "Team conventions authored by this org";
const SOURCE_RE = /\s*\[source:\s*([^\]]+)\]\s*$/;

export interface Convention {
  statement: string;
  source: string | null;
}

export function parseConventions(promptText: string | null | undefined): Convention[] {
  if (!promptText) return [];
  const lines = promptText.split("\n");
  const start = lines.findIndex((l) => l.includes(HEADER));
  if (start === -1) return [];

  const out: Convention[] = [];
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trimEnd();
    if (!line.startsWith("- ")) break; // section ends at the first non-bullet
    const body = line.slice(2).trim();
    if (!body) continue;
    const match = body.match(SOURCE_RE);
    out.push({
      statement: match ? body.replace(SOURCE_RE, "").trim() : body,
      source: match ? match[1].trim() : null,
    });
  }
  return out;
}

/** Replay recording permalinks embedded in check evidence by the CLI. */
const REPLAY_RE = /https:\/\/app\.replay\.io\/recording\/\S+/g;

export function replayLinks(evidence: string | null | undefined): string[] {
  if (!evidence) return [];
  return Array.from(new Set(evidence.match(REPLAY_RE) ?? [])).map((u) =>
    u.replace(/[.,);]+$/, ""),
  );
}
