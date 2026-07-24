/**
 * The interception, as it actually reads in a terminal. Server-safe.
 */
import { Check, CornerDownLeft, Gavel, Sparkles, X } from "lucide-react";

import { TERMINAL_LINES } from "@/components/marketing/fixtures";
import { cx } from "@/components/ui/primitives";

export function TerminalCard({ className }: { className?: string }) {
  return (
    <div
      className={cx(
        "glass glass-edge overflow-hidden rounded-2xl text-left",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span aria-hidden className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-verdict-red/60" />
          <span className="size-2.5 rounded-full bg-amber/60" />
          <span className="size-2.5 rounded-full bg-verdict-green/60" />
        </span>
        <span className="ml-1 font-mono text-[11px] text-faint">
          demo-app — zsh
        </span>
      </div>

      <div className="space-y-1 px-4 py-4 font-mono text-[12px] leading-relaxed sm:text-[12.5px]">
        {TERMINAL_LINES.map((line, i) => {
          if (line.kind === "gap") return <div key={i} className="h-2" />;

          if (line.kind === "cmd") {
            return (
              <div key={i} className="flex gap-2">
                <span className="shrink-0 text-amber-ink">$</span>
                <span className="text-ink">{line.text}</span>
              </div>
            );
          }

          if (line.kind === "ok") {
            return (
              <div key={i} className="flex items-center gap-2 pl-3">
                <Check
                  className="size-3.5 shrink-0 text-verdict-green"
                  strokeWidth={2.5}
                />
                <span className="text-faint">{line.text}</span>
              </div>
            );
          }

          if (line.kind === "fail") {
            return (
              <div key={i} className="flex flex-wrap items-center gap-x-2 pl-3">
                <X
                  className="size-3.5 shrink-0 text-verdict-red"
                  strokeWidth={2.5}
                />
                <span className="text-verdict-red">{line.text}</span>
                {"note" in line && line.note && (
                  <span className="text-faint">{line.note}</span>
                )}
              </div>
            );
          }

          // The judge speaking — amber, the one colour reserved for it.
          if (line.kind === "judge") {
            return (
              <div
                key={i}
                className="rounded-lg border border-amber/25 bg-amber/8 px-2.5 py-2"
              >
                <div className="flex items-center gap-2 text-amber-ink">
                  <Gavel className="size-3.5 shrink-0" />
                  {line.text}
                </div>
                {"note" in line && line.note && (
                  <p className="mt-1 pl-5 text-body">{line.note}</p>
                )}
              </div>
            );
          }

          // A preference that graduated out of repeated corrections.
          if (line.kind === "pref") {
            return (
              <div key={i} className="pl-1 text-bot-teal">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-3.5 shrink-0" />
                  {line.text}
                </div>
                {"note" in line && line.note && (
                  <p className="mt-0.5 pl-5 text-faint">“{line.note}”</p>
                )}
              </div>
            );
          }

          return (
            <div key={i} className="flex items-start gap-2 pl-1 text-bot-violet">
              <CornerDownLeft className="mt-0.5 size-3.5 shrink-0" />
              {line.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}
