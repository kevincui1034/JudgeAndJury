/**
 * Published team conventions — the authored policy Senso serves to the judge.
 *
 * These are real documents, not fixtures: the judge may cite them, and a cited
 * statement carries a [source: doc] tag into the finding so advice is
 * traceable back to something a human wrote. This registry is what lets the
 * dashboard resolve a citation slug back to a title and a link.
 *
 * A citation is CONTEXT. A cited convention never decides a verdict — it only
 * explains one that deterministic checks already reached.
 */

export interface SensoDoc {
  /** Slug as it appears in a [source: …] tag. */
  slug: string;
  title: string;
  /** One line, shown under the title in the conventions panel. */
  summary: string;
  url: string;
  /** The questions this doc is the answer to — used for matching + display. */
  topics: string[];
}

export const SENSO_DOCS: SensoDoc[] = [
  {
    slug: "what-is-proofjury-and-what-does-it-do",
    title: "What is Proofjury and what does it do?",
    summary:
      "The deploy boundary, how pass/fail is decided, what the proof record contains, and what it explicitly does not do.",
    url: "https://cited.md/article/what-is-proofjury-and-what-does-it-do",
    topics: ["scope", "proof record", "agent workflow"],
  },
  {
    slug: "how-does-proofjury-compare-to-ci-checks-like-github-actions",
    title: "How does Proofjury compare to CI checks like GitHub Actions?",
    summary:
      "Runs on the developer's machine before the command spawns, rather than on a server after a push. It does not replace CI — teams keep both.",
    url: "https://cited.md/article/how-does-proofjury-compare-to-ci-checks-like-github-actions",
    topics: ["ci", "comparison", "release policy"],
  },
  {
    slug: "how-do-i-override-a-proofjury-block-when-i-need-to-ship",
    title: "How do I override a Proofjury block when I need to ship?",
    summary:
      "There is no force-through switch. Read the block, fix the cause, re-run the gated command — and if the gate is wrong, label it so recall learns.",
    url: "https://cited.md/article/how-do-i-override-a-proofjury-block-when-i-need-to-ship",
    topics: ["override", "false positives", "release policy"],
  },
];

export const SENSO_DOC_BY_SLUG: Record<string, SensoDoc> = Object.fromEntries(
  SENSO_DOCS.map((d) => [d.slug, d]),
);

/**
 * Resolve a raw `[source: …]` value to a known document.
 *
 * Citations arrive as free text produced upstream, so this matches leniently —
 * exact slug, then a slugified title, then a containment test — and returns
 * undefined rather than guessing when nothing matches. An unresolved citation
 * must still render its raw text; dropping it would hide a real citation.
 */
export function resolveSensoDoc(source: string): SensoDoc | undefined {
  const norm = source
    .trim()
    .toLowerCase()
    .replace(/^\[?source:\s*/, "")
    .replace(/\]$/, "")
    .replace(/\.(md|html?)$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!norm) return undefined;
  if (SENSO_DOC_BY_SLUG[norm]) return SENSO_DOC_BY_SLUG[norm];
  return SENSO_DOCS.find(
    (d) => norm.includes(d.slug) || d.slug.includes(norm),
  );
}
