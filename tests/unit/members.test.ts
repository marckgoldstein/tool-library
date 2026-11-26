import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { memberships, sessions, users } from "@/db/schema";
import { listMembersForAdmin, removeMember, setAdmin } from "@/server/members/service";
import { getPublicProfile } from "@/server/profiles/service";
import { approveLoan, requestLoan } from "@/server/loans/service";
import { hours, resetDb, scenario } from "../support/factories";

const quiet = { notify: async () => {} };

beforeEach(() => resetDb());
afterAll(() => pool.end());

async function makeAdmin(userId: string) {
  await db.update(users).set({ role: "admin" }).where(eq(users.id, userId));
  await db.update(memberships).set({ role: "admin" }).where(eq(memberships.userId, userId));
}

describe("S6: the admin removes a member", () => {
  it("marks them removed, signs them out everywhere, and hides their profile", async () => {
    const s = await scenario();
    await makeAdmin(s.admin.id);
    await db.insert(sessions).values({ sessionToken: "t-1", userId: s.other.id, expires: hours(24) });
    const result = await removeMember(s.admin.id, s.other.id);
    expect(result).toEqual({ openLoans: 0 });
    const [u] = await db.select().from(users).where(eq(users.id, s.other.id));
    expect(u!.status).toBe("removed");
    const [m] = await db.select().from(memberships).where(eq(memberships.userId, s.other.id));
    expect(m!.removedAt).toBeInstanceOf(Date);
    expect(await db.select().from(sessions).where(eq(sessions.userId, s.other.id))).toHaveLength(0);
    await expect(getPublicProfile(s.owner.id, s.other.id)).rejects.toMatchObject({ code: "not_found" });
    const list = await listMembersForAdmin(s.admin.id);
    expect(list.removed.map((r) => r.id)).toEqual([s.other.id]);
  });

  it("leaves open loans in place and reports them", async () => {
    const s = await scenario();
    await makeAdmin(s.admin.id);
    const loan = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(1), endAt: hours(5) }, quiet);
    await approveLoan(s.owner.id, loan.id, quiet);
    expect(await removeMember(s.admin.id, s.owner.id)).toEqual({ openLoans: 1 });
  });

  it("only admins can remove, nobody removes themselves, and the last admin stays", async () => {
    const s = await scenario();
    await makeAdmin(s.admin.id);
    await expect(removeMember(s.owner.id, s.other.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(removeMember(s.admin.id, s.admin.id)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(setAdmin(s.admin.id, s.admin.id, false)).rejects.toMatchObject({ code: "invalid_state" });
  });
});

describe("T9: a second admin", () => {
  it("promotes a member, then either admin can step down while one remains", async () => {
    const s = await scenario();
    await makeAdmin(s.admin.id);
    await setAdmin(s.admin.id, s.owner.id, true);
    const [owner] = await db.select().from(users).where(eq(users.id, s.owner.id));
    expect(owner!.role).toBe("admin");
    const [ownerMembership] = await db.select().from(memberships).where(eq(memberships.userId, s.owner.id));
    expect(ownerMembership!.role).toBe("admin");

    await setAdmin(s.owner.id, s.admin.id, false); // the new admin demotes the original one
    await expect(setAdmin(s.owner.id, s.owner.id, false)).rejects.toMatchObject({ code: "invalid_state" });
    // A remaining admin can be removed only while another admin exists.
    await setAdmin(s.owner.id, s.other.id, true);
    await expect(removeMember(s.other.id, s.owner.id)).resolves.toEqual({ openLoans: 0 });
  });
});
