/**
 * The app-wide top bar. Lives in app/(app)/layout.tsx rather than the repo
 * layout so /repos gets it too — that route has no NavRail.
 *
 * Server component; only the two interactive leaves (WorldToggle, UserMenu)
 * are client.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { WorldToggle } from "@/components/theme/WorldToggle";
import { UserMenu } from "@/components/shell/UserMenu";
import { LogoTile, Wordmark } from "@/components/ui/Logo";

export function AppHeader({
  email,
  signOutAction,
  left,
  right,
}: {
  email: string;
  signOutAction: () => Promise<void>;
  /** Breadcrumb / repo switcher, injected by the route that knows the repo. */
  left?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="glass glass-edge sticky top-0 z-30 flex h-14 items-center gap-3 rounded-2xl px-3 sm:px-4">
      <Link
        href="/repos"
        className="flex shrink-0 items-center gap-2.5 rounded-lg transition-opacity hover:opacity-80"
      >
        <LogoTile />
        <Wordmark className="hidden sm:inline" />
      </Link>

      {left && (
        <>
          <span aria-hidden className="h-5 w-px shrink-0 bg-line-2" />
          <div className="min-w-0 flex-1">{left}</div>
        </>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {right}
        <WorldToggle />
        <UserMenu email={email} signOutAction={signOutAction} />
      </div>
    </header>
  );
}
