/**
 * Brand panel on the auth split-screen. Decorative — hidden below lg so the
 * sign-in form owns small viewports entirely.
 */
import { TerminalCard } from "@/components/marketing/TerminalCard";

export function AuthAside() {
  return (
    <aside
      aria-hidden
      className="dot-grid relative hidden w-[46%] max-w-[720px] shrink-0 flex-col justify-center overflow-hidden border-l border-line bg-surface-3/40 p-10 lg:flex"
    >
      <div className="relative z-10 max-w-md">
        <p className="font-serif text-[34px] leading-[1.15] text-ink">
          The last command
          <br />
          before production.
        </p>
        <p className="mt-4 max-w-sm text-[13px] leading-relaxed text-body">
          Proofjury intercepts the deploy itself. Deterministic checks decide;
          every block becomes a prior the gate recalls the next time.
        </p>
        <TerminalCard className="mt-8" />
      </div>
    </aside>
  );
}
