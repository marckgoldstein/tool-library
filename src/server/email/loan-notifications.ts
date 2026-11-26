/**
 * Loan emails, sent after the loan change has been saved (D5, D29).
 * Each email says what happened and links to the loan; it never includes
 * contact details or addresses.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { items, loans, users } from "@/db/schema";
import { reasonText } from "@/content/canned-messages";
import { sendEmail } from "./transport";

export type LoanNotificationType =
  | "loan.requested"
  | "loan.withdrawn"
  | "loan.approved"
  | "loan.declined"
  | "loan.auto_declined"
  | "loan.picked_up"
  | "loan.cancelled"
  | "loan.returned"
  | "loan.closed"
  | "loan.problem_reported"; // to admins: damaged or not returned

export interface LoanNotification {
  type: LoanNotificationType;
  loanId: string;
  /** Recipients. For admin notices, the service fills in active admins. */
  toUserIds: string[];
  reasonKey?: string | null;
  note?: string | null;
}

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

function compose(n: LoanNotification, itemTitle: string): { subject: string; text: string } {
  const link = `${appUrl()}/loans/${n.loanId}`;
  const reason = n.reasonKey ? reasonText(n.reasonKey) : undefined;
  const lines: Record<LoanNotificationType, [string, string]> = {
    "loan.requested": [`New request for your ${itemTitle}`, `Someone asked to borrow your ${itemTitle}.`],
    "loan.withdrawn": [`Request withdrawn: ${itemTitle}`, `A request for your ${itemTitle} was withdrawn.`],
    "loan.approved": [`Approved: ${itemTitle}`, `Your request to borrow ${itemTitle} was approved. Share a contact detail in the thread to arrange pickup.`],
    "loan.declined": [`Declined: ${itemTitle}`, `Your request to borrow ${itemTitle} was declined.`],
    "loan.auto_declined": [`Not available: ${itemTitle}`, `${itemTitle} was lent to someone else for overlapping dates, so your request was declined.`],
    "loan.picked_up": [`Picked up: ${itemTitle}`, `${itemTitle} was marked as picked up.`],
    "loan.cancelled": [`Cancelled: ${itemTitle}`, `The loan of ${itemTitle} was cancelled before pickup.`],
    "loan.returned": [`Returned: ${itemTitle}`, `${itemTitle} was marked as returned. Please check it over and confirm.`],
    "loan.closed": [`Closed: ${itemTitle}`, `The loan of ${itemTitle} is closed.`],
    "loan.problem_reported": [`Problem reported: ${itemTitle}`, `An owner reported a problem when closing the loan of ${itemTitle}.`],
  };
  const [subject, opening] = lines[n.type];
  const parts = [opening];
  if (reason) parts.push(`Reason: ${reason}`);
  if (n.note && n.type === "loan.problem_reported") parts.push(`Owner's note: ${n.note}`);
  parts.push(`See the loan: ${link}`);
  return { subject, text: parts.join("\n\n") };
}

/** Active admins, leaving out anyone who is a party to the loan when another admin exists (R5). */
export async function adminRecipients(loanId: string): Promise<string[]> {
  const [loan] = await db.select().from(loans).where(eq(loans.id, loanId));
  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.status, "active")));
  const all = admins.map((a) => a.id);
  if (!loan) return all;
  const neutral = all.filter((id) => id !== loan.borrowerId && id !== loan.ownerId);
  return neutral.length > 0 ? neutral : all;
}

export async function deliverLoanNotifications(notifications: LoanNotification[]): Promise<void> {
  for (const n of notifications) {
    const recipientIds = n.type === "loan.problem_reported" ? await adminRecipients(n.loanId) : n.toUserIds;
    if (recipientIds.length === 0) continue;
    const [row] = await db
      .select({ title: items.title })
      .from(loans)
      .innerJoin(items, eq(items.id, loans.itemId))
      .where(eq(loans.id, n.loanId));
    const { subject, text } = compose(n, row?.title ?? "an item");
    const recipients = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(inArray(users.id, recipientIds), ne(users.status, "deleted")));
    for (const r of recipients) {
      // An email failure must not undo a saved loan change; it is logged as failed instead.
      await sendEmail({ to: r.email, toUserId: r.id, template: n.type, relatedId: n.loanId, subject, text }).catch(
        () => undefined,
      );
    }
  }
}
