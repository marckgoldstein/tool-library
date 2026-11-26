import type { LockingLoan } from "@/server/items/service";
import { isOverdue } from "@/server/loans/rules";

/** One plain line about the loan that locks a listing, for its owner: who has it and until when. */
export function loanLine(loan: LockingLoan, fmt: Intl.DateTimeFormat, now = new Date()): string {
  const first = loan.borrowerName.trim().split(/\s+/)[0] ?? loan.borrowerName;
  if (loan.status === "approved") return `Approved for ${first} · pickup from ${fmt.format(loan.startAt)}`;
  if (loan.status === "returned") return `${first} returned it · check it over and confirm the return`;
  if (isOverdue({ status: "active", endAt: loan.endAt }, now)) return `With ${first} · overdue since ${fmt.format(loan.endAt)}`;
  return `With ${first} · due back ${fmt.format(loan.endAt)}`;
}
