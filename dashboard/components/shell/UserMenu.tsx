"use client";

import { ChevronDown, LogOut } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";

/**
 * The sign-out server action arrives as a prop and is invoked by a real
 * <form action>. A DropdownMenuItem renders <div role="menuitem">, which
 * cannot submit anything — so the item is `asChild` over a <button
 * type="submit"> inside the form. Get this wrong and sign-out silently
 * no-ops with no error anywhere.
 */
export function UserMenu({
  email,
  signOutAction,
}: {
  email: string;
  signOutAction: () => Promise<void>;
}) {
  const initial = (email || "?").trim().charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg border border-line-2 py-1 pr-2 pl-1 text-[12.5px] text-body transition-colors outline-none hover:border-amber/40 hover:text-ink focus-visible:ring-2 focus-visible:ring-amber/40">
        <span className="grid size-6 place-items-center rounded-md bg-amber/15 text-[11px] font-medium text-amber-ink">
          {initial}
        </span>
        <span className="hidden max-w-[13ch] truncate sm:inline">{email}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <p className="text-[11px] text-faint">Signed in as</p>
          <p className="truncate text-[12.5px] text-ink">{email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full cursor-pointer">
              <LogOut className="size-3.5" />
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
