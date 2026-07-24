import { redirect } from "next/navigation";

import { auth, devLoginEnabled, signIn } from "@/auth";

/** lucide dropped brand marks, so this one is inline. */
function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className="size-4">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/repos");
  const githubEnabled = Boolean(process.env.AUTH_GITHUB_ID);

  return (
    <div>
      <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink">
        Sign in
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-body">
        Every gate run as a trace — the verdict, the evidence, and what the
        judge told your coding agent.
      </p>

      <div className="mt-8 flex flex-col gap-2.5">
        {githubEnabled && (
          <form
            action={async () => {
              "use server";
              await signIn("github", { redirectTo: "/repos" });
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber px-4 py-2.5 text-[13px] font-medium text-on-amber transition-colors hover:bg-amber-deep"
            >
              <GithubMark />
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
              className="w-full rounded-xl border border-line-2 px-4 py-2.5 text-[13px] text-body transition-colors hover:border-amber hover:text-ink"
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

      <p className="mt-8 border-t border-line pt-5 text-[11.5px] leading-relaxed text-faint">
        Records upload only after you run{" "}
        <span className="font-mono text-body">proofjury connect</span>. Nothing
        leaves your machine before that.
      </p>
    </div>
  );
}
