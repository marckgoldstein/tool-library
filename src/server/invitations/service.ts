/**
 * Invitations (M2: S1, S2, S3). Members suggest people, the admin approves or
 * declines, and an approved invitee joins from a single-use link (D10, D11).
 *
 * Like the loan service: each action runs in one transaction and emails go out
 * only after it commits. Invite links are stored hashed (token_hash) and the raw
 * token only ever exists in the invitee's email.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { communities, invitations, memberships, users } from "@/db/schema";
import { sendEmail, type OutgoingEmail } from "@/server/email/transport";
import { DomainError, forbidden, notFound } from "../errors";
import { GENERAL_AREA_MAX, NAME_MAX, cleanEmail, cleanGeneralArea, cleanName } from "../profiles/validation";

export { GENERAL_AREA_MAX, NAME_MAX };

/** How long an approved invite link works (D37). */
export const INVITE_LINK_DAYS = 7;
export const DEFAULT_TIMEZONE = "America/New_York"; // R7 pilot default

type Invitation = typeof invitations.$inferSelect;

export interface InvitationDeps {
  /** Override in tests to capture emails instead of sending them. */
  send?: (email: OutgoingEmail) => Promise<unknown>;
  now?: () => Date;
}

const defaults: Required<InvitationDeps> = {
  send: sendEmail,
  now: () => new Date(),
};

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

/** Send after commit. A failed email is logged as failed in email_log, never undoes the saved change. */
async function deliver(deps: Required<InvitationDeps>, emails: OutgoingEmail[]) {
  for (const email of emails) await deps.send(email).catch(() => undefined);
}

// ---------- membership helpers ----------

/** The group a member belongs to (the pilot has one), or null if they aren't an active member. */
export async function activeMembership(userId: string, tx: Tx | typeof db = db) {
  const [row] = await tx
    .select({ communityId: memberships.communityId, name: users.name, role: users.role, timezone: users.timezone })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.userId, userId), isNull(memberships.removedAt), eq(users.status, "active")));
  return row ?? null;
}

async function requireAdmin(tx: Tx, userId: string) {
  const member = await activeMembership(userId, tx);
  if (!member || member.role !== "admin") throw forbidden("Only the admin can do that.");
  return member;
}

async function activeAdmins(tx: Tx | typeof db, communityId: string) {
  return tx
    .select({ id: users.id, email: users.email })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.communityId, communityId),
        isNull(memberships.removedAt),
        eq(users.role, "admin"),
        eq(users.status, "active"),
      ),
    );
}

/** No background jobs (D29): approved links past their expiry are marked when next touched. */
async function expireStaleLinks(tx: Tx, communityId: string, now: Date) {
  await tx
    .update(invitations)
    .set({ status: "expired", tokenHash: null })
    .where(and(eq(invitations.communityId, communityId), eq(invitations.status, "approved"), lt(invitations.expiresAt, now)));
}

/** Postgres unique_violation; Drizzle wraps the driver error, so look through `cause`. */
function isUniqueViolation(e: unknown): boolean {
  for (let err: unknown = e, depth = 0; err && typeof err === "object" && depth < 5; depth++) {
    if ((err as { code?: string }).code === "23505") return true;
    err = (err as { cause?: unknown }).cause;
  }
  return false;
}

// ---------- S1: suggest ----------

export async function suggestMember(
  suggesterId: string,
  input: { name: string; email: string },
  overrides?: InvitationDeps,
): Promise<Invitation> {
  const deps = { ...defaults, ...overrides };
  const inviteeName = cleanName(input.name, "their name");
  const inviteeEmail = cleanEmail(input.email);
  const now = deps.now();

  const { invitation, emails } = await db
    .transaction(async (tx) => {
      const member = await activeMembership(suggesterId, tx);
      if (!member) throw forbidden("Only members of the group can suggest someone.");

      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, inviteeEmail));
      if (existing) throw new DomainError("conflict", "That person is already a member, or used to be.");

      await expireStaleLinks(tx, member.communityId, now);
      const [created] = await tx
        .insert(invitations)
        .values({ communityId: member.communityId, suggestedBy: suggesterId, inviteeName, inviteeEmail })
        .returning();

      // Names only: the invitee's email stays on the admin page, never in an email (CLAUDE.md, D13).
      const admins = await activeAdmins(tx, member.communityId);
      const emails: OutgoingEmail[] = admins.map((a) => ({
        to: a.email,
        toUserId: a.id,
        template: "invitation.suggested",
        relatedId: created!.id,
        subject: `New member suggestion: ${inviteeName}`,
        text: [
          `${member.name ?? "A member"} suggested ${inviteeName} join the group.`,
          `Approve or decline the suggestion: ${appUrl()}/admin/invitations`,
        ].join("\n\n"),
      }));
      return { invitation: created!, emails };
    })
    .catch((e: unknown) => {
      if (isUniqueViolation(e)) {
        throw new DomainError("conflict", "Someone has already suggested that address. The admin will review it.");
      }
      throw e;
    });

  await deliver(deps, emails);
  return invitation;
}

// ---------- S2: approve or decline ----------

async function loadPendingForUpdate(tx: Tx, adminCommunityId: string, invitationId: string) {
  const [inv] = await tx.select().from(invitations).where(eq(invitations.id, invitationId)).for("update");
  if (!inv || inv.communityId !== adminCommunityId) throw notFound("Suggestion");
  return inv;
}

function inviteEmail(inv: Invitation, communityName: string, token: string, expiresAt: Date): OutgoingEmail {
  const until = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: DEFAULT_TIMEZONE }).format(expiresAt);
  return {
    to: inv.inviteeEmail,
    toUserId: null,
    template: "invitation.invite",
    relatedId: inv.id,
    subject: `You're invited to join ${communityName} on the Tool Library`,
    text: [
      `Hi ${inv.inviteeName},`,
      `You've been invited to join ${communityName}, a private group that lends tools and gear to each other. No fees, no deposits; owners approve every loan.`,
      `Join here. The link works once and expires on ${until}:`,
      `${appUrl()}/join/${token}`,
      "If you weren't expecting this, you can ignore this email.",
    ].join("\n\n"),
  };
}

export async function approveInvitation(adminId: string, invitationId: string, overrides?: InvitationDeps) {
  const deps = { ...defaults, ...overrides };
  const now = deps.now();
  const { invitation, emails } = await db.transaction(async (tx) => {
    const admin = await requireAdmin(tx, adminId);
    const inv = await loadPendingForUpdate(tx, admin.communityId, invitationId);
    if (inv.status !== "pending_admin") throw new DomainError("invalid_state", "This suggestion has already been decided.");
    const token = newToken();
    const expiresAt = new Date(now.getTime() + INVITE_LINK_DAYS * 86_400_000);
    const [updated] = await tx
      .update(invitations)
      .set({ status: "approved", decidedBy: adminId, tokenHash: hashToken(token), expiresAt })
      .where(eq(invitations.id, inv.id))
      .returning();
    const [community] = await tx.select({ name: communities.name }).from(communities).where(eq(communities.id, inv.communityId));
    return { invitation: updated!, emails: [inviteEmail(inv, community?.name ?? "the Tool Library", token, expiresAt)] };
  });
  await deliver(deps, emails);
  return invitation;
}

export async function declineInvitation(adminId: string, invitationId: string, overrides?: InvitationDeps) {
  const deps = { ...defaults, ...overrides };
  const { invitation, emails } = await db.transaction(async (tx) => {
    const admin = await requireAdmin(tx, adminId);
    const inv = await loadPendingForUpdate(tx, admin.communityId, invitationId);
    if (inv.status !== "pending_admin") throw new DomainError("invalid_state", "This suggestion has already been decided.");
    const [updated] = await tx
      .update(invitations)
      .set({ status: "declined", decidedBy: adminId })
      .where(eq(invitations.id, inv.id))
      .returning();
    const [suggester] = await tx
      .select({ id: users.id, email: users.email, status: users.status })
      .from(users)
      .where(eq(users.id, inv.suggestedBy));
    const emails: OutgoingEmail[] =
      suggester && suggester.status === "active"
        ? [
            {
              to: suggester.email,
              toUserId: suggester.id,
              template: "invitation.declined",
              relatedId: inv.id,
              subject: `Your suggestion wasn't approved`,
              text: [
                `The admin decided not to invite ${inv.inviteeName} for now.`,
                "If you think that's a mistake, talk to the admin directly.",
              ].join("\n\n"),
            },
          ]
        : [];
    return { invitation: updated!, emails };
  });
  await deliver(deps, emails);
  return invitation;
}

/** Approved but never used (lost email, expired link): send a fresh link and retire the old one. */
export async function resendInvitation(adminId: string, invitationId: string, overrides?: InvitationDeps) {
  const deps = { ...defaults, ...overrides };
  const now = deps.now();
  const { invitation, emails } = await db
    .transaction(async (tx) => {
      const admin = await requireAdmin(tx, adminId);
      const inv = await loadPendingForUpdate(tx, admin.communityId, invitationId);
      if (inv.status !== "approved" && inv.status !== "expired") {
        throw new DomainError("invalid_state", "Only an approved invite that hasn't been used can be sent again.");
      }
      const [member] = await tx.select({ id: users.id }).from(users).where(eq(users.email, inv.inviteeEmail));
      if (member) throw new DomainError("conflict", "That person has already joined.");
      const token = newToken();
      const expiresAt = new Date(now.getTime() + INVITE_LINK_DAYS * 86_400_000);
      const [updated] = await tx
        .update(invitations)
        .set({ status: "approved", decidedBy: adminId, tokenHash: hashToken(token), expiresAt })
        .where(eq(invitations.id, inv.id))
        .returning();
      const [community] = await tx.select({ name: communities.name }).from(communities).where(eq(communities.id, inv.communityId));
      return { invitation: updated!, emails: [inviteEmail(inv, community?.name ?? "the Tool Library", token, expiresAt)] };
    })
    .catch((e: unknown) => {
      if (isUniqueViolation(e)) throw new DomainError("conflict", "There's already an open invitation for that address.");
      throw e;
    });
  await deliver(deps, emails);
  return invitation;
}

// ---------- S3: join from the link ----------

export type InviteLookup =
  | { ok: true; invitation: Invitation; communityName: string }
  | { ok: false; reason: "invalid" | "expired" };

/** Read-only check for the join page. Used and unknown links look the same. */
export async function lookupInvite(token: string, now = new Date()): Promise<InviteLookup> {
  if (!token || token.length > 100) return { ok: false, reason: "invalid" };
  const [row] = await db
    .select({ invitation: invitations, communityName: communities.name })
    .from(invitations)
    .innerJoin(communities, eq(communities.id, invitations.communityId))
    .where(eq(invitations.tokenHash, hashToken(token)));
  if (!row || row.invitation.status !== "approved") return { ok: false, reason: "invalid" };
  if (!row.invitation.expiresAt || row.invitation.expiresAt <= now) return { ok: false, reason: "expired" };
  return { ok: true, invitation: row.invitation, communityName: row.communityName };
}

export function cleanTimezone(value: string | null | undefined): string {
  if (!value) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export interface JoinInput {
  displayName: string;
  generalArea: string;
  timezone?: string | null;
  acceptedNotices: boolean;
  photoKey?: string | null;
}

export function validateJoin(input: JoinInput) {
  const displayName = cleanName(input.displayName, "a display name");
  const generalArea = cleanGeneralArea(input.generalArea);
  if (!input.acceptedNotices) throw new DomainError("invalid_input", "Tick the box to accept the notices before joining.");
  return { displayName, generalArea, timezone: cleanTimezone(input.timezone) };
}

/** Creates the member and their membership, and uses up the link, in one transaction. */
export async function acceptInvitation(token: string, input: JoinInput, overrides?: InvitationDeps) {
  const deps = { ...defaults, ...overrides };
  const now = deps.now();
  const clean = validateJoin(input);
  const unusable = () => new DomainError("invalid_state", "This invite link has expired or was already used.");
  const result = await db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invitations).where(eq(invitations.tokenHash, hashToken(token))).for("update");
    if (!inv || inv.status !== "approved") throw unusable();
    if (!inv.expiresAt || inv.expiresAt <= now) {
      // Commit the expiry (no background jobs, D29), then report it outside the transaction.
      await tx.update(invitations).set({ status: "expired", tokenHash: null }).where(eq(invitations.id, inv.id));
      return null;
    }
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, inv.inviteeEmail));
    if (existing) throw new DomainError("conflict", "This email address already has an account. Sign in instead.");

    const [user] = await tx
      .insert(users)
      .values({
        email: inv.inviteeEmail,
        name: clean.displayName,
        generalArea: clean.generalArea,
        timezone: clean.timezone,
        image: input.photoKey ?? null,
        termsAcceptedAt: now,
        role: "member",
      })
      .returning();
    await tx.insert(memberships).values({
      userId: user!.id,
      communityId: inv.communityId,
      role: "member",
      invitedBy: inv.suggestedBy, // recorded, never shown (D11)
    });
    await tx
      .update(invitations)
      .set({ status: "accepted", tokenHash: null })
      .where(eq(invitations.id, inv.id));
    return user!;
  });
  if (!result) throw unusable();
  return result;
}

// ---------- queries for pages ----------

const STATUS_ORDER = ["pending_admin", "approved", "expired", "accepted", "declined"] as const;

/** Admin review list for the admin's group. Includes the invitee's email (admin only). */
export async function listForAdmin(adminId: string, now = new Date()) {
  const admin = await activeMembership(adminId);
  if (!admin || admin.role !== "admin") throw forbidden("Only the admin can see suggestions.");
  await db.transaction((tx) => expireStaleLinks(tx, admin.communityId, now));
  const rows = await db
    .select({
      id: invitations.id,
      inviteeName: invitations.inviteeName,
      inviteeEmail: invitations.inviteeEmail,
      status: invitations.status,
      createdAt: invitations.createdAt,
      expiresAt: invitations.expiresAt,
      suggestedByName: users.name,
    })
    .from(invitations)
    .innerJoin(users, eq(users.id, invitations.suggestedBy))
    .where(eq(invitations.communityId, admin.communityId))
    .orderBy(desc(invitations.createdAt))
    .limit(200);
  return rows.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
}

/** A member's own suggestions, without the invitee's email. */
export async function listForSuggester(userId: string) {
  return db
    .select({
      id: invitations.id,
      inviteeName: invitations.inviteeName,
      status: invitations.status,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .where(eq(invitations.suggestedBy, userId))
    .orderBy(desc(invitations.createdAt))
    .limit(50);
}

export async function pendingCount(adminId: string) {
  const admin = await activeMembership(adminId);
  if (!admin || admin.role !== "admin") return 0;
  const rows = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(and(eq(invitations.communityId, admin.communityId), inArray(invitations.status, ["pending_admin"])));
  return rows.length;
}
