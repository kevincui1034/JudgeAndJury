/**
 * Sponsor identity primitives. Server-safe (no "use client") so every page
 * that uses them stays RSC.
 *
 * The marks are neutral geometric glyphs, NOT reproductions of anyone's
 * trademark — this repo ships no brand assets and inventing a lookalike logo
 * would misrepresent the vendor. Each is a distinct abstract shape keyed to
 * what the integration actually does.
 */
import type { Sponsor, SponsorId } from "@/lib/sponsors";
import { Badge, cx, type Tone } from "@/components/ui/primitives";

const TONE_TEXT: Record<Sponsor["tone"], string> = {
  red: "text-verdict-red",
  amber: "text-amber-ink",
  violet: "text-bot-violet",
  teal: "text-bot-teal",
};

const TONE_BG: Record<Sponsor["tone"], string> = {
  red: "bg-verdict-red/10 border-verdict-red/25",
  amber: "bg-amber/10 border-amber/25",
  violet: "bg-bot-violet/10 border-bot-violet/25",
  teal: "bg-bot-teal/10 border-bot-teal/25",
};

/** Abstract glyphs — a play button, a vector field, a document, a switchboard. */
function Glyph({ id }: { id: SponsorId }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (id) {
    case "replay": // a recorded run
      return (
        <svg viewBox="0 0 16 16" className="size-3.5" {...common}>
          <path d="M2.6 8a5.4 5.4 0 1 1 1.6 3.8" />
          <path d="M2.2 12.2V9.4h2.8" />
          <path d="M7 6.4l3 1.6-3 1.6z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "actian": // nearest neighbours in a vector space
      return (
        <svg viewBox="0 0 16 16" className="size-3.5" {...common}>
          <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="3" cy="4.5" r="1.1" />
          <circle cx="13" cy="5" r="1.1" />
          <circle cx="4" cy="12.5" r="1.1" />
          <path d="M6.7 7.2 4.1 5.4M9.4 7.4l2.5-1.5M7.2 9.2l-2.3 2.2" />
        </svg>
      );
    case "senso": // an authored document, cited
      return (
        <svg viewBox="0 0 16 16" className="size-3.5" {...common}>
          <path d="M4 2.5h5.5L12 5v8.5H4z" />
          <path d="M9.3 2.6V5H12" />
          <path d="M6 8h4M6 10.5h2.5" />
        </svg>
      );
    case "pioneer": // routing between models
      return (
        <svg viewBox="0 0 16 16" className="size-3.5" {...common}>
          <circle cx="3.5" cy="8" r="1.3" />
          <circle cx="12.5" cy="4.5" r="1.3" />
          <circle cx="12.5" cy="11.5" r="1.3" />
          <path d="M4.8 7.4 11.2 4.9M4.8 8.6l6.4 2.5" />
        </svg>
      );
  }
}

/** Square mark used in lists and headers. */
export function SponsorMark({
  sponsor,
  className,
}: {
  sponsor: Sponsor;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cx(
        "grid size-7 shrink-0 place-items-center rounded-lg border",
        TONE_BG[sponsor.tone],
        TONE_TEXT[sponsor.tone],
        className,
      )}
    >
      <Glyph id={sponsor.id} />
    </span>
  );
}

/**
 * The authority badge. This is the component that keeps the ground rule
 * visible everywhere a sponsor appears: exactly one can fail the gate.
 */
export function AuthorityBadge({ sponsor }: { sponsor: Sponsor }) {
  return (
    <Badge tone={sponsor.decides ? "red" : "faint"}>{sponsor.authority}</Badge>
  );
}

/** Small inline attribution, e.g. "via Actian" under a recall row. */
export function SponsorTag({
  sponsor,
  prefix = "via",
}: {
  sponsor: Sponsor;
  prefix?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 text-[10.5px]",
        TONE_TEXT[sponsor.tone],
      )}
      title={sponsor.note}
    >
      <Glyph id={sponsor.id} />
      {prefix} {sponsor.name}
    </span>
  );
}

/** Maps a sponsor tone onto the Badge tone union. */
export function sponsorTone(sponsor: Sponsor): Tone {
  return sponsor.tone as Tone;
}
