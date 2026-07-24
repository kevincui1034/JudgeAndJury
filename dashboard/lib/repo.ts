/**
 * Repo resolution guard. Every page under /r/[repoId] goes through this,
 * so ownership is enforced once at the boundary and every downstream query
 * is keyed by the resolved repoPk rather than by user input.
 */
import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { getRepo } from "@/lib/queries/traces";

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user;
}

export async function requireRepo(repoId: string) {
  const user = await requireUser();
  const repo = await getRepo(user.id!, repoId);
  if (!repo) notFound();
  return { user, repo };
}
