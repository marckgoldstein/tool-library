import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/db";
import { alignedLocalMin, utcToZonedLocal, zonedLocalToUtc } from "@/lib/zoned-time";
import { getLoanView, listLoans, loansNeedingAction, openLoanForItem } from "@/server/loans/queries";
import { approveLoan, confirmReturn, markPickedUp, markReturned, requestLoan } from "@/server/loans/service";
import { conversationFor, hours, resetDb, scenario, shareContact } from "../support/factories";

const quiet = { notify: async () => {} };

beforeEach(() => resetDb());
afterAll(() => pool.end());

describe("member-timezone date entry (R7)", () => {
  it("reads datetime-local values as wall-clock times in the member's zone, across DST", () => {
    expect(zonedLocalToUtc("2026-12-01T09:30", "America/New_York")!.toISOString()).toBe("2026-12-01T14:30:00.000Z"); // EST
    expect(zonedLocalToUtc("2026-07-01T09:30", "America/New_York")!.toISOString()).toBe("2026-07-01T13:30:00.000Z"); // EDT
    expect(zonedLocalToUtc("2026-12-01T09:30", "Europe/London")!.toISOString()).toBe("2026-12-01T09:30:00.000Z");
    expect(zonedLocalToUtc("not a date", "America/New_York")).toBeNull();
    expect(utcToZonedLocal(new Date("2026-12-01T14:30:00Z"), "America/New_York")).toBe("2026-12-01T09:30");
    // min must line up with the 15-minute step, or the browser rejects round times like 09:00.
    expect(alignedLocalMin(new Date("2026-12-01T17:37:00Z"), "America/New_York")).toBe("2026-12-01T12:30");
  });
});

describe("loan queries for the M5 screens", () => {
  it("shows a loan to its two parties and admins only", async () => {
    const s = await scenario();
    const loan = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(1), endAt: hours(5) }, quiet);
    expect((await getLoanView(s.borrower.id, "member", loan.id)).role).toBe("borrower");
    expect((await getLoanView(s.owner.id, "member", loan.id)).role).toBe("owner");
    expect((await getLoanView(s.admin.id, "admin", loan.id)).role).toBe("admin");
    await expect(getLoanView(s.other.id, "member", loan.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("puts what's waiting on each member first, and counts it for the header badge", async () => {
    const s = await scenario();
    const loan = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(1), endAt: hours(5) }, quiet);
    let owner = await listLoans(s.owner.id);
    expect(owner.open[0]).toMatchObject({ id: loan.id, role: "owner", needsAction: "Approve or decline", otherName: "Ben Borrower" });
    expect(await loansNeedingAction(s.owner.id)).toBe(1);
    expect(await loansNeedingAction(s.borrower.id)).toBe(0);
    expect(await openLoanForItem(s.borrower.id, s.item.id)).toMatchObject({ id: loan.id, status: "requested" });

    await approveLoan(s.owner.id, loan.id, quiet);
    const view = await getLoanView(s.owner.id, "member", loan.id);
    expect(view.hasContactShare).toBe(false); // S15: the pickup gate shows
    await shareContact((await conversationFor(s.item.id, s.borrower.id)).id, s.owner.id);
    expect((await getLoanView(s.owner.id, "member", loan.id)).hasContactShare).toBe(true);
    await markPickedUp(s.owner.id, loan.id, quiet);
    await markReturned(s.borrower.id, loan.id, quiet);
    owner = await listLoans(s.owner.id);
    expect(owner.open[0]).toMatchObject({ status: "returned", needsAction: "Check it over and confirm" }); // S19: owner's to-do

    await confirmReturn(s.owner.id, loan.id, "fine", null, quiet);
    owner = await listLoans(s.owner.id);
    expect(owner.open).toEqual([]);
    expect(owner.past[0]).toMatchObject({ id: loan.id, status: "closed" });
    expect(await openLoanForItem(s.borrower.id, s.item.id)).toBeNull();
  });

  it("flags an overdue loan for the borrower (S18)", async () => {
    const s = await scenario();
    const loan = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(1), endAt: hours(2) }, quiet);
    await approveLoan(s.owner.id, loan.id, quiet);
    await shareContact((await conversationFor(s.item.id, s.borrower.id)).id, s.owner.id);
    await markPickedUp(s.owner.id, loan.id, quiet);
    const later = hours(3);
    const borrower = await listLoans(s.borrower.id, later);
    expect(borrower.open[0]).toMatchObject({ status: "overdue", needsAction: "Overdue: return it or message the owner" });
    expect((await getLoanView(s.borrower.id, "member", loan.id, later)).status).toBe("overdue");
  });
});
