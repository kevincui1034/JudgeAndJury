/**
 * A floating glass card that sits OVER the timeseries (reference #1).
 *
 * Deliberately not a Recharts child: rendering it as a chart element would
 * put it inside the SVG, where it would be clipped by the plot area, lose
 * crisp text rendering, and stop being a real link.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "@/components/ui/primitives";

export function OverlayCard({
  label,
  value,
  sub,
  right,
  href,
  className,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  href?: string;
  className?: string;
  tone?: "neutral" | "amber" | "red" | "green" | "violet";
}) {
  const accent =
    tone === "amber"
      ? "text-amber-ink"
      : tone === "red"
        ? "text-verdict-red"
        : tone === "green"
          ? "text-verdict-green"
          : tone === "violet"
            ? "text-bot-violet"
            : "text-ink";

  const inner = (
    <div
      className={cx(
        "glass-overlay glass-edge min-w-[190px] rounded-xl px-3.5 py-2.5 transition-transform",
        href && "hover:-translate-y-0.5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] tracking-wide text-faint uppercase">{label}</p>
          <p className={cx("tnum mt-1 text-[19px] leading-none font-medium", accent)}>
            {value}
          </p>
          {sub && <p className="mt-1.5 text-[11px] text-faint">{sub}</p>}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
    </div>
  );

  return href ? <Link href={href}>{inner}</Link> : inner;
}
