"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { DomainError } from "@/server/errors";
import { approveInvitation, declineInvitation, resendInvitation } from "@/server/invitations/service";

const PAGE = "/admin/invitations";

/** Result codes for the page's flash message. Codes, not text, so names never land in URLs or logs. */
export type DecideResult = "approved" | "declined" | "resent" | "not_found" | "already_decided" | "joined" | "failed";

function codeFor(e: DomainError): DecideResult {
  if (e.code === "not_found") return "not_found";
  if (e.code === "invalid_state") return "already_decided";
  if (e.code === "conflict") return "joined";
  return "failed";
}

/** One action for the three buttons; the button's name/value says which. */
export async function decideAction(formData: FormData) {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const id = String(formData.get("invitationId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  let result: DecideResult;
  try {
    if (decision === "approve") {
      await approveInvitation(user.id, id);
      result = "approved";
    } else if (decision === "decline") {
      await declineInvitation(user.id, id);
      result = "declined";
    } else if (decision === "resend") {
      await resendInvitation(user.id, id);
      result = "resent";
    } else {
      result = "failed";
    }
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    result = e.code === "forbidden" ? "failed" : codeFor(e);
  }
  revalidatePath(PAGE);
  redirect(`${PAGE}?result=${result}`);
}
