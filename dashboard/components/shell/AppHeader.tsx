/**
 * The app-wide top bar — full-bleed and separated by a hairline rather than
 * floated as a rounded card. Lives in app/(app)/layout.tsx so /repos gets it
 * too; that route has no NavRail.
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
  right,
}: {
  email: string;
  signOutAction: () => Promise<void>;
  right?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 h-14 border-b border-line bg-surface/85 backdrop-blur-xl">
      <div className="flex h-full items-center gap-3 px-4 sm:px-5">
        <Link
          href="/repos"
          className="flex shrink-0 items-center gap-2.5 rounded-lg transition-opacity hover:opacity-80"
        >
          <LogoTile />
          <Wordmark className="hidden sm:inline" />
        </Link>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {right}
          <WorldToggle />
          <UserMenu email={email} signOutAction={signOutAction} />
        </div>
      </div>
    </header>
  );
}
