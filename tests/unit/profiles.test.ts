import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { contactShares, loans, memberships, userContacts, users } from "@/db/schema";
import { getOwnContacts, getPublicProfile, saveContacts, updateProfile } from "@/server/profiles/service";
import { approveLoan, confirmReturn, markPickedUp, markReturned, requestLoan } from "@/server/loans/service";
import { conversationFor, hours, join, makeCommunity, makeUser, resetDb, scenario, shareContact } from "../support/factories";

const quiet = { notify: async () => {} };

beforeEach(() => resetDb());
afterAll(() => pool.end());

describe("S4: contact details", () => {
  it("saves one phone and one email, updates them, and clears a blank field", async () => {
    const s = await scenario();
    await saveContacts(s.owner.id, { phone: " 555-010-0100 ", email: "Olivia@Example.TEST" });
    expect(await getOwnContacts(s.owner.id)).toEqual({ phone: "555-010-0100", email: "olivia@example.test" });

    await saveContacts(s.owner.id, { phone: "+1 (555) 010-0199", email: "" });
    expect(await getOwnContacts(s.owner.id)).toEqual({ phone: "+1 (555) 010-0199", email: null });
    const rows = await db.select().from(userContacts).where(eq(userContacts.userId, s.owner.id));
    expect(rows).toHaveLength(1); // one per type, no duplicates
  });

  it("rejects malformed values and saves nothing", async () => {
    const s = await scenario();
    await expect(saveContacts(s.owner.id, { phone: "12", email: "" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(saveContacts(s.owner.id, { phone: "call me", email: "" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(saveContacts(s.owner.id, { phone: "", email: "not-an-email" })).rejects.toMatchObject({ code: "invalid_input" });
    expect(await getOwnContacts(s.owner.id)).toEqual({ phone: null, email: null });
  });

  it("changing a detail leaves what was already sent untouched", async () => {
    const s = await scenario();
    const loan = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(1), endAt: hours(5) }, quiet);
    await shareContact(loan.conversationId, s.owner.id); // shares 555-0100
    await saveContacts(s.owner.id, { phone: "555-010-0199", email: "" });
    const [share] = await db.select().from(contactShares);
    expect(share!.valueShared).toBe("555-0100");
  });
});

describe("S5: profile page", () => {
  it("shows name, area, join date and counts, never email or contact details", async () => {
    const s = await scenario();
    await db.update(users).set({ generalArea: "Maplewood" }).where(eq(users.id, s.owner.id));
    await saveContacts(s.owner.id, { phone: "555-010-0100", email: "private@example.test" });
    const profile = await getPublicProfile(s.borrower.id, s.owner.id);
    expect(profile).toMatchObject({ id: s.owner.id, name: "Olivia Owner", generalArea: "Maplewood", lentCount: 0, borrowedCount: 0, isSelf: false });
    expect(profile.joinedAt).toBeInstanceOf(Date);
    const json = JSON.stringify(profile);
    expect(json).not.toContain("555-010-0100");
    expect(json).not.toContain("private@example.test");
    expect(json).not.toContain(s.owner.email);
    expect(json).not.toContain("invited");
  });

  it("counts only loans that have closed", async () => {
    const s = await scenario();
    const loan = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(1), endAt: hours(5) }, quiet);
    await approveLoan(s.owner.id, loan.id, quiet);
    await shareContact((await conversationFor(s.item.id, s.borrower.id)).id, s.owner.id);
    await markPickedUp(s.owner.id, loan.id, quiet);
    expect(await getPublicProfile(s.other.id, s.owner.id)).toMatchObject({ lentCount: 0 });

    await markReturned(s.borrower.id, loan.id, quiet);
    await confirmReturn(s.owner.id, loan.id, "fine", null, quiet);
    expect(await getPublicProfile(s.other.id, s.owner.id)).toMatchObject({ lentCount: 1, borrowedCount: 0 });
    expect(await getPublicProfile(s.other.id, s.borrower.id)).toMatchObject({ lentCount: 0, borrowedCount: 1 });
    expect((await db.select().from(loans)).map((l) => l.status)).toEqual(["closed"]);
  });

  it("is hidden from other groups and for removed members", async () => {
    const s = await scenario();
    const otherGroup = await makeCommunity();
    const outsider = await makeUser();
    await join(outsider.id, otherGroup.id);
    await expect(getPublicProfile(outsider.id, s.owner.id)).rejects.toMatchObject({ code: "not_found" });

    await db.update(memberships).set({ removedAt: new Date() }).where(eq(memberships.userId, s.other.id));
    await expect(getPublicProfile(s.owner.id, s.other.id)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("editing your profile", () => {
  it("updates name and area with the same rules as joining", async () => {
    const s = await scenario();
    await expect(updateProfile(s.owner.id, { displayName: "Liv", generalArea: "Downtown" })).resolves.toMatchObject({ name: "Liv", generalArea: "Downtown" });
    await expect(updateProfile(s.owner.id, { displayName: "", generalArea: "Downtown" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(updateProfile(s.owner.id, { displayName: "Liv", generalArea: "x".repeat(41) })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("sets and removes the photo", async () => {
    const s = await scenario();
    await updateProfile(s.owner.id, { displayName: "Liv", generalArea: "Downtown", photoKey: "profiles/abc.webp" });
    expect((await getPublicProfile(s.owner.id, s.owner.id)).photoKey).toBe("profiles/abc.webp");
    await updateProfile(s.owner.id, { displayName: "Liv", generalArea: "Downtown", removePhoto: true });
    expect((await getPublicProfile(s.owner.id, s.owner.id)).photoKey).toBeNull();
  });
});
