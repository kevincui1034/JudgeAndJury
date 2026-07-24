/**
 * The mark: a flow arriving at a barrier — "the last command before
 * production". Deliberately NOT a shield or a padlock; this product guards
 * correctness, not security, and the mark should not claim otherwise.
 *
 * Server-safe: pure SVG, no hooks.
 */
import { cx } from "@/components/ui/primitives";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={cx("size-[18px]", className)}
    >
      {/* the gate */}
      <path
        d="M16.5 4.5v15"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
      {/* the command, arriving */}
      <path
        d="M4 12h6.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        opacity="0.75"
      />
      <path
        d="M8.75 8.75 12 12l-3.25 3.25"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.75"
      />
    </svg>
  );
}

export function LogoTile({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "grid size-8 shrink-0 place-items-center rounded-[9px] border border-amber/30 bg-amber/12 text-amber-ink",
        className,
      )}
    >
      <LogoMark />
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "text-[15px] font-medium tracking-[-0.01em] text-ink",
        className,
      )}
    >
      Proofjury
    </span>
  );
}
