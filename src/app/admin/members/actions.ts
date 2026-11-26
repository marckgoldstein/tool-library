"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { DomainError } from "@/server/errors";
import { removeMember, setAdmin } from "@/server/members/service";

const PAGE = "/admin/members";

/** Result codes for the flash message; codes, not names, so nothing personal lands in URLs or logs. */
export type MemberResult = "removed" | "removed_open" | "promoted" | "demoted" | "last_admin" | "self" | "not_found" | "failed";

export async function memberAction(formData: FormData) {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const memberId = String(formData.get("memberId") ?? "");
  const intent = String(formData.get("intent") ?? "");
  let result: MemberResult;
  try {
    if (intent === "remove") {
      const { openLoans } = await removeMember(user.id, memberId);
      result = openLoans > 0 ? "removed_open" : "removed";
    } else if (intent === "promote") {
      await setAdmin(user.id, memberId, true);
      result = "promoted";
    } else if (intent === "demote") {
      await setAdmin(user.id, memberId, false);
      result = "demoted";
    } else {
      result = "failed";
    }
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    result =
      e.code === "invalid_state" ? "last_admin" : e.code === "invalid_input" ? "self" : e.code === "not_found" ? "not_found" : "failed";
  }
  revalidatePath("/", "layout");
  redirect(`${PAGE}?result=${result}`);
}
