"use client";

import { Check, ChevronsUpDown, FolderGit2 } from "lucide-react";
import Link from "next/link";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";

export interface RepoOption {
  id: string;
  repoSlug: string;
}

/** Sits at the top of the nav rail — the workspace-switcher slot. */
export function RepoSwitcher({
  current,
  repos,
}: {
  current: RepoOption;
  repos: RepoOption[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="glass-flat flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors outline-none hover:border-amber/40 focus-visible:ring-2 focus-visible:ring-amber/40">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-amber/12 text-amber-ink">
          <FolderGit2 className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[12px] text-ink">
            {current.repoSlug}
          </span>
          <span className="block text-[10px] text-faint">connected repo</span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-faint" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-[240px]">
        <DropdownMenuLabel className="text-[11px] font-normal text-faint">
          Switch repo
        </DropdownMenuLabel>
        {repos.map((r) => (
          <DropdownMenuItem key={r.id} asChild>
            <Link href={`/r/${r.id}`} className="cursor-pointer">
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                {r.repoSlug}
              </span>
              {r.id === current.id && (
                <Check className="size-3.5 shrink-0 text-amber-ink" />
              )}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/repos" className="cursor-pointer text-[12px]">
            All connected repos
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
