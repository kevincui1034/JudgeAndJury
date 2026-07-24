"use client";

/**
 * Gate verdicts over time. Recharts earns its place here (axes, tooltip,
 * responsive container); the stat-tile sparklines do not use it.
 *
 * Everything is CSS-var themed so the chart follows the design tokens
 * rather than carrying its own palette.
 */
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { BucketPoint, BucketUnit } from "@/lib/queries/highlights";

export function VerdictTimeseries({
  data,
  unit,
}: {
  data: BucketPoint[];
  unit: BucketUnit;
}) {
  // One bucket cannot describe a trend — an area chart would draw a ramp
  // from an implied zero and invent history that does not exist. The page
  // renders a session summary instead.
  if (data.length < 2) return null;

  const fmt = (value: string) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return unit === "day"
      ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  };

  return (
    <div className="h-[260px] w-full px-2 pb-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <defs>
            <linearGradient id="pj-pass" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--verdict-green)" stopOpacity={0.34} />
              <stop offset="100%" stopColor="var(--verdict-green)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="pj-block" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--verdict-red)" stopOpacity={0.34} />
              <stop offset="100%" stopColor="var(--verdict-red)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="var(--grid-line)"
            strokeDasharray="3 5"
            vertical={false}
          />
          <XAxis
            dataKey="bucket"
            tickFormatter={fmt}
            tick={{ fill: "var(--faint)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis
            allowDecimals={false}
            width={30}
            tick={{ fill: "var(--faint)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ stroke: "var(--line-2)" }}
            labelFormatter={(v) => fmt(String(v))}
            contentStyle={{
              background: "var(--surface-2)",
              border: "1px solid var(--glass-border)",
              borderRadius: 12,
              fontSize: 12,
              boxShadow: "var(--glass-shadow)",
            }}
            labelStyle={{ color: "var(--faint)" }}
            itemStyle={{ color: "var(--ink)" }}
          />
          <Area
            type="monotone"
            dataKey="blocked"
            stackId="1"
            stroke="var(--verdict-red)"
            strokeWidth={1.5}
            fill="url(#pj-block)"
            name="blocked"
          />
          <Area
            type="monotone"
            dataKey="passed"
            stackId="1"
            stroke="var(--verdict-green)"
            strokeWidth={1.5}
            fill="url(#pj-pass)"
            name="passed"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
