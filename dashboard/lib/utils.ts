/**
 * `cn` exists so shadcn/ui component files compile unmodified — it is their
 * expected import. It is NOT a replacement for `cx` in components/ui/primitives.tsx:
 * `cx` is three dependency-free lines used ~30 times across server components,
 * and it stays.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
