/**
 * Read-only loan queries for the loan-loop screens (M5). Status changes stay in
 * service.ts (S22). Only the two parties see a loan; admins see it too, as on
 * the loan page from emails.
 */
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { contactShares, items, loanEvents, loans, memberships, users } from "@/db/schema";
import { displayStatus, type DisplayStatus } from "./rules";
import { notFound } from "../errors";

const borrower = alias(users, "borrower");
const owner = alias(users, "owner");

export interface LoanView {
  id: string;
  status: DisplayStatus;
  rawStatus: typeof loans.$inferSelect.status;
  outcome: typeof loans.$inferSelect.outcome;
  reasonKey: string | null;
  startAt: Date;
  endAt: Date;
  pickedUpAt: Date | null;
  returnedAt: Date | null;
  closedAt: Date | null;
  item: { id: string; title: string };
  borrower: { id: string; name: string; active: boolean };
  owner: { id: string; name: string; active: boolean };
  conversationId: string;
  hasContactShare: boolean;
  role: "borrower" | "owner" | "admin";
  events: (typeof loanEvents.$inferSelect)[];
}

export async function getLoanView(viewerId: string, viewerRole: "member" | "admin", loanId: string, now = new Date()): Promise<LoanView> {
  const [row] = await db
    .select({
      loan: loans,
      itemTitle: items.title,
      borrowerName: borrower.name,
      borrowerStatus: borrower.status,
      ownerName: owner.name,
      ownerStatus: owner.status,
    })
    .from(loans)
    .innerJoin(items, eq(items.id, loans.itemId))
    .innerJoin(borrower, eq(borrower.id, loans.borrowerId))
    .innerJoin(owner, eq(owner.id, loans.ownerId))
    .where(eq(loans.id, loanId));
  if (!row) throw notFound("Loan");
  const { loan } = row;
  let role: LoanView["role"] | null = loan.borrowerId === viewerId ? "borrower" : loan.ownerId === viewerId ? "owner" : null;
  if (!role && viewerRole === "admin") {
    // T14: an admin sees loans in their own group only (every query is group-scoped).
    const [scope] = await db
      .select({ ok: memberships.userId })
      .from(memberships)
      .innerJoin(items, eq(items.communityId, memberships.communityId))
      .where(and(eq(memberships.userId, viewerId), isNull(memberships.removedAt), eq(items.id, loan.itemId)));
    if (scope) role = "admin";
  }
  // Not found and not allowed look the same, so loan ids can't be probed.
  if (!role) throw notFound("Loan");
  const [share] = await db
    .select({ id: contactShares.id })
    .from(contactShares)
    .where(eq(contactShares.conversationId, loan.conversationId))
    .limit(1);
  const events = await db.select().from(loanEvents).where(eq(loanEvents.loanId, loan.id)).orderBy(asc(loanEvents.createdAt));
  return {
    id: loan.id,
    status: displayStatus(loan, now),
    rawStatus: loan.status,
    outcome: loan.outcome,
    reasonKey: loan.reasonKey,
    startAt: loan.startAt,
    endAt: loan.endAt,
    pickedUpAt: loan.pickedUpAt,
    returnedAt: loan.returnedAt,
    closedAt: loan.closedAt,
    item: { id: loan.itemId, title: row.itemTitle },
    borrower: { id: loan.borrowerId, name: row.borrowerName ?? "Member", active: row.borrowerStatus === "active" },
    owner: { id: loan.ownerId, name: row.ownerName ?? "Member", active: row.ownerStatus === "active" },
    conversationId: loan.conversationId,
    hasContactShare: !!share,
    role,
    events,
  };
}

export interface LoanSummary {
  id: string;
  itemId: string;
  itemTitle: string;
  status: DisplayStatus;
  role: "borrower" | "owner";
  otherName: string;
  startAt: Date;
  endAt: Date;
  /** Something this member should do now. */
  needsAction: string | null;
}

const OPEN = ["requested", "approved", "active", "returned"] as const;

function actionFor(role: "borrower" | "owner", status: DisplayStatus): string | null {
  if (role === "owner" && status === "requested") return "Approve or decline";
  if (role === "owner" && status === "returned") return "Check it over and confirm";
  if (role === "owner" && status === "approved") return "Mark picked up at handoff";
  if (role === "borrower" && status === "overdue") return "Overdue: return it or message the owner";
  return null;
}

/** All of a member's loans, open first, newest first within each. */
export async function listLoans(userId: string, now = new Date()): Promise<{ open: LoanSummary[]; past: LoanSummary[] }> {
  const rows = await db
    .select({
      loan: loans,
      itemTitle: items.title,
      borrowerName: borrower.name,
      ownerName: owner.name,
    })
    .from(loans)
    .innerJoin(items, eq(items.id, loans.itemId))
    .innerJoin(borrower, eq(borrower.id, loans.borrowerId))
    .innerJoin(owner, eq(owner.id, loans.ownerId))
    .where(or(eq(loans.borrowerId, userId), eq(loans.ownerId, userId)))
    .orderBy(desc(loans.createdAt))
    .limit(200);
  const summaries = rows.map((r): LoanSummary => {
    const role = r.loan.ownerId === userId ? "owner" : "borrower";
    const status = displayStatus(r.loan, now);
    return {
      id: r.loan.id,
      itemId: r.loan.itemId,
      itemTitle: r.itemTitle,
      status,
      role,
      otherName: (role === "owner" ? r.borrowerName : r.ownerName) ?? "Member",
      startAt: r.loan.startAt,
      endAt: r.loan.endAt,
      needsAction: actionFor(role, status),
    };
  });
  const isOpen = (s: LoanSummary) => (OPEN as readonly string[]).includes(s.status) || s.status === "overdue";
  const open = summaries.filter(isOpen).sort((a, b) => Number(!!b.needsAction) - Number(!!a.needsAction));
  return { open, past: summaries.filter((s) => !isOpen(s)) };
}

/** For the header badge: loans waiting on this member. */
export async function loansNeedingAction(userId: string, now = new Date()): Promise<number> {
  const rows = await db
    .select({ ownerId: loans.ownerId, status: loans.status, endAt: loans.endAt })
    .from(loans)
    .where(and(or(eq(loans.borrowerId, userId), eq(loans.ownerId, userId)), inArray(loans.status, ["requested", "approved", "active", "returned"])));
  return rows.filter((r) => actionFor(r.ownerId === userId ? "owner" : "borrower", displayStatus(r, now)) !== null).length;
}

/** The member's open request or loan on an item, so the item page can point to it instead of a second request. */
export async function openLoanForItem(userId: string, itemId: string) {
  const [row] = await db
    .select({ id: loans.id, status: loans.status, startAt: loans.startAt, endAt: loans.endAt })
    .from(loans)
    .where(and(eq(loans.itemId, itemId), eq(loans.borrowerId, userId), inArray(loans.status, ["requested", "approved", "active", "returned"])))
    .orderBy(desc(loans.createdAt))
    .limit(1);
  return row ?? null;
}
