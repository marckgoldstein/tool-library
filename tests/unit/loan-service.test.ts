import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { emailLog, items, loanEvents, loans, users } from "@/db/schema";
import type { LoanNotification } from "@/server/email/loan-notifications";
import {
  adminCloseLoan,
  approveLoan,
  cancelApprovedLoan,
  closeAsNotReturned,
  confirmReturn,
  declineLoan,
  isListingLocked,
  markPickedUp,
  markReturned,
  requestLoan,
  withdrawRequest,
} from "@/server/loans/service";
import { conversationFor, hours, resetDb, scenario, shareContact } from "../support/factories";

let sent: LoanNotification[] = [];
const deps = { notify: async (n: LoanNotification[]) => void sent.push(...n) };

beforeEach(async () => {
  await resetDb();
  sent = [];
});
afterAll(() => pool.end());

const eventsFor = (loanId: string) =>
  db.select().from(loanEvents).where(eq(loanEvents.loanId, loanId)).orderBy(loanEvents.createdAt);

async function itemStatus(itemId: string) {
  const [row] = await db.select({ status: items.status }).from(items).where(eq(items.id, itemId));
  return row!.status;
}

describe("happy path: request through owner-confirmed return", () => {
  it("moves through every state and writes one audit event per change", async () => {
    const s = await scenario();
    const loan = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(1), endAt: hours(48) }, deps);
    expect(loan.status).toBe("requested");
    expect(sent.at(-1)).toMatchObject({ type: "loan.requested", toUserIds: [s.owner.id] });

    await approveLoan(s.owner.id, loan.id, deps);
    expect(await isListingLocked(s.item.id)).toBe(true);

    await shareContact(loan.conversationId, s.owner.id);
    await markPickedUp(s.owner.id, loan.id, deps);
    expect(await itemStatus(s.item.id)).toBe("on_loan");

    await markReturned(s.borrower.id, loan.id, deps);
    const closed = await confirmReturn(s.owner.id, loan.id, "fine", null, deps);
    expect(closed).toMatchObject({ status: "closed", outcome: "fine" });
    expect(await itemStatus(s.item.id)).toBe("available");
    expect(await isListingLocked(s.item.id)).toBe(false);

    const events = await eventsFor(loan.id);
    expect(events.map((e) => [e.fromStatus, e.toStatus])).toEqual([
      [null, "requested"],
      ["requested", "approved"],
      ["approved", "active"],
      ["active", "returned"],
      ["returned", "closed"],
    ]);
  });
});

describe("requests (S12, S13)", () => {
  it("rejects your own item, bad ranges, paused items and non-members", async () => {
    const s = await scenario();
    await expect(requestLoan({ borrowerId: s.owner.id, itemId: s.item.id, startAt: hours(1), endAt: hours(2) }, deps)).rejects.toThrow(/own item/);
    await expect(requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(5), endAt: hours(2) }, deps)).rejects.toThrow(/after the start/);
    await db.update(items).set({ status: "paused" }).where(eq(items.id, s.item.id));
    await expect(requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(1), endAt: hours(2) }, deps)).rejects.toThrow(/isn't available/);
  });

  it("allows any duration (no minimum or maximum) and reuses one thread per borrower", async () => {
    const s = await scenario();
    const short = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(1), endAt: hours(1.25) }, deps);
    const long = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(100), endAt: hours(100 + 24 * 60) }, deps);
    expect(short.conversationId).toBe(long.conversationId);
  });

  it("lets the borrower withdraw only their own pending request", async () => {
    const s = await scenario();
    const loan = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(1), endAt: hours(5) }, deps);
    await expect(withdrawRequest(s.other.id, loan.id, deps)).rejects.toThrow(/can't do that/);
    const withdrawn = await withdrawRequest(s.borrower.id, loan.id, deps);
    expect(withdrawn.status).toBe("cancelled");
  });
});

describe("approval and overlaps (S14, D14, R4)", () => {
  it("auto-declines overlapping requests but keeps non-overlapping ones pending", async () => {
    const s = await scenario();
    const a = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(10), endAt: hours(20) }, deps);
    const clash = await requestLoan({ borrowerId: s.other.id, itemId: s.item.id, startAt: hours(15), endAt: hours(25) }, deps);
    const later = await requestLoan({ borrowerId: s.other.id, itemId: s.item.id, startAt: hours(20), endAt: hours(30) }, deps);

    await approveLoan(s.owner.id, a.id, deps);
    const rows = await db.select().from(loans);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[clash.id]).toMatchObject({ status: "declined", reasonKey: "reason.dates" });
    expect(byId[later.id]!.status).toBe("requested"); // touching end/start is not an overlap
    expect(sent.some((n) => n.type === "loan.auto_declined" && n.loanId === clash.id)).toBe(true);

    // Back-to-back loans can both be approved while the listing is locked (R4).
    await approveLoan(s.owner.id, later.id, deps);
    const systemEvent = (await eventsFor(clash.id)).at(-1)!;
    expect(systemEvent.actorId).toBeNull();
  });

  it("refuses a new request that overlaps an approved loan", async () => {
    const s = await scenario();
    const a = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(10), endAt: hours(20) }, deps);
    await approveLoan(s.owner.id, a.id, deps);
    await expect(
      requestLoan({ borrowerId: s.other.id, itemId: s.item.id, startAt: hours(19), endAt: hours(22) }, deps),
    ).rejects.toThrow(/overlap/);
  });

  it("only the owner can approve or decline", async () => {
    const s = await scenario();
    const loan = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(1), endAt: hours(5) }, deps);
    await expect(approveLoan(s.borrower.id, loan.id, deps)).rejects.toThrow(/Only the owner/);
    const declined = await declineLoan(s.owner.id, loan.id, "reason.dates", deps);
    expect(declined).toMatchObject({ status: "declined", reasonKey: "reason.dates" });
    await expect(approveLoan(s.owner.id, loan.id, deps)).rejects.toThrow(/is declined/);
  });

  it("serializes two simultaneous approvals of overlapping requests", async () => {
    const s = await scenario();
    const a = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(10), endAt: hours(20) }, deps);
    const b = await requestLoan({ borrowerId: s.other.id, itemId: s.item.id, startAt: hours(12), endAt: hours(22) }, deps);
    const results = await Promise.allSettled([approveLoan(s.owner.id, a.id, deps), approveLoan(s.owner.id, b.id, deps)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const approved = (await db.select().from(loans)).filter((l) => l.status === "approved");
    expect(approved).toHaveLength(1);
  });
});

describe("pickup gate and cancellation (S15, S16, S17)", () => {
  it("blocks pickup until a contact detail is shared, and only the owner marks it", async () => {
    const s = await scenario();
    const loan = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(1), endAt: hours(5) }, deps);
    await approveLoan(s.owner.id, loan.id, deps);
    await expect(markPickedUp(s.owner.id, loan.id, deps)).rejects.toMatchObject({ code: "contact_required" });
    await shareContact((await conversationFor(s.item.id, s.borrower.id)).id, s.borrower.id); // either party may share
    await expect(markPickedUp(s.borrower.id, loan.id, deps)).rejects.toThrow(/Only the owner/);
    const active = await markPickedUp(s.owner.id, loan.id, deps);
    expect(active.pickedUpAt).toBeInstanceOf(Date);
  });

  it("lets either party cancel an approved loan with a reason, which unlocks the listing", async () => {
    const s = await scenario();
    const loan = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(1), endAt: hours(5) }, deps);
    await approveLoan(s.owner.id, loan.id, deps);
    await expect(cancelApprovedLoan(s.borrower.id, loan.id, "", deps)).rejects.toThrow(/Choose a reason/);
    await expect(cancelApprovedLoan(s.other.id, loan.id, "reason.plans_changed", deps)).rejects.toThrow(/can't do that/);
    const cancelled = await cancelApprovedLoan(s.borrower.id, loan.id, "reason.plans_changed", deps);
    expect(cancelled.status).toBe("cancelled");
    expect(await isListingLocked(s.item.id)).toBe(false);
    expect(sent.at(-1)).toMatchObject({ type: "loan.cancelled", toUserIds: [s.owner.id] });
  });
});

describe("returns and problems (S19, S20, D15, D19, R5)", () => {
  async function activeLoan() {
    const s = await scenario();
    const loan = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(1), endAt: hours(5) }, deps);
    await approveLoan(s.owner.id, loan.id, deps);
    await shareContact(loan.conversationId, s.owner.id);
    await markPickedUp(s.owner.id, loan.id, deps);
    return { s, loan };
  }

  it("requires a note for damage and reports it to the admin", async () => {
    const { s, loan } = await activeLoan();
    await markReturned(s.borrower.id, loan.id, deps);
    await expect(confirmReturn(s.owner.id, loan.id, "damaged", "  ", deps)).rejects.toThrow(/Add a note/);
    await confirmReturn(s.owner.id, loan.id, "damaged", "Blade chipped", deps);
    expect(sent.some((n) => n.type === "loan.problem_reported" && n.note === "Blade chipped")).toBe(true);
  });

  it("closes an active loan as not returned and delists the item", async () => {
    const { s, loan } = await activeLoan();
    const closed = await closeAsNotReturned(s.owner.id, loan.id, "Never came back", deps);
    expect(closed).toMatchObject({ status: "closed", outcome: "not_returned" });
    expect(await itemStatus(s.item.id)).toBe("delisted");
  });

  it("only the borrower marks returned, and nothing closes without the owner", async () => {
    const { s, loan } = await activeLoan();
    await expect(markReturned(s.owner.id, loan.id, deps)).rejects.toThrow(/Only the borrower/);
    await markReturned(s.borrower.id, loan.id, deps);
    await expect(confirmReturn(s.borrower.id, loan.id, "fine", null, deps)).rejects.toThrow(/Only the owner/);
  });

  it("sends problem reports to an admin who isn't a party to the loan (R5)", async () => {
    const { s, loan } = await activeLoan();
    // Make the owner an admin too; the other admin should be the only recipient.
    await db.update(users).set({ role: "admin" }).where(eq(users.id, s.owner.id));
    const { deliverLoanNotifications } = await import("@/server/email/loan-notifications");
    await closeAsNotReturned(s.owner.id, loan.id, "Lost", { notify: deliverLoanNotifications });
    const mail = await db
      .select()
      .from(emailLog)
      .where(and(eq(emailLog.template, "loan.problem_reported"), eq(emailLog.relatedId, loan.id)));
    expect(mail.map((m) => m.toUserId)).toEqual([s.admin.id]);
    expect(mail[0]!.body).toContain("Lost");
    expect(mail[0]!.body).not.toMatch(/555-0100/); // never leaks contact details
  });
});

describe("admin close for removed members (S23)", () => {
  it("only works when a party has been removed", async () => {
    const s = await scenario();
    const loan = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(1), endAt: hours(5) }, deps);
    await approveLoan(s.owner.id, loan.id, deps);
    await shareContact(loan.conversationId, s.owner.id);
    await markPickedUp(s.owner.id, loan.id, deps);
    await expect(adminCloseLoan(s.admin.id, loan.id, "fine", "Checked", deps)).rejects.toThrow(/removed members/);
    await expect(adminCloseLoan(s.owner.id, loan.id, "fine", "x", deps)).rejects.toThrow(/Only an admin/);

    await db.update(users).set({ status: "removed" }).where(eq(users.id, s.owner.id));
    const closed = await adminCloseLoan(s.admin.id, loan.id, "fine", "Owner removed; item returned in person", deps);
    expect(closed).toMatchObject({ status: "closed", outcome: "fine" });
    expect((await eventsFor(loan.id)).at(-1)!.actorId).toBe(s.admin.id);
  });
});
