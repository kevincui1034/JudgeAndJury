"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import {
  approveAdvisory,
  confirmAdvisory,
  LabelError,
  rejectAdvisory,
} from "@/lib/labels";

export interface ActionState {
  error: string | null;
}

/**
 * Label a gate advisory from the web. The write lands in `label_events`;
 * the CLI applies it on its next `proofjury sync`, and the note reaches
 * the agent on the gate event after that.
 */
export async function labelAdvisoryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "not signed in" };

  const action = String(formData.get("action"));
  const ref = { advisoryPk: String(formData.get("advisoryPk")), userId: session.user.id };
  try {
    if (action === "approve") await approveAdvisory(ref);
    else if (action === "reject") await rejectAdvisory(ref);
    else if (action === "confirm") await confirmAdvisory(ref);
    else return { error: `unknown action: ${action}` };
  } catch (error) {
    if (error instanceof LabelError) return { error: error.message };
    throw error;
  }
  revalidatePath(String(formData.get("path") || "/"));
  return { error: null };
}
