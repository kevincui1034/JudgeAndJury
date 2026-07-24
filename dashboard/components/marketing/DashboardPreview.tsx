/**
 * The product shot — recreated in DOM from the REAL primitives rather than
 * captured as a screenshot. Three reasons:
 *   1. It cannot drift; change StatTile and this updates.
 *   2. It renders in BOTH worlds. A PNG would be locked to one theme, which
 *      is fatal with a day/night toggle above the fold.
 *   3. It is a free smoke test for the token layer.
 *
 * Deliberately NOT rendering <VerdictTimeseries>: recharts' ResponsiveContainer
 * measures its parent, and inside a CSS scale() transform that measurement is
 * unreliable — you get a zero-height chart or a resize loop. The area chart
 * below is a static path with the same gradient stops.
 *
 * The whole subtree is aria-hidden and pointer-events-none, and the fixture
 * StatTiles carry no href, so no links live inside decorative content.
 */
import { LayoutGrid, ListTree, Scale, Settings2 } from "lucide-react";

import { PREVIEW } from "@/components/marketing/fixtures";
import {
  Badge,
  ClassChip,
  Mono,
  RankedRow,
  Sparkline,
  StatTile,
  VerdictBadge,
  cx,
  pct,
} from "@/components/ui/primitives";

function StaticAreaChart() {
  // A fixed path so there is no measurement and no client JS at all.
  const line =
    "M0,74 L40,66 L80,70 L120,52 L160,58 L200,38 L240,44 L280,26 L320,32 L360,18 L400,24 L440,10";
  return (
    <svg viewBox="0 0 440 96" preserveAspectRatio="none" className="h-[132px] w-full">
      <defs>
        <linearGradient id="pv-pass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--verdict-green)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--verdict-green)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L440,96 L0,96 Z`} fill="url(#pv-pass)" />
      <path
        d={line}
        fill="none"
        stroke="var(--verdict-green)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M0,88 L40,84 L80,86 L120,78 L160,82 L200,74 L240,80 L280,72 L320,76 L360,70 L400,74 L440,68"
        fill="none"
        stroke="var(--verdict-red)"
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.85"
      />
    </svg>
  );
}

const NAV = [
  { label: "Overview", icon: LayoutGrid, active: true },
  { label: "Traces", icon: ListTree, active: false },
  { label: "Judge & models", icon: Scale, active: false },
  { label: "Gate config", icon: Settings2, active: false },
];

export function DashboardPreview({ className }: { className?: string }) {
  const maxClass = PREVIEW.classes[0].count;

  return (
    <div aria-hidden className={cx("pointer-events-none select-none", className)}>
      <div className="glass glass-edge overflow-hidden rounded-2xl">
        {/* browser chrome */}
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-verdict-red/50" />
            <span className="size-2.5 rounded-full bg-amber/50" />
            <span className="size-2.5 rounded-full bg-verdict-green/50" />
          </span>
          <span className="mx-auto rounded-md bg-tint px-3 py-0.5 font-mono text-[10.5px] text-faint">
            app.proofjury.com/r/demo-app
          </span>
        </div>

        <div className="flex gap-3 p-3">
          {/* rail */}
          <div className="hidden w-[150px] shrink-0 flex-col gap-0.5 sm:flex">
            <div className="glass-flat mb-3 rounded-lg px-2.5 py-2">
              <p className="truncate font-mono text-[10.5px] text-ink">demo-app</p>
              <p className="text-[9px] text-faint">connected repo</p>
            </div>
            {NAV.map((n) => (
              <div
                key={n.label}
                className={cx(
                  "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px]",
                  n.active ? "bg-amber/10 text-ink" : "text-faint",
                )}
              >
                <n.icon
                  className={cx("size-3", n.active ? "text-amber-ink" : "")}
                />
                {n.label}
              </div>
            ))}
          </div>

          {/* content */}
          <div className="min-w-0 flex-1 space-y-3">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <StatTile
                label="Gate runs"
                value={String(PREVIEW.runs)}
                sub={`${PREVIEW.passed} passed · ${PREVIEW.blocked} blocked`}
                spark={<Sparkline points={[...PREVIEW.runsSpark]} tone="var(--body)" />}
              />
              <StatTile
                label="Blocked"
                value={pct(PREVIEW.blockRate)}
                sub="stopped before prod"
                tone="red"
                spark={
                  <Sparkline
                    points={[...PREVIEW.blockedSpark]}
                    tone="var(--verdict-red)"
                  />
                }
              />
              <StatTile
                label="Recall hit rate"
                value={pct(PREVIEW.recallHit)}
                sub="matched to a prior"
                tone="amber"
              />
              <StatTile
                label="p95 gate time"
                value={`${(PREVIEW.p95Ms / 1000).toFixed(1)}s`}
                sub="checks + recall + judge"
              />
            </div>

            <div className="glass glass-edge rounded-2xl">
              <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <p className="text-[12.5px] font-medium text-ink">
                  Verdicts <span className="text-amber-ink">over time</span>
                </p>
                <div className="flex items-center gap-2.5 text-[9.5px] text-faint">
                  <span className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-verdict-green" />
                    passed
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-verdict-red" />
                    blocked
                  </span>
                </div>
              </div>
              <div className="px-2 pb-2">
                <StaticAreaChart />
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="glass glass-edge rounded-2xl pb-2">
                <p className="px-4 pt-3 pb-2 text-[12.5px] font-medium text-ink">
                  Failure <span className="text-amber-ink">classes</span>
                </p>
                {PREVIEW.classes.map((c, i) => (
                  <RankedRow
                    key={c.name}
                    rank={i + 1}
                    label={<ClassChip name={c.name} />}
                    value={String(c.count)}
                    share={c.count / maxClass}
                    tone="var(--verdict-red)"
                  />
                ))}
              </div>

              <div className="glass glass-edge rounded-2xl pb-2">
                <p className="px-4 pt-3 pb-2 text-[12.5px] font-medium text-ink">
                  Recent <span className="text-amber-ink">traces</span>
                </p>
                {PREVIEW.traces.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 border-t border-line/70 px-4 py-2 first:border-t-0"
                  >
                    <Mono className="shrink-0 text-[11px] text-body">{t.id}</Mono>
                    <VerdictBadge passed={t.passed} />
                    <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                      {t.classes.slice(0, 1).map((c) => (
                        <ClassChip key={c} name={c} />
                      ))}
                      {t.recalled && (
                        <Badge tone="violet" mono>
                          ↩ {t.recalled}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
