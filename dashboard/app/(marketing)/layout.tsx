/**
 * Marketing shell. Separate from (app) because a transparent nav over a
 * full-bleed hero is structurally incompatible with .app-pane's inset well.
 *
 * Deliberately no auth() call anywhere in this group: it would opt / out of
 * prerendering and would throw a 500 if AUTH_SECRET were unset — on the exact
 * page a visitor sees first. Both audiences route correctly through the guards
 * that already exist: (app)/layout redirects anonymous users to /login, and
 * /login redirects signed-in users to /repos.
 */
import Link from "next/link";

import { WorldToggle } from "@/components/theme/WorldToggle";
import { LogoTile, Wordmark } from "@/components/ui/Logo";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-line/60 bg-surface/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <LogoTile />
            <Wordmark />
          </Link>

          <nav className="ml-6 hidden items-center gap-6 text-[13px] text-body md:flex">
            <a href="#how" className="transition-colors hover:text-ink">
              How it works
            </a>
            <a href="#catches" className="transition-colors hover:text-ink">
              What it catches
            </a>
            <a href="#proof" className="transition-colors hover:text-ink">
              Proof
            </a>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <WorldToggle />
            <Link
              href="/login"
              className="hidden rounded-lg px-3 py-1.5 text-[13px] text-body transition-colors hover:text-ink sm:block"
            >
              Sign in
            </Link>
            <Link
              href="/repos"
              className="rounded-lg bg-amber px-3.5 py-1.5 text-[13px] font-medium text-on-amber transition-colors hover:bg-amber-deep"
            >
              Open dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-10 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2.5">
            <LogoTile />
            <Wordmark />
          </div>
          <p className="max-w-xl text-[11.5px] leading-relaxed text-faint sm:ml-auto sm:text-right">
            Deterministic checks decide. The judge only explains — and every
            sponsor surface is context, never a verdict. Correctness, not
            security.
          </p>
        </div>
      </footer>
    </div>
  );
}
