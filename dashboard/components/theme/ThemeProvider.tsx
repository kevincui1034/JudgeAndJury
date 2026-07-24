"use client";

/**
 * Wraps the app in next-themes, mapping its light/dark concept onto the
 * `data-world` attribute the design system actually reads.
 *
 * Why next-themes and not a cookie: reading cookies() in app/layout.tsx would
 * opt the ENTIRE tree into dynamic rendering, including the marketing page at
 * `/` — the one route where prerendering matters most. Nothing on the server
 * needs to know the world; every color reaches the DOM as a CSS variable, and
 * Recharts resolves them at paint. next-themes also injects its own blocking
 * pre-hydration script, so there is no flash of the wrong world.
 *
 * enableSystem is off deliberately: a judge on a dark-mode laptop would
 * otherwise never see the light world by default.
 */
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-world"
      value={{ light: "day", dark: "night" }}
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      {/* The prefers-reduced-motion block in globals.css zeroes CSS
          durations but has no effect on JS-driven animation. */}
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </NextThemesProvider>
  );
}
