import { redirect } from "next/navigation";

import { auth, signOut } from "@/auth";
import { AppHeader } from "@/components/shell/AppHeader";

/**
 * App shell.
 *
 * Deliberately NOT a card containing cards. The previous shell nested an
 * inset .app-pane inside the page, then floated a header card, a rail card and
 * one card per panel inside that — four levels of rounded, bordered, shadowed
 * boxes. Everything read as equally important and the eye had nowhere to rest.
 *
 * Now the page itself is the surface: one full-bleed header separated by a
 * hairline, one rail separated by a hairline, and content that groups related
 * panels instead of scattering them.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // Passed down to the client UserMenu as a prop and invoked by a real
  // <form action> — see the note in components/shell/UserMenu.tsx.
  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="min-h-dvh">
      <AppHeader
        email={session.user.email ?? "signed in"}
        signOutAction={signOutAction}
      />
      <div className="flex items-start">{children}</div>
    </div>
  );
}
