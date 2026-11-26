import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { invitations, memberships, users } from "@/db/schema";
import type { OutgoingEmail } from "@/server/email/transport";
import {
  acceptInvitation,
  approveInvitation,
  declineInvitation,
  hashToken,
  lookupInvite,
  resendInvitation,
  suggestMember,
} from "@/server/invitations/service";
import { join, makeCommunity, makeUser, resetDb } from "../support/factories";

let sent: OutgoingEmail[] = [];
const deps = { send: async (e: OutgoingEmail) => void sent.push(e) };

beforeEach(async () => {
  await resetDb();
  sent = [];
});
afterAll(() => pool.end());

async function group() {
  const community = await makeCommunity();
  const admin = await makeUser({ role: "admin", name: "Ada Admin" });
  const member = await makeUser({ name: "Mia Member" });
  await join(admin.id, community.id, "admin");
  await join(member.id, community.id);
  return { community, admin, member };
}

/** The raw token only exists in the invite email; pull it out like the invitee would. */
const tokenFrom = (email: OutgoingEmail | undefined) => {
  const match = email?.text.match(/\/join\/([A-Za-z0-9_-]+)/);
  if (!match) throw new Error("No invite link in email");
  return match[1]!;
};

const joinInput = { displayName: "Sam", generalArea: "Maplewood", timezone: "America/Chicago", acceptedNotices: true };

describe("S1: a member suggests someone", () => {
  it("creates a pending invitation and emails the admin without the invitee's address", async () => {
    const g = await group();
    const inv = await suggestMember(g.member.id, { name: " Sam  Smith ", email: " Sam@Example.TEST " }, deps);
    expect(inv).toMatchObject({ status: "pending_admin", inviteeName: "Sam Smith", inviteeEmail: "sam@example.test", suggestedBy: g.member.id });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: g.admin.email, template: "invitation.suggested" });
    expect(sent[0]!.text).toContain("Sam Smith");
    expect(sent[0]!.text).not.toContain("sam@example.test"); // contact details never in emails
  });

  it("rejects duplicates: an open suggestion or an existing member", async () => {
    const g = await group();
    await suggestMember(g.member.id, { name: "Sam", email: "sam@example.test" }, deps);
    await expect(suggestMember(g.admin.id, { name: "Sam again", email: "SAM@example.test" }, deps)).rejects.toMatchObject({ code: "conflict" });
    await expect(suggestMember(g.member.id, { name: "Ada", email: g.admin.email }, deps)).rejects.toMatchObject({ code: "conflict" });
  });

  it("allows a new suggestion once an earlier one was declined", async () => {
    const g = await group();
    const first = await suggestMember(g.member.id, { name: "Sam", email: "sam@example.test" }, deps);
    await declineInvitation(g.admin.id, first.id, deps);
    await expect(suggestMember(g.member.id, { name: "Sam", email: "sam@example.test" }, deps)).resolves.toMatchObject({ status: "pending_admin" });
  });

  it("rejects bad input and non-members", async () => {
    const g = await group();
    const outsider = await makeUser();
    await expect(suggestMember(g.member.id, { name: "", email: "sam@example.test" }, deps)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(suggestMember(g.member.id, { name: "Sam", email: "not-an-email" }, deps)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(suggestMember(outsider.id, { name: "Sam", email: "sam@example.test" }, deps)).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("S2: the admin approves or declines", () => {
  it("approve stores only a hash and emails a single-use link to the invitee", async () => {
    const g = await group();
    const inv = await suggestMember(g.member.id, { name: "Sam", email: "sam@example.test" }, deps);
    sent = [];
    const approved = await approveInvitation(g.admin.id, inv.id, deps);
    expect(approved).toMatchObject({ status: "approved", decidedBy: g.admin.id });
    expect(sent[0]).toMatchObject({ to: "sam@example.test", template: "invitation.invite" });
    const token = tokenFrom(sent[0]);
    expect(approved.tokenHash).toBe(hashToken(token));
    expect(approved.tokenHash).not.toContain(token);
  });

  it("decline emails the suggester; neither can be done twice or by a member", async () => {
    const g = await group();
    const inv = await suggestMember(g.member.id, { name: "Sam", email: "sam@example.test" }, deps);
    await expect(approveInvitation(g.member.id, inv.id, deps)).rejects.toMatchObject({ code: "forbidden" });
    sent = [];
    await declineInvitation(g.admin.id, inv.id, deps);
    expect(sent[0]).toMatchObject({ to: g.member.email, template: "invitation.declined" });
    await expect(approveInvitation(g.admin.id, inv.id, deps)).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("an admin of another group can't see or decide it", async () => {
    const g = await group();
    const other = await makeCommunity();
    const otherAdmin = await makeUser({ role: "admin" });
    await join(otherAdmin.id, other.id, "admin");
    const inv = await suggestMember(g.member.id, { name: "Sam", email: "sam@example.test" }, deps);
    await expect(approveInvitation(otherAdmin.id, inv.id, deps)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("S3: the invitee joins from the link", () => {
  async function approvedInvite() {
    const g = await group();
    const inv = await suggestMember(g.member.id, { name: "Sam", email: "sam@example.test" }, deps);
    sent = [];
    await approveInvitation(g.admin.id, inv.id, deps);
    return { ...g, inv, token: tokenFrom(sent[0]) };
  }

  it("creates the member with notices accepted, records who suggested them, and uses up the link", async () => {
    const s = await approvedInvite();
    expect(await lookupInvite(s.token)).toMatchObject({ ok: true });
    const user = await acceptInvitation(s.token, joinInput, deps);
    expect(user).toMatchObject({ email: "sam@example.test", name: "Sam", generalArea: "Maplewood", timezone: "America/Chicago", role: "member", status: "active" });
    expect(user.termsAcceptedAt).toBeInstanceOf(Date);
    const [membership] = await db.select().from(memberships).where(eq(memberships.userId, user.id));
    expect(membership).toMatchObject({ communityId: s.community.id, invitedBy: s.member.id });
    const [inv] = await db.select().from(invitations).where(eq(invitations.id, s.inv.id));
    expect(inv).toMatchObject({ status: "accepted", tokenHash: null });

    // Works once.
    expect(await lookupInvite(s.token)).toEqual({ ok: false, reason: "invalid" });
    await expect(acceptInvitation(s.token, joinInput, deps)).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("expires after the link's lifetime", async () => {
    const s = await approvedInvite();
    const later = new Date(Date.now() + 8 * 86_400_000);
    expect(await lookupInvite(s.token, later)).toEqual({ ok: false, reason: "expired" });
    await expect(acceptInvitation(s.token, joinInput, { ...deps, now: () => later })).rejects.toMatchObject({ code: "invalid_state" });
    const [inv] = await db.select().from(invitations).where(eq(invitations.id, s.inv.id));
    expect(inv!.status).toBe("expired");
  });

  it("requires the notices, a name and a general area of 40 characters or fewer", async () => {
    const s = await approvedInvite();
    await expect(acceptInvitation(s.token, { ...joinInput, acceptedNotices: false }, deps)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(acceptInvitation(s.token, { ...joinInput, displayName: " " }, deps)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(acceptInvitation(s.token, { ...joinInput, generalArea: "x".repeat(41) }, deps)).rejects.toMatchObject({ code: "invalid_input" });
    expect(await db.select().from(users).where(eq(users.email, "sam@example.test"))).toHaveLength(0);
  });

  it("falls back to the pilot timezone for an unknown zone", async () => {
    const s = await approvedInvite();
    const user = await acceptInvitation(s.token, { ...joinInput, timezone: "Mars/Olympus" }, deps);
    expect(user.timezone).toBe("America/New_York");
  });

  it("a new link from the admin replaces the old one", async () => {
    const s = await approvedInvite();
    sent = [];
    await resendInvitation(s.admin.id, s.inv.id, deps);
    const fresh = tokenFrom(sent[0]);
    expect(fresh).not.toBe(s.token);
    expect(await lookupInvite(s.token)).toEqual({ ok: false, reason: "invalid" });
    expect(await lookupInvite(fresh)).toMatchObject({ ok: true });
  });
});
