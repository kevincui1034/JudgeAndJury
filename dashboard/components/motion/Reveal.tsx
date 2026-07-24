/**
 * Scroll reveal — MARKETING ONLY, and deliberately server-safe CSS.
 *
 * An in-view JS reveal renders the server HTML at opacity:0 and only unhides
 * it once an observer fires. With JS blocked, or for a crawler, that leaves
 * the entire page below the fold blank. The `.reveal` class in globals.css
 * inverts that: visible by default, animated only where a view() timeline is
 * supported.
 *
 * Not for the dashboard. LiveDot calls router.refresh() whenever the heartbeat
 * moves, and anything replaying an entry animation on data change would
 * flicker every few seconds.
 */
import type { ReactNode } from "react";

import { cx } from "@/components/ui/primitives";

export function Reveal({
  children,
  className,
  /** Stagger step; feeds --d in the animation-range calc. */
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <div
      className={cx("reveal", className)}
      style={delay ? ({ "--d": delay } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}

/** Grid/list wrapper — children stagger via their index. */
export function Stagger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={className}>{children}</div>;
}

export function StaggerItem({
  children,
  className,
  index = 0,
}: {
  children: ReactNode;
  className?: string;
  index?: number;
}) {
  return (
    <div
      className={cx("reveal h-full", className)}
      style={{ "--d": index % 6 } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
