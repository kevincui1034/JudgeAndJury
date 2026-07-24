"use client";

/**
 * Left navigation rail. Client-only because it reads the active path —
 * everything it wraps stays a server component.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "@/components/ui/primitives";

export interface NavItem {
  href: string;
  label: string;
  glyph: string;
  hint?: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export function NavRail({
  groups,
  footer,
}: {
  groups: NavGroup[];
  footer?: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <nav className="glass glass-edge flex h-full w-[228px] shrink-0 flex-col rounded-2xl py-4">
      <Link href="/repos" className="mb-5 flex items-center gap-2.5 px-5">
        <span
          aria-hidden
          className="grid size-7 place-items-center rounded-lg border border-amber/30 bg-amber/12 text-[13px] text-amber-ink"
        >
          §
        </span>
        <span className="text-[15px] font-medium tracking-tight text-ink">
          Proofjury
        </span>
      </Link>

      <div className="flex-1 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.title} className="mb-4">
            <p className="px-5 pb-1.5 text-[10px] tracking-[0.14em] text-faint uppercase">
              {group.title}
            </p>
            {group.items.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.hint}
                  className={cx(
                    "relative flex items-center gap-2.5 px-5 py-[7px] text-[13px] transition-colors",
                    active
                      ? "text-ink"
                      : "text-body hover:text-ink",
                  )}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute top-1/2 left-0 h-4 w-[2px] -translate-y-1/2 rounded-r bg-amber"
                    />
                  )}
                  <span
                    aria-hidden
                    className={cx(
                      "w-4 text-center text-[12px]",
                      active ? "text-amber-ink" : "text-faint",
                    )}
                  >
                    {item.glyph}
                  </span>
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      {footer && <div className="mt-2 px-4">{footer}</div>}
    </nav>
  );
}
