import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { resolveUserCode } from "@/lib/device";

async function decide(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const code = String(formData.get("code") ?? "");
  const decision = formData.get("decision") === "deny" ? "denied" : "approved";
  const result = await resolveUserCode(code, session.user.id, decision);
  redirect(
    result.ok ? `/device?done=${decision}` : "/device?error=unknown-or-expired",
  );
}

export default async function DevicePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; done?: string; error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?from=device");
  const { code, done, error } = await searchParams;

  return (
    <main className="dot-grid flex min-h-dvh items-center justify-center p-8">
      <div className="glass glass-edge w-full max-w-md rounded-2xl p-8">
        <h1 className="text-[22px] font-medium tracking-tight text-ink">
          Connect a <span className="text-amber-ink">machine</span>
        </h1>

        {done ? (
          <p
            className={`mt-4 text-[13px] ${
              done === "approved" ? "text-verdict-green" : "text-body"
            }`}
          >
            {done === "approved"
              ? "Approved — the CLI picks up its token within a few seconds. You can close this tab."
              : "Denied. The CLI has been told no."}
          </p>
        ) : (
          <>
            <p className="mt-3 text-[13px] leading-relaxed text-body">
              A machine running{" "}
              <span className="font-mono text-ink">proofjury connect</span>{" "}
              printed a code. Enter it to let that machine sync gate records
              here. Sync never blocks a gate — advice you give reaches your
              agent on its next gate run.
            </p>
            {error && (
              <p className="mt-3 text-[12px] text-verdict-red">
                That code isn&apos;t pending — it may have expired. Re-run{" "}
                <span className="font-mono">proofjury connect</span>.
              </p>
            )}
            <form action={decide} className="mt-6 flex flex-col gap-3">
              <input
                name="code"
                defaultValue={code ?? ""}
                placeholder="MKGH-P4TN"
                autoComplete="off"
                spellCheck={false}
                className="rounded-xl border border-glass-border bg-white/[0.03] px-4 py-2.5 text-center font-mono text-[17px] tracking-[0.2em] text-ink placeholder:text-faint focus:border-amber focus:outline-none"
              />
              <div className="flex gap-2.5">
                <button
                  type="submit"
                  name="decision"
                  value="approve"
                  className="flex-1 rounded-xl bg-amber px-4 py-2.5 text-[13px] font-medium text-surface-3 transition-colors hover:bg-amber-deep"
                >
                  Approve
                </button>
                <button
                  type="submit"
                  name="decision"
                  value="deny"
                  className="flex-1 rounded-xl border border-glass-border px-4 py-2.5 text-[13px] text-body transition-colors hover:border-verdict-red hover:text-verdict-red"
                >
                  Deny
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
