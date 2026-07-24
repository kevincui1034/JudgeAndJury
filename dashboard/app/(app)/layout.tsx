import { redirect } from "next/navigation";

import { auth, signOut } from "@/auth";
import { AppHeader } from "@/components/shell/AppHeader";

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
    <div className="flex min-h-dvh flex-col gap-3 p-3 lg:gap-4 lg:p-5">
      <div className="mx-auto w-full max-w-[1720px]">
        <AppHeader
          email={session.user.email ?? "signed in"}
          signOutAction={signOutAction}
        />
      </div>

      <div className="app-pane mx-auto flex w-full max-w-[1720px] flex-1 gap-4 rounded-[26px] p-3 lg:p-4">
        {children}
      </div>

      <footer className="mx-auto w-full max-w-[1720px] px-2 pb-1 text-[11px] text-faint">
        Deterministic checks decide. The judge only explains — and every
        sponsor surface is context, never a verdict.
      </footer>
    </div>
  );
}
