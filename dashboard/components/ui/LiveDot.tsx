"use client";

/**
 * Poll the repo heartbeat and refresh the server components when it moves.
 *
 * router.refresh() re-runs the RSC payload and React diffs it, so every
 * server-rendered panel updates with zero per-panel client state — that is
 * why none of the pages needed to become client components.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { cx } from "@/components/ui/primitives";

const FAST_MS = 4000;
const SLOW_MS = 15000;
/** Back off after this long with no change, so a parked tab stays cheap. */
const IDLE_BEFORE_SLOW_MS = 120_000;

export function LiveDot({ repoId }: { repoId: string }) {
  const router = useRouter();
  const [flash, setFlash] = useState(false);
  const cursor = useRef<string | null>(null);
  const lastChange = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      if (cancelled) return;
      if (!document.hidden) {
        try {
          const res = await fetch(`/api/live/${repoId}`, { cache: "no-store" });
          if (res.ok) {
            const { cursor: next } = (await res.json()) as { cursor: string };
            if (cursor.current !== null && next !== cursor.current) {
              lastChange.current = Date.now();
              setFlash(true);
              setTimeout(() => setFlash(false), 1200);
              router.refresh();
            }
            cursor.current = next;
          }
        } catch {
          // A failed heartbeat is not worth surfacing — the page is still
          // correct, just not freshly revalidated.
        }
      }
      const idle = Date.now() - lastChange.current > IDLE_BEFORE_SLOW_MS;
      timer = setTimeout(tick, idle ? SLOW_MS : FAST_MS);
    }

    timer = setTimeout(tick, FAST_MS);
    const onFocus = () => {
      lastChange.current = Date.now();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [repoId, router]);

  return (
    <span
      title="Live — this page refreshes when new gate runs sync"
      className="flex items-center gap-1.5 text-[11px] text-faint"
    >
      <span
        aria-hidden
        className={cx(
          "size-1.5 rounded-full transition-colors",
          flash ? "bg-verdict-green" : "bg-line-2",
        )}
      />
      live
    </span>
  );
}
