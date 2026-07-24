import { redirect } from "next/navigation";

import { auth, signOut } from "@/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return (
    <div className="flex min-h-dvh flex-col p-3 lg:p-5">
      <div className="app-pane mx-auto flex w-full max-w-[1720px] flex-1 gap-4 rounded-[26px] p-4">
        {children}
      </div>
      <footer className="mx-auto mt-3 flex w-full max-w-[1720px] items-center justify-between px-2 text-[11px] text-faint">
        <span>
          Deterministic checks decide. The judge only explains — and every
          sponsor surface is context, never a verdict.
        </span>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit" className="transition-colors hover:text-body">
            Sign out {session.user.email ?? ""}
          </button>
        </form>
      </footer>
    </div>
  );
}
