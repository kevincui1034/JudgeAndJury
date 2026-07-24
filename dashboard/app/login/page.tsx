import { redirect } from "next/navigation";

import { auth, devLoginEnabled, signIn } from "@/auth";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/repos");
  const githubEnabled = Boolean(process.env.AUTH_GITHUB_ID);

  return (
    <main className="dot-grid flex min-h-dvh items-center justify-center p-8">
      <div className="glass glass-edge w-full max-w-sm rounded-2xl p-8">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-8 place-items-center rounded-lg border border-[rgb(245_184_61/0.3)] bg-[rgb(245_184_61/0.12)] text-[15px] text-amber-ink"
          >
            §
          </span>
          <h1 className="text-[22px] font-medium tracking-tight text-ink">
            Proofjury
          </h1>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-body">
          Every gate run as a trace — the verdict, the evidence, and what the
          judge told your coding agent.
        </p>

        <div className="mt-7 flex flex-col gap-2.5">
          {githubEnabled && (
            <form
              action={async () => {
                "use server";
                await signIn("github", { redirectTo: "/repos" });
              }}
            >
              <button
                type="submit"
                className="w-full rounded-xl bg-amber px-4 py-2.5 text-[13px] font-medium text-surface-3 transition-colors hover:bg-amber-deep"
              >
                Sign in with GitHub
              </button>
            </form>
          )}
          {devLoginEnabled && (
            <form
              action={async () => {
                "use server";
                await signIn("dev", { redirectTo: "/repos" });
              }}
            >
              <button
                type="submit"
                className="w-full rounded-xl border border-glass-border px-4 py-2.5 text-[13px] text-body transition-colors hover:border-amber hover:text-ink"
              >
                Dev login (local only)
              </button>
            </form>
          )}
          {!githubEnabled && !devLoginEnabled && (
            <p className="text-[12px] text-faint">
              No sign-in method configured — set AUTH_GITHUB_ID/SECRET, or
              AUTH_DEV_LOGIN=1 outside production.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
