/**
 * Loan service (S22). The only code allowed to change a loan's status.
 *
 * Every action:
 *  1. runs in one database transaction,
 *  2. locks the item row (SELECT ... FOR UPDATE) so two approvals can't race,
 *  3. checks who may act and from which status (PRD section 5 table),
 *  4. writes a loan_event row in the same transaction (append-only audit),
 *  5. sends emails only after the transaction commits.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  contactShares,
  conversations,
  items,
  loanEvents,
  loans,
  memberships,
  users,
  type LoanOutcome,
  type LoanStatus,
} from "@/db/schema";
import { isReasonKey } from "@/content/canned-messages";
import { DomainError, forbidden, notFound } from "../errors";
import { deliverLoanNotifications, type LoanNotification } from "../email/loan-notifications";
import { BLOCKING_STATUSES, LOCKING_STATUSES, overlaps, validateRange } from "./rules";

type Loan = typeof loans.$inferSelect;

export interface LoanServiceDeps {
  /** Override in tests to capture notifications instead of sending email. */
  notify?: (notifications: LoanNotification[]) => Promise<void>;
  now?: () => Date;
}

const defaultDeps: Required<LoanServiceDeps> = {
  notify: deliverLoanNotifications,
  now: () => new Date(),
};

interface ActionResult {
  loan: Loan;
  notifications: LoanNotification[];
}

async function run(
  deps: LoanServiceDeps | undefined,
  action: (tx: Tx, now: Date) => Promise<ActionResult>,
): Promise<Loan> {
  const { notify, now } = { ...defaultDeps, ...deps };
  const result = await db.transaction((tx) => action(tx, now()));
  if (result.notifications.length > 0) await notify(result.notifications);
  return result.loan;
}

// ---------- helpers ----------

async function lockItem(tx: Tx, itemId: string) {
  const [item] = await tx.select().from(items).where(eq(items.id, itemId)).for("update");
  if (!item) throw notFound("Item");
  return item;
}

async function loadLoanForUpdate(tx: Tx, loanId: string) {
  const [found] = await tx.select({ itemId: loans.itemId }).from(loans).where(eq(loans.id, loanId));
  if (!found) throw notFound("Loan");
  // Lock the item first (same order everywhere) to avoid deadlocks, then the loan.
  const item = await lockItem(tx, found.itemId);
  const [loan] = await tx.select().from(loans).where(eq(loans.id, loanId)).for("update");
  if (!loan) throw notFound("Loan");
  return { loan, item };
}

function expectStatus(loan: Loan, allowed: LoanStatus[]) {
  if (!allowed.includes(loan.status)) {
    throw new DomainError("invalid_state", `This loan is ${loan.status}; that action isn't available.`);
  }
}

async function transition(
  tx: Tx,
  loan: Loan,
  to: LoanStatus,
  actorId: string | null,
  extra: Partial<typeof loans.$inferInsert> = {},
  event: { reasonKey?: string | null; note?: string | null } = {},
): Promise<Loan> {
  const [updated] = await tx
    .update(loans)
    .set({ status: to, ...extra })
    .where(and(eq(loans.id, loan.id), eq(loans.status, loan.status)))
    .returning();
  if (!updated) throw new DomainError("conflict", "This loan changed while you were acting on it. Reload and try again.");
  await tx.insert(loanEvents).values({
    loanId: loan.id,
    actorId,
    fromStatus: loan.status,
    toStatus: to,
    reasonKey: event.reasonKey ?? null,
    note: event.note ?? null,
  });
  return updated;
}

async function requireActiveMember(tx: Tx, userId: string, communityId: string) {
  const [row] = await tx
    .select({ status: users.status, removedAt: memberships.removedAt })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.userId, userId), eq(memberships.communityId, communityId)));
  if (!row || row.removedAt || row.status !== "active") throw forbidden("Only members of this group can do that.");
}

function requireReason(reasonKey: string | null | undefined, required: boolean): string | null {
  if (!reasonKey) {
    if (required) throw new DomainError("invalid_input", "Choose a reason.");
    return null;
  }
  if (!isReasonKey(reasonKey)) throw new DomainError("invalid_input", "Unknown reason.");
  return reasonKey;
}

function requireNote(note: string | null | undefined): string {
  const trimmed = note?.trim();
  if (!trimmed) throw new DomainError("invalid_input", "Add a note describing what happened.");
  if (trimmed.length > 2000) throw new DomainError("invalid_input", "Keep the note under 2,000 characters.");
  return trimmed;
}

// ---------- queries ----------

/** D23: a listing is locked while any loan on it is approved, active, or returned. */
export async function isListingLocked(itemId: string, tx: Tx | typeof db = db): Promise<boolean> {
  const rows = await tx
    .select({ id: loans.id })
    .from(loans)
    .where(and(eq(loans.itemId, itemId), inArray(loans.status, LOCKING_STATUSES)))
    .limit(1);
  return rows.length > 0;
}

// ---------- actions ----------

export interface RequestLoanInput {
  borrowerId: string;
  itemId: string;
  startAt: Date;
  endAt: Date;
}

/** S12: request an item for chosen dates and times. Opens the thread if none exists (R3). */
export function requestLoan(input: RequestLoanInput, deps?: LoanServiceDeps) {
  return run(deps, async (tx, now) => {
    const item = await lockItem(tx, input.itemId);
    if (item.ownerId === input.borrowerId) throw new DomainError("invalid_input", "You can't borrow your own item.");
    if (item.status === "paused" || item.status === "delisted") {
      throw new DomainError("invalid_state", "This item isn't available to request right now.");
    }
    await requireActiveMember(tx, input.borrowerId, item.communityId);
    const rangeError = validateRange(input, now);
    if (rangeError) throw new DomainError("invalid_input", rangeError);

    const blocking = await tx
      .select({ startAt: loans.startAt, endAt: loans.endAt })
      .from(loans)
      .where(and(eq(loans.itemId, item.id), inArray(loans.status, BLOCKING_STATUSES)));
    if (blocking.some((b) => overlaps(b, input))) {
      throw new DomainError("conflict", "Those dates overlap a loan that's already approved.");
    }

    let [conversation] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.itemId, item.id), eq(conversations.askerId, input.borrowerId)));
    if (!conversation) {
      [conversation] = await tx
        .insert(conversations)
        .values({ itemId: item.id, askerId: input.borrowerId, ownerId: item.ownerId })
        .returning();
    }
    if (!conversation) throw new Error("Could not open conversation");

    const [loan] = await tx
      .insert(loans)
      .values({
        itemId: item.id,
        conversationId: conversation.id,
        borrowerId: input.borrowerId,
        ownerId: item.ownerId,
        startAt: input.startAt,
        endAt: input.endAt,
        status: "requested",
      })
      .returning();
    if (!loan) throw new Error("Could not create loan");
    await tx.insert(loanEvents).values({ loanId: loan.id, actorId: input.borrowerId, toStatus: "requested" });
    return { loan, notifications: [{ type: "loan.requested", loanId: loan.id, toUserIds: [loan.ownerId] }] };
  });
}

/** S13: the borrower withdraws a pending request. */
export function withdrawRequest(actorId: string, loanId: string, deps?: LoanServiceDeps) {
  return run(deps, async (tx) => {
    const { loan } = await loadLoanForUpdate(tx, loanId);
    if (loan.borrowerId !== actorId) throw forbidden();
    expectStatus(loan, ["requested"]);
    const updated = await transition(tx, loan, "cancelled", actorId, { closedAt: new Date() });
    return { loan: updated, notifications: [{ type: "loan.withdrawn", loanId, toUserIds: [loan.ownerId] }] };
  });
}

/** S14: the owner approves. Overlapping pending requests are declined automatically (D14). */
export function approveLoan(ownerId: string, loanId: string, deps?: LoanServiceDeps) {
  return run(deps, async (tx, now) => {
    const { loan } = await loadLoanForUpdate(tx, loanId);
    if (loan.ownerId !== ownerId) throw forbidden("Only the owner can approve.");
    expectStatus(loan, ["requested"]);
    if (loan.endAt <= now) throw new DomainError("invalid_state", "This request's dates have already passed.");

    const others = await tx
      .select()
      .from(loans)
      .where(and(eq(loans.itemId, loan.itemId), ne(loans.id, loan.id)));
    if (others.some((o) => BLOCKING_STATUSES.includes(o.status) && overlaps(o, loan))) {
      throw new DomainError("conflict", "Those dates overlap a loan that's already approved.");
    }

    const updated = await transition(tx, loan, "approved", ownerId);
    const notifications: LoanNotification[] = [{ type: "loan.approved", loanId, toUserIds: [loan.borrowerId] }];

    for (const other of others) {
      if (other.status === "requested" && overlaps(other, loan)) {
        await transition(
          tx,
          other,
          "declined",
          null,
          { closedAt: now, reasonKey: "reason.dates" },
          { reasonKey: "reason.dates", note: "Overlapped an approved loan." },
        );
        notifications.push({ type: "loan.auto_declined", loanId: other.id, toUserIds: [other.borrowerId] });
      }
    }
    return { loan: updated, notifications };
  });
}

/** S14: the owner declines, with an optional canned reason. */
export function declineLoan(ownerId: string, loanId: string, reasonKey?: string | null, deps?: LoanServiceDeps) {
  return run(deps, async (tx, now) => {
    const { loan } = await loadLoanForUpdate(tx, loanId);
    if (loan.ownerId !== ownerId) throw forbidden("Only the owner can decline.");
    expectStatus(loan, ["requested"]);
    const reason = requireReason(reasonKey, false);
    const updated = await transition(tx, loan, "declined", ownerId, { reasonKey: reason, closedAt: now }, { reasonKey: reason });
    return {
      loan: updated,
      notifications: [{ type: "loan.declined", loanId, toUserIds: [loan.borrowerId], reasonKey: reason }],
    };
  });
}

/** S15 + S16: only the owner marks pickup, and only once a contact detail has been shared (D13, D22). */
export function markPickedUp(ownerId: string, loanId: string, deps?: LoanServiceDeps) {
  return run(deps, async (tx, now) => {
    const { loan, item } = await loadLoanForUpdate(tx, loanId);
    if (loan.ownerId !== ownerId) throw forbidden("Only the owner can mark pickup.");
    expectStatus(loan, ["approved"]);
    const shares = await tx
      .select({ id: contactShares.id })
      .from(contactShares)
      .where(eq(contactShares.conversationId, loan.conversationId))
      .limit(1);
    if (shares.length === 0) {
      throw new DomainError("contact_required", "Share a contact detail in the thread before marking pickup.");
    }
    const updated = await transition(tx, loan, "active", ownerId, { pickedUpAt: now });
    if (item.status === "available") await tx.update(items).set({ status: "on_loan" }).where(eq(items.id, item.id));
    return { loan: updated, notifications: [{ type: "loan.picked_up", loanId, toUserIds: [loan.borrowerId] }] };
  });
}

/** S17: either party cancels an approved loan before pickup, with a reason (D17). */
export function cancelApprovedLoan(actorId: string, loanId: string, reasonKey: string, deps?: LoanServiceDeps) {
  return run(deps, async (tx, now) => {
    const { loan } = await loadLoanForUpdate(tx, loanId);
    if (actorId !== loan.ownerId && actorId !== loan.borrowerId) throw forbidden();
    expectStatus(loan, ["approved"]);
    const reason = requireReason(reasonKey, true);
    const updated = await transition(tx, loan, "cancelled", actorId, { reasonKey: reason, closedAt: now }, { reasonKey: reason });
    const other = actorId === loan.ownerId ? loan.borrowerId : loan.ownerId;
    return { loan: updated, notifications: [{ type: "loan.cancelled", loanId, toUserIds: [other], reasonKey: reason }] };
  });
}

/** S19: the borrower marks the item returned; it waits for the owner (D20). */
export function markReturned(borrowerId: string, loanId: string, deps?: LoanServiceDeps) {
  return run(deps, async (tx, now) => {
    const { loan } = await loadLoanForUpdate(tx, loanId);
    if (loan.borrowerId !== borrowerId) throw forbidden("Only the borrower can mark it returned.");
    expectStatus(loan, ["active"]);
    const updated = await transition(tx, loan, "returned", borrowerId, { returnedAt: now });
    return { loan: updated, notifications: [{ type: "loan.returned", loanId, toUserIds: [loan.ownerId] }] };
  });
}

async function closeLoan(
  tx: Tx,
  loan: Loan,
  item: typeof items.$inferSelect,
  actorId: string,
  outcome: LoanOutcome,
  note: string | null,
  now: Date,
): Promise<ActionResult> {
  const updated = await transition(tx, loan, "closed", actorId, { outcome, closedAt: now }, { note });
  if (outcome === "not_returned") {
    await tx.update(items).set({ status: "delisted" }).where(eq(items.id, item.id));
  } else if (item.status === "on_loan") {
    await tx.update(items).set({ status: "available" }).where(eq(items.id, item.id));
  }
  const notifications: LoanNotification[] = [
    { type: "loan.closed", loanId: loan.id, toUserIds: [loan.borrowerId, loan.ownerId].filter((id) => id !== actorId) },
  ];
  if (outcome !== "fine") notifications.push({ type: "loan.problem_reported", loanId: loan.id, toUserIds: [], note });
  return { loan: updated, notifications };
}

/** S20: the owner confirms a returned item as fine or damaged. Damaged needs a note and emails the admin (D15). */
export function confirmReturn(
  ownerId: string,
  loanId: string,
  outcome: "fine" | "damaged",
  note?: string | null,
  deps?: LoanServiceDeps,
) {
  return run(deps, async (tx, now) => {
    const { loan, item } = await loadLoanForUpdate(tx, loanId);
    if (loan.ownerId !== ownerId) throw forbidden("Only the owner can confirm the return.");
    expectStatus(loan, ["returned"]);
    if (outcome !== "fine" && outcome !== "damaged") throw new DomainError("invalid_input", "Unknown outcome.");
    const cleanNote = outcome === "damaged" ? requireNote(note) : note?.trim() || null;
    return closeLoan(tx, loan, item, ownerId, outcome, cleanNote, now);
  });
}

/** S20 / D19: the owner closes an active (or overdue) loan as not returned. The item is delisted. */
export function closeAsNotReturned(ownerId: string, loanId: string, note: string, deps?: LoanServiceDeps) {
  return run(deps, async (tx, now) => {
    const { loan, item } = await loadLoanForUpdate(tx, loanId);
    if (loan.ownerId !== ownerId) throw forbidden("Only the owner can close this loan.");
    expectStatus(loan, ["active", "returned"]);
    return closeLoan(tx, loan, item, ownerId, "not_returned", requireNote(note), now);
  });
}

/**
 * S23: an admin closes an open loan when one party has been removed.
 * Requested or approved loans are cancelled; active or returned loans are closed with the chosen outcome.
 */
export function adminCloseLoan(
  adminId: string,
  loanId: string,
  outcome: LoanOutcome,
  note: string,
  deps?: LoanServiceDeps,
) {
  return run(deps, async (tx, now) => {
    const [admin] = await tx.select().from(users).where(eq(users.id, adminId));
    if (!admin || admin.role !== "admin" || admin.status !== "active") throw forbidden("Only an admin can do that.");
    const { loan, item } = await loadLoanForUpdate(tx, loanId);
    const parties = await tx
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(inArray(users.id, [loan.borrowerId, loan.ownerId]));
    if (!parties.some((p) => p.status !== "active")) {
      throw new DomainError("invalid_state", "Admins only close loans for removed members.");
    }
    const cleanNote = requireNote(note);
    if (loan.status === "requested" || loan.status === "approved") {
      const updated = await transition(tx, loan, "cancelled", adminId, { closedAt: now }, { note: cleanNote });
      return { loan: updated, notifications: [] };
    }
    expectStatus(loan, ["active", "returned"]);
    return closeLoan(tx, loan, item, adminId, outcome, cleanNote, now);
  });
}
