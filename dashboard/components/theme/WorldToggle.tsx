"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { cx } from "@/components/ui/primitives";

/**
 * Day/night switch. Renders a fixed-size placeholder until mounted — the
 * server cannot know the stored world, so rendering the real icon on the
 * first pass would hydration-mismatch every load.
 */
export function WorldToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const night = resolvedTheme === "dark";
  const base = cx(
    "grid size-8 shrink-0 place-items-center rounded-lg border border-line-2 text-faint transition-colors hover:border-amber/40 hover:text-amber-ink",
    className,
  );

  if (!mounted) {
    return <span className={base} aria-hidden />;
  }

  return (
    <button
      type="button"
      onClick={() => setTheme(night ? "light" : "dark")}
      className={base}
      title={night ? "Switch to day" : "Switch to night"}
      aria-label={night ? "Switch to day" : "Switch to night"}
    >
      {night ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </button>
  );
}
