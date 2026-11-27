/**
 * Admin member management (M2: S6, T9).
 *
 * - S6: removing a member ends their sessions and blocks sign-in (auth.ts only
 *   signs in active users). Their loans are not touched here: open loans stay
 *   visible to the other party, and an admin closes them with S23.
 * - T9 / R5: a group can have more than one admin, so a dispute email can go to
 *   an admin who isn't a party (adminRecipients in loan-notifications.ts).
 *   The last admin can't be removed or demoted.
 */
import { and, count, eq, inArray, isNull, or } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { items, loans, memberships, sessions, users } from "@/db/schema";
import { OPEN_STATUSES } from "../loans/rules";
import { DomainError, forbidden, notFound } from "../errors";

async function requireAdmin(tx: Tx, adminId: string) {
  const [row] = await tx
    .select({ communityId: memberships.communityId, role: users.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.userId, adminId), isNull(memberships.removedAt), eq(users.status, "active")));
  if (!row || row.role !== "admin") throw forbidden("Only the admin can do that.");
  return row;
}

async function loadMemberForUpdate(tx: Tx, communityId: string, memberId: string) {
  const [row] = await tx
    .select({ id: users.id, role: users.role, status: users.status, removedAt: memberships.removedAt })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(and(eq(users.id, memberId), eq(memberships.communityId, communityId)))
    .for("update");
  if (!row || row.removedAt || row.status !== "active") throw notFound("Member");
  return row;
}

async function activeAdminCount(tx: Tx, communityId: string) {
  // Lock the group's admin rows so two admins can't demote each other at once.
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.communityId, communityId),
        isNull(memberships.removedAt),
        eq(users.role, "admin"),
        eq(users.status, "active"),
      ),
    )
    .for("update");
  return rows.length;
}

/** S6: remove a member. Returns how many of their loans are still open, for the admin to follow up (S23). */
export async function removeMember(adminId: string, memberId: string, now = new Date()) {
  if (adminId === memberId) throw new DomainError("invalid_input", "You can't remove yourself.");
  return db.transaction(async (tx) => {
    const admin = await requireAdmin(tx, adminId);
    const member = await loadMemberForUpdate(tx, admin.communityId, memberId);
    if (member.role === "admin" && (await activeAdminCount(tx, admin.communityId)) <= 1) {
      throw new DomainError("invalid_state", "The group needs at least one admin.");
    }
    await tx
      .update(memberships)
      .set({ removedAt: now })
      .where(and(eq(memberships.userId, memberId), eq(memberships.communityId, admin.communityId)));
    await tx.update(users).set({ status: "removed" }).where(eq(users.id, memberId));
    await tx.delete(sessions).where(eq(sessions.userId, memberId)); // signed out everywhere, now
    const [open] = await tx
      .select({ n: count() })
      .from(loans)
      .where(
        and(
          inArray(loans.status, [...OPEN_STATUSES, "requested"]),
          or(eq(loans.ownerId, memberId), eq(loans.borrowerId, memberId)),
        ),
      );
    return { openLoans: open?.n ?? 0 };
  });
}

/** T9: make a member an admin, or an admin a member again. The group always keeps one admin. */
export async function setAdmin(actorId: string, memberId: string, makeAdmin: boolean) {
  return db.transaction(async (tx) => {
    const admin = await requireAdmin(tx, actorId);
    const member = await loadMemberForUpdate(tx, admin.communityId, memberId);
    const role = makeAdmin ? "admin" : "member";
    if (member.role === role) return { role };
    if (!makeAdmin && (await activeAdminCount(tx, admin.communityId)) <= 1) {
      throw new DomainError("invalid_state", "The group needs at least one admin.");
    }
    await tx.update(users).set({ role }).where(eq(users.id, memberId));
    await tx
      .update(memberships)
      .set({ role })
      .where(and(eq(memberships.userId, memberId), eq(memberships.communityId, admin.communityId)));
    return { role };
  });
}

/** Everyone in the admin's group, active members first. Admin only. */
export async function listMembersForAdmin(adminId: string) {
  const admin = await db.transaction((tx) => requireAdmin(tx, adminId));
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      joinedAt: memberships.joinedAt,
      removedAt: memberships.removedAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.communityId, admin.communityId))
    .orderBy(users.name);
  const active = rows.filter((r) => !r.removedAt && r.status === "active");
  const removedRows = rows.filter((r) => (r.removedAt || r.status !== "active") && r.status !== "deleted");
  // S23: open loans a removed member is part of, for the admin to close.
  const removedIds = removedRows.map((r) => r.id);
  const openLoans = removedIds.length
    ? await db
        .select({ id: loans.id, ownerId: loans.ownerId, borrowerId: loans.borrowerId, itemTitle: items.title, status: loans.status })
        .from(loans)
        .innerJoin(items, eq(items.id, loans.itemId))
        .where(
          and(
            inArray(loans.status, [...OPEN_STATUSES, "requested"]),
            or(inArray(loans.ownerId, removedIds), inArray(loans.borrowerId, removedIds)),
          ),
        )
    : [];
  const removed = removedRows.map((r) => ({
    ...r,
    openLoans: openLoans.filter((l) => l.ownerId === r.id || l.borrowerId === r.id).map((l) => ({ id: l.id, itemTitle: l.itemTitle, status: l.status })),
  }));
  return { active, removed };
}
