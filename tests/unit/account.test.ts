import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { contactShares, emailLog, items, loans, memberships, sessions, userContacts, users } from "@/db/schema";
import { DELETED_NAME, deleteAccount, deletionBlockers } from "@/server/account/service";
import { adminDelistItem } from "@/server/items/service";
import { approveLoan, REQUESTS_PER_HOUR, requestLoan } from "@/server/loans/service";
import type { LoanNotification } from "@/server/email/loan-notifications";
import { hours, makeItem, resetDb, scenario } from "../support/factories";

const quiet = { notify: async () => {} };

beforeEach(() => resetDb());
afterAll(() => pool.end());

async function makeAdmin(userId: string) {
  await db.update(users).set({ role: "admin" }).where(eq(users.id, userId));
  await db.update(memberships).set({ role: "admin" }).where(eq(memberships.userId, userId));
}

describe("S21: a member deletes their account", () => {
  it("is blocked while a loan is in progress, either side", async () => {
    const s = await scenario();
    const loan = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(1), endAt: hours(5) }, quiet);
    await approveLoan(s.owner.id, loan.id, quiet);
    expect(await deletionBlockers(s.borrower.id)).toMatchObject({ openLoans: 1 });
    await expect(deleteAccount(s.borrower.id, quiet)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(deleteAccount(s.owner.id, quiet)).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("is blocked for the last admin", async () => {
    const s = await scenario();
    await db.update(users).set({ role: "member" }).where(eq(users.id, s.admin.id));
    await makeAdmin(s.admin.id);
    expect(await deletionBlockers(s.admin.id)).toMatchObject({ lastAdmin: true });
    await expect(deleteAccount(s.admin.id, quiet)).rejects.toThrow(/only admin/);
  });

  it("closes requests both ways, delists items, removes personal data and keeps history anonymised", async () => {
    const s = await scenario();
    const otherItem = await makeItem(s.other.id, s.community.id, "Ladder");
    const mine = await requestLoan({ borrowerId: s.borrower.id, itemId: otherItem.id, startAt: hours(1), endAt: hours(5) }, quiet);
    const theirs = await requestLoan({ borrowerId: s.other.id, itemId: (await makeItem(s.borrower.id, s.community.id, "Drill")).id, startAt: hours(1), endAt: hours(5) }, quiet);
    await db.insert(sessions).values({ sessionToken: "t-del", userId: s.borrower.id, expires: hours(24) });
    await db.insert(userContacts).values({ userId: s.borrower.id, type: "phone", value: "555-0199" });
    await db.insert(emailLog).values({ toUserId: s.borrower.id, toEmail: "ben@example.test", template: "x", subject: "Hi", body: "secret body" });
    await db.update(users).set({ generalArea: "Maplewood", timezone: "America/Chicago" }).where(eq(users.id, s.borrower.id));

    const sent: LoanNotification[] = [];
    await deleteAccount(s.borrower.id, { notify: async (n) => void sent.push(...n) });

    const [u] = await db.select().from(users).where(eq(users.id, s.borrower.id));
    expect(u).toMatchObject({ name: DELETED_NAME, status: "deleted", image: null, generalArea: null, timezone: null, role: "member" });
    expect(u!.email).toMatch(/@deleted\.invalid$/);
    const [m] = await db.select().from(memberships).where(eq(memberships.userId, s.borrower.id));
    expect(m!.removedAt).toBeInstanceOf(Date);
    expect(await db.select().from(sessions).where(eq(sessions.userId, s.borrower.id))).toHaveLength(0);
    expect(await db.select().from(userContacts).where(eq(userContacts.userId, s.borrower.id))).toHaveLength(0);
    const [log] = await db.select().from(emailLog).where(eq(emailLog.toUserId, s.borrower.id));
    expect(log).toMatchObject({ body: null });
    expect(log!.toEmail).toMatch(/@deleted\.invalid$/);

    const [a] = await db.select().from(loans).where(eq(loans.id, mine.id));
    const [b] = await db.select().from(loans).where(eq(loans.id, theirs.id));
    expect(a!.status).toBe("cancelled");
    expect(b!.status).toBe("declined");
    const theirItems = await db.select().from(items).where(eq(items.ownerId, s.borrower.id));
    expect(theirItems.every((i) => i.status === "delisted")).toBe(true);
    // The other members are told; the deleted member is not.
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((n) => !n.toUserIds.includes(s.borrower.id))).toBe(true);
  });

  it("blanks contact values they shared in threads", async () => {
    const s = await scenario();
    const { openThread } = await import("@/server/threads/service");
    const thread = await openThread(s.borrower.id, s.item.id);
    const [contact] = await db.insert(userContacts).values({ userId: s.borrower.id, type: "phone", value: "555-0100" }).returning();
    await db.insert(contactShares).values({ conversationId: thread.id, senderId: s.borrower.id, userContactId: contact!.id, contactType: "phone", valueShared: "555-0100" });
    await deleteAccount(s.borrower.id, quiet);
    const shares = await db.select().from(contactShares).where(eq(contactShares.senderId, s.borrower.id));
    expect(shares.every((x) => x.valueShared === "(removed)")).toBe(true);
  });
});

describe("S24: the admin takes down a listing", () => {
  it("needs a note, delists the item and emails the owner", async () => {
    const s = await scenario();
    await makeAdmin(s.admin.id);
    const sent: { to: string; template: string; text: string }[] = [];
    const send = async (e: { to: string; template: string; text: string }) => void sent.push(e);
    await expect(adminDelistItem(s.admin.id, s.item.id, "   ", send)).rejects.toMatchObject({ code: "invalid_input" });
    const item = await adminDelistItem(s.admin.id, s.item.id, "Not allowed in the group", send);
    expect(item.status).toBe("delisted");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ template: "item.admin_delisted" });
    expect(sent[0]!.text).toContain("Not allowed in the group");
  });

  it("only an admin can, and not while a loan is approved", async () => {
    const s = await scenario();
    await makeAdmin(s.admin.id);
    await expect(adminDelistItem(s.other.id, s.item.id, "No", async () => {})).rejects.toMatchObject({ code: "forbidden" });
    const loan = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(1), endAt: hours(5) }, quiet);
    await approveLoan(s.owner.id, loan.id, quiet);
    await expect(adminDelistItem(s.admin.id, s.item.id, "No", async () => {})).rejects.toMatchObject({ code: "listing_locked" });
  });
});

describe("PRD section 8: request rate limit", () => {
  it(`allows ${REQUESTS_PER_HOUR} requests an hour, then asks the member to wait`, async () => {
    const s = await scenario();
    for (let i = 0; i < REQUESTS_PER_HOUR; i++) {
      const item = await makeItem(s.owner.id, s.community.id, `Thing ${i}`);
      await requestLoan({ borrowerId: s.borrower.id, itemId: item.id, startAt: hours(1), endAt: hours(5) }, quiet);
    }
    await expect(
      requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(1), endAt: hours(5) }, quiet),
    ).rejects.toThrow(/lot of requests/);
  });
});
