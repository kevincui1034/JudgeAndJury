/**
 * Split-screen shell for /login and /device. Route group names do not affect
 * URLs, so both paths are unchanged and auth.ts's `pages: { signIn: "/login" }`
 * keeps working.
 */
import Link from "next/link";

import { WorldToggle } from "@/components/theme/WorldToggle";
import { LogoTile, Wordmark } from "@/components/ui/Logo";
import { AuthAside } from "@/components/marketing/AuthAside";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* form side */}
      <div className="flex flex-1 flex-col p-6 sm:p-10">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
          >
            <LogoTile />
            <Wordmark />
          </Link>
          <WorldToggle />
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>

        <p className="text-center text-[11px] text-faint">
          Correctness, not security. Deterministic checks decide; the judge
          only explains.
        </p>
      </div>

      {/* brand side — decorative, hidden on small screens */}
      <AuthAside />
    </div>
  );
}
