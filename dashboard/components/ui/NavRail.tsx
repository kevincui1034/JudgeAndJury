"use client";

/**
 * Left navigation rail. Client-only because it reads the active path —
 * everything it wraps stays a server component.
 *
 * LIVE-REFRESH INVARIANT: the `footer` slot carries <LiveDot>, which is what
 * drives router.refresh() for the entire app. It is rendered exactly ONCE,
 * in the desktop rail. The rail is hidden below `lg` with CSS (not unmounted),
 * so the poll keeps running at every viewport. The mobile Sheet deliberately
 * renders nav links only — duplicating the footer there would mount a second
 * LiveDot and double-poll.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  Clock4,
  LayoutGrid,
  ListTree,
  Menu,
  RotateCcw,
  Scale,
  Settings2,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/shadcn/sheet";
import { cx } from "@/components/ui/primitives";

/**
 * Icons are looked up by KEY, not passed as components. A lucide icon is a
 * forwardRef object, and only plain values cross the server→client boundary —
 * passing the component itself throws "Only plain objects can be passed to
 * Client Components" at runtime, which typecheck cannot see.
 */
const ICONS = {
  overview: LayoutGrid,
  traces: ListTree,
  loop: ArrowLeftRight,
  checkpoints: Clock4,
  preferences: Sparkles,
  memory: RotateCcw,
  judge: Scale,
  config: Settings2,
} satisfies Record<string, LucideIcon>;

export type NavIconKey = keyof typeof ICONS;

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconKey;
  hint?: string;
  /**
   * Match this href exactly. Required for an index route: `/r/<id>` is a
   * prefix of every sibling, so without this the Overview item highlights on
   * all nine pages at once.
   */
  exact?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

function useIsActive() {
  const pathname = usePathname();
  return (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

function NavLinks({
  groups,
  onNavigate,
}: {
  groups: NavGroup[];
  onNavigate?: () => void;
}) {
  const isActive = useIsActive();
  return (
    <div className="flex-1 overflow-y-auto px-2">
      {groups.map((group) => (
        <div key={group.title} className="mb-5">
          <p className="px-3 pb-1.5 text-[10px] font-medium tracking-[0.14em] text-faint uppercase">
            {group.title}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(item.href, item.exact);
              const Icon = ICONS[item.icon];
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.hint}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors",
                    active
                      ? "bg-amber/10 font-medium text-ink"
                      : "text-body hover:bg-tint hover:text-ink",
                  )}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute top-1/2 left-0 h-4 w-[2.5px] -translate-y-1/2 rounded-r-full bg-amber"
                    />
                  )}
                  <Icon
                    className={cx(
                      "size-4 shrink-0 transition-colors",
                      active
                        ? "text-amber-ink"
                        : "text-faint group-hover:text-body",
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function NavRail({
  groups,
  header,
  footer,
}: {
  groups: NavGroup[];
  header?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile sheet on navigation.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      {/* Desktop rail — hidden, never unmounted, below lg. */}
      <nav className="glass glass-edge hidden h-full w-[236px] shrink-0 flex-col rounded-2xl py-3 lg:flex">
        {header && <div className="px-3 pb-4">{header}</div>}
        <NavLinks groups={groups} />
        {footer && <div className="mt-2 px-3">{footer}</div>}
      </nav>

      {/* Mobile trigger */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          className="glass glass-edge fixed bottom-4 left-4 z-40 grid size-11 place-items-center rounded-full text-ink shadow-lg lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="size-5" />
        </SheetTrigger>
        <SheetContent side="left" className="w-[260px] p-0">
          <SheetHeader className="px-3 pt-3 pb-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            {header}
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col pt-4">
            <NavLinks groups={groups} onNavigate={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
