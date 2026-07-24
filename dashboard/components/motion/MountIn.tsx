"use client";

/**
 * Mount animation for above-the-fold content. Safe where a scroll reveal is
 * not: it always plays, so it never depends on an observer firing, and the
 * element is only ever hidden for the length of the animation.
 *
 * MARKETING ONLY. In the dashboard, router.refresh() re-renders in place every
 * time the heartbeat moves; a mount animation there would be fine on refresh
 * (no remount) but any key change would replay it, so the rule is simply: not
 * in the app.
 */
import { motion } from "motion/react";
import type { ReactNode } from "react";

export function MountIn({
  children,
  delay = 0,
  y = 12,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
