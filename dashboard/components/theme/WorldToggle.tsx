"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { cx } from "@/components/ui/primitives";

/**
 * Day/night switch.
 *
 * No `mounted` flag: the usual trick is to hold a piece of state that flips in
 * an effect so the server and client agree, but that is a synchronous setState
 * in an effect and it costs an extra render on every page. Instead BOTH icons
 * are rendered and CSS picks one via the `dark:` variant — which globals.css
 * remaps to [data-world="night"]. next-themes stamps that attribute onto <html>
 * in a blocking script before hydration, so the correct icon is painted on the
 * first frame with no JS state at all.
 */
export function WorldToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className={cx(
        "grid size-8 shrink-0 place-items-center rounded-lg border border-line-2 text-faint transition-colors hover:border-amber/40 hover:text-amber-ink",
        className,
      )}
      title="Toggle day / night"
      aria-label="Toggle day / night"
    >
      <Sun className="size-4 dark:hidden" />
      <Moon className="hidden size-4 dark:block" />
    </button>
  );
}
