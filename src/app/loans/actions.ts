"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { zonedLocalToUtc } from "@/lib/zoned-time";
import { DomainError } from "@/server/errors";
import { cleanTimezone } from "@/server/invitations/service";
import {
  adminCloseLoan,
  approveLoan,
  cancelApprovedLoan,
  closeAsNotReturned,
  confirmReturn,
  declineLoan,
  markPickedUp,
  markReturned,
  requestLoan,
  withdrawRequest,
} from "@/server/loans/service";

/** Result codes for the loan page's message: codes, never names, so nothing personal lands in URLs. */
export type LoanResult =
  | "requested"
  | "withdrawn"
  | "approved"
  | "declined"
  | "picked_up"
  | "cancelled"
  | "returned"
  | "closed"
  | "contact_required"
  | "conflict"
  | "needs_reason"
  | "needs_note"
  | "invalid_state"
  | "failed";

function codeFor(e: DomainError): LoanResult {
  if (e.code === "contact_required") return "contact_required";
  if (e.code === "conflict") return "conflict";
  if (e.code === "invalid_state") return "invalid_state";
  if (e.code === "invalid_input" && e.message.includes("reason")) return "needs_reason";
  if (e.code === "invalid_input" && e.message.includes("note")) return "needs_note";
  return "failed";
}

// ---------- S12: request dates ----------

export interface RequestState {
  status: "idle" | "error";
  message?: string;
}

export async function requestLoanAction(itemId: string, _prev: RequestState, formData: FormData): Promise<RequestState> {
  const user = await requireUser();
  if (!user) return { status: "error", message: "Your session ended. Sign in again, then send the request." };
  const [me] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, user.id));
  const zone = cleanTimezone(me?.timezone);
  const startAt = zonedLocalToUtc(String(formData.get("startAt") ?? ""), zone);
  const endAt = zonedLocalToUtc(String(formData.get("endAt") ?? ""), zone);
  if (!startAt || !endAt) return { status: "error", message: "Choose a start and an end date and time." };
  let loanId: string;
  try {
    loanId = (await requestLoan({ borrowerId: user.id, itemId, startAt, endAt })).id;
  } catch (e) {
    if (e instanceof DomainError) return { status: "error", message: e.message };
    throw e;
  }
  revalidatePath(`/items/${itemId}`);
  revalidatePath("/", "layout");
  revalidatePath("/loans");
  redirect(`/loans/${loanId}?result=requested`);
}

// ---------- S23: the admin closes a loan for a removed member ----------

export async function adminCloseAction(formData: FormData) {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const loanId = String(formData.get("loanId") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  let result: LoanResult = "closed";
  try {
    if (outcome !== "fine" && outcome !== "damaged" && outcome !== "not_returned") {
      throw new DomainError("invalid_input", "Choose how the item came back.");
    }
    await adminCloseLoan(user.id, loanId, outcome, String(formData.get("note") ?? ""));
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    if (e.code === "not_found") redirect("/admin/members");
    result = codeFor(e);
  }
  revalidatePath(`/loans/${loanId}`);
  revalidatePath("/admin/members");
  redirect(`/loans/${loanId}?result=${result}`);
}

// ---------- S13, S14, S16, S17, S19, S20: one action, the button says which ----------

export async function loanAction(formData: FormData) {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const loanId = String(formData.get("loanId") ?? "");
  const intent = String(formData.get("intent") ?? "");
  const reason = String(formData.get("reasonKey") ?? "") || null;
  const note = String(formData.get("note") ?? "");
  let result: LoanResult;
  try {
    switch (intent) {
      case "withdraw":
        await withdrawRequest(user.id, loanId);
        result = "withdrawn";
        break;
      case "approve":
        await approveLoan(user.id, loanId);
        result = "approved";
        break;
      case "decline":
        await declineLoan(user.id, loanId, reason);
        result = "declined";
        break;
      case "pickup":
        await markPickedUp(user.id, loanId);
        result = "picked_up";
        break;
      case "cancel":
        await cancelApprovedLoan(user.id, loanId, reason ?? "");
        result = "cancelled";
        break;
      case "returned":
        await markReturned(user.id, loanId);
        result = "returned";
        break;
      case "close": {
        const outcome = String(formData.get("outcome") ?? "");
        if (outcome === "fine" || outcome === "damaged") await confirmReturn(user.id, loanId, outcome, note);
        else if (outcome === "not_returned") await closeAsNotReturned(user.id, loanId, note);
        else throw new DomainError("invalid_input", "Choose how the item came back.");
        result = "closed";
        break;
      }
      default:
        result = "failed";
    }
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    if (e.code === "not_found") redirect("/loans");
    result = codeFor(e);
  }
  revalidatePath(`/loans/${loanId}`);
  revalidatePath("/loans");
  revalidatePath("/", "layout");
  redirect(`/loans/${loanId}?result=${result}`);
}
