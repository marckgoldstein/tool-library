"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { DomainError } from "@/server/errors";
import { suggestMember } from "@/server/invitations/service";

export interface SuggestState {
  status: "idle" | "sent" | "error";
  message?: string;
  /** Echoed back on an error so the person doesn't retype. */
  values?: { name: string; email: string };
}

export async function suggestAction(_prev: SuggestState, formData: FormData): Promise<SuggestState> {
  const user = await requireUser();
  if (!user) return { status: "error", message: "Your session ended. Sign in again, then resend the suggestion." };
  const values = { name: String(formData.get("name") ?? ""), email: String(formData.get("email") ?? "") };
  try {
    const invitation = await suggestMember(user.id, values);
    revalidatePath("/invite");
    return { status: "sent", message: `Thanks. The admin will review your suggestion for ${invitation.inviteeName}.` };
  } catch (e) {
    if (e instanceof DomainError) return { status: "error", message: e.message, values };
    throw e;
  }
}
