/**
 * Shared presentational primitives. Server-safe (no "use client") so pages
 * stay RSC and `router.refresh()` can update them with zero client state.
 */
import Link from "next/link";
import { Check, X, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ————— surfaces ————— */

export function GlassPanel({
  children,
  className,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "aside";
}) {
  return (
    <Tag className={cx("glass glass-edge rounded-2xl", className)}>{children}</Tag>
  );
}

export function PanelHeader({
  title,
  accent,
  right,
  hint,
  icon: Icon,
}: {
  title: string;
  /** Second half of the title, rendered in the brand tint. */
  accent?: string;
  right?: ReactNode;
  hint?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon && (
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-tint text-faint">
            <Icon className="size-3.5" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-medium text-ink">
            {title}
            {accent && <span className="text-amber-ink"> {accent}</span>}
          </h2>
          {hint && <p className="mt-0.5 text-xs text-faint">{hint}</p>}
        </div>
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}

/**
 * The page title block. Ten pages hand-rolled the same markup; this is the
 * one place it lives now.
 */
export function PageHeader({
  title,
  accent,
  sub,
  right,
}: {
  title: string;
  accent?: string;
  sub?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 px-1 pt-1 pb-1">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-[1.1] font-semibold tracking-[-0.02em] text-ink sm:text-[34px]">
          {title}
          {accent && <span className="text-amber-ink"> {accent}</span>}
        </h1>
        {sub && (
          <div className="mt-2 max-w-2xl text-[13px] leading-relaxed text-faint">
            {sub}
          </div>
        )}
      </div>
      {right && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div>
      )}
    </div>
  );
}

/* ————— text ————— */

export function Mono({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cx("font-mono text-[12px] tracking-tight", className)}>
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  hint,
  action,
  icon: Icon,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {Icon && (
        <span className="mb-1 grid size-10 place-items-center rounded-xl bg-tint text-faint">
          <Icon className="size-4.5" />
        </span>
      )}
      <p className="text-sm text-body">{title}</p>
      {hint && <p className="max-w-md text-xs leading-relaxed text-faint">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Relative time, rendered server-side so there is no hydration mismatch. */
export function timeAgo(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const then = typeof value === "string" ? new Date(value) : value;
  const secs = Math.floor((Date.now() - then.getTime()) / 1000);
  if (Number.isNaN(secs)) return "—";
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return then.toISOString().slice(0, 10);
}

/* ————— badges ————— */

export function VerdictBadge({ passed }: { passed: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full py-0.5 pr-2.5 pl-1.5 text-[11px] font-medium",
        passed
          ? "bg-verdict-green/12 text-verdict-green"
          : "bg-verdict-red/12 text-verdict-red",
      )}
    >
      {passed ? (
        <Check className="size-3 shrink-0" strokeWidth={2.75} />
      ) : (
        <X className="size-3 shrink-0" strokeWidth={2.75} />
      )}
      {passed ? "passed" : "blocked"}
    </span>
  );
}

export function ClassChip({ name }: { name: string }) {
  return (
    <span className="inline-flex rounded-md border border-verdict-red/20 bg-verdict-red/8 px-1.5 py-0.5 font-mono text-[11px] text-verdict-red">
      {name}
    </span>
  );
}

const TONES = {
  neutral: "border-line-2 bg-tint text-body",
  amber: "border-amber/30 bg-amber/10 text-amber-ink",
  green: "border-verdict-green/26 bg-verdict-green/10 text-verdict-green",
  red: "border-verdict-red/26 bg-verdict-red/10 text-verdict-red",
  violet: "border-bot-violet/28 bg-bot-violet/10 text-bot-violet",
  teal: "border-bot-teal/28 bg-bot-teal/10 text-bot-teal",
  faint: "border-line bg-tint/50 text-faint",
} as const;

export type Tone = keyof typeof TONES;

export function Badge({
  children,
  tone = "neutral",
  mono,
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  mono?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]",
        mono && "font-mono",
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Delivery state → how it reads to a human. Mirrors the CLI's ux.py labels. */
export const DELIVERY_LABEL: Record<string, string> = {
  injected: "sent to agent",
  held: "held — awaiting you",
  staged: "approved — delivers next event",
  sent: "delivered",
  suppressed: "below noise floor",
  recorded: "recorded only",
};

export const DELIVERY_TONE: Record<string, Tone> = {
  injected: "amber",
  held: "violet",
  staged: "teal",
  sent: "green",
  suppressed: "faint",
  recorded: "faint",
};

export function DeliveryBadge({ delivery }: { delivery: string | null }) {
  if (!delivery) return null;
  return (
    <Badge tone={DELIVERY_TONE[delivery] ?? "neutral"}>
      {DELIVERY_LABEL[delivery] ?? delivery}
    </Badge>
  );
}

/* ————— data display ————— */

const STAT_TONE: Record<string, string> = {
  red: "text-verdict-red",
  green: "text-verdict-green",
  amber: "text-amber-ink",
  violet: "text-bot-violet",
  teal: "text-bot-teal",
};

export function StatTile({
  label,
  value,
  sub,
  spark,
  href,
  tone = "neutral",
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  spark?: ReactNode;
  href?: string;
  tone?: Tone;
  icon?: LucideIcon;
}) {
  const body = (
    <div className="glass glass-edge tile-grid relative h-full overflow-hidden rounded-2xl px-4 py-4 transition-[border-color,box-shadow,transform] hover:border-[color:var(--glass-highlight)] hover:shadow-[var(--overlay-shadow)]">
      <div className="flex items-center gap-2">
        {Icon && (
          <Icon
            className={cx(
              "size-3.5 shrink-0",
              tone === "neutral" ? "text-faint" : STAT_TONE[tone],
            )}
          />
        )}
        <span className="truncate text-[11px] font-medium tracking-[0.08em] text-faint uppercase">
          {label}
        </span>
      </div>
      <div className="mt-2.5 flex items-end justify-between gap-3">
        <span
          className={cx(
            "tnum text-[28px] leading-none font-semibold tracking-[-0.02em]",
            STAT_TONE[tone] ?? "text-ink",
          )}
        >
          {value}
        </span>
        {spark && <div className="shrink-0 opacity-90">{spark}</div>}
      </div>
      {sub && <p className="mt-2 text-[11px] leading-snug text-faint">{sub}</p>}
    </div>
  );
  return href ? (
    <Link
      href={href}
      className="block h-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-amber/50"
    >
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * Sparkline — hand-rolled SVG path. Recharts on a 60px tile is pure
 * overhead: no axes, no tooltip, no legend, and it would force the tile
 * to become a client component.
 */
export function Sparkline({
  points,
  width = 72,
  height = 26,
  tone = "var(--body)",
  fill = true,
}: {
  points: number[];
  width?: number;
  height?: number;
  tone?: string;
  fill?: boolean;
}) {
  if (points.length === 0) return null;
  if (points.length === 1) points = [points[0], points[0]];
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const xy = points.map((p, i) => {
    const x = i * step;
    const y = height - ((p - min) / span) * (height - 4) - 2;
    return [x, y] as const;
  });
  const line = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      {fill && <path d={area} fill={tone} opacity={0.1} />}
      <path d={line} fill="none" stroke={tone} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r={2} fill={tone} />
    </svg>
  );
}

/** Ranked table row with an inline proportion bar (reference #1). */
export function RankedRow({
  rank,
  label,
  value,
  share,
  tone = "var(--body)",
  right,
}: {
  rank: number;
  label: ReactNode;
  value: string;
  share: number; // 0..1
  tone?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-line/70 px-5 py-2.5 first:border-t-0">
      <span className="tnum w-4 shrink-0 text-[11px] text-faint">{rank}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-body">{label}</div>
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-tint-strong">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.max(2, Math.min(100, share * 100))}%`,
              background: tone,
              opacity: 0.75,
            }}
          />
        </div>
      </div>
      <span className="tnum shrink-0 text-[13px] text-ink">{value}</span>
      {right}
    </div>
  );
}

export function pct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function ms(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`;
}
