/**
 * S21: a member deletes their account (D21, PRD section 10).
 *
 * - Blocked while they have an approved, active or returned loan, either side.
 * - Their pending requests are cancelled and requests for their items declined,
 *   through the loan service (S22), and the other members are emailed.
 * - Their items are delisted.
 * - Personal data is removed: name, email, photo, general area, timezone, saved
 *   contacts, values they shared in threads, sessions, and email bodies. Loan
 *   history stays, anonymised, as "Former member" (PRD section 10).
 * - The last admin can't delete their account; make someone else admin first.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  contactShares,
  emailLog,
  invitations,
  items,
  loans,
  memberships,
  sessions,
  userContacts,
  users,
} from "@/db/schema";
import { deliverLoanNotifications, type LoanNotification } from "../email/loan-notifications";
import { closeRequestsForDeletedMember } from "../loans/service";
import { OPEN_STATUSES } from "../loans/rules";
import { deletePhoto } from "../storage/photos";
import { DomainError, notFound } from "../errors";

export const DELETED_NAME = "Former member";

export interface AccountDeps {
  notify?: (n: LoanNotification[]) => Promise<void>;
  now?: () => Date;
}

/** What stands in the way of deleting, for the profile page. */
export async function deletionBlockers(userId: string) {
  const open = await db
    .select({ id: loans.id })
    .from(loans)
    .where(and(inArray(loans.status, OPEN_STATUSES), or(eq(loans.borrowerId, userId), eq(loans.ownerId, userId))));
  const [me] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
  let lastAdmin = false;
  if (me?.role === "admin") {
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .where(and(eq(users.role, "admin"), eq(users.status, "active"), isNull(memberships.removedAt)));
    lastAdmin = admins.length <= 1;
  }
  return { openLoans: open.length, lastAdmin };
}

export async function deleteAccount(userId: string, overrides?: AccountDeps) {
  const notify = overrides?.notify ?? deliverLoanNotifications;
  const now = (overrides?.now ?? (() => new Date()))();
  const { notifications, photoKey } = await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!user || user.status === "deleted") throw notFound("Account");
    const blockers = await deletionBlockers(userId);
    if (blockers.openLoans > 0) {
      throw new DomainError("invalid_state", "You have loans in progress. Finish or cancel them first, then delete your account.");
    }
    if (blockers.lastAdmin) throw new DomainError("invalid_state", "You're the group's only admin. Make someone else an admin first.");

    const notifications = await closeRequestsForDeletedMember(tx, userId, now);
    await tx.update(items).set({ status: "delisted" }).where(and(eq(items.ownerId, userId), inArray(items.status, ["available", "paused"])));

    const anonEmail = `deleted-${user.id}@deleted.invalid`;
    await tx.delete(userContacts).where(eq(userContacts.userId, userId));
    await tx.update(contactShares).set({ valueShared: "(removed)" }).where(eq(contactShares.senderId, userId));
    await tx.update(emailLog).set({ toEmail: anonEmail, body: null }).where(eq(emailLog.toUserId, userId));
    await tx.update(invitations).set({ inviteeEmail: anonEmail, inviteeName: DELETED_NAME }).where(eq(invitations.inviteeEmail, user.email));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(accounts).where(eq(accounts.userId, userId));
    await tx.update(memberships).set({ removedAt: now }).where(and(eq(memberships.userId, userId), isNull(memberships.removedAt)));
    await tx
      .update(users)
      .set({
        email: anonEmail,
        name: DELETED_NAME,
        image: null,
        generalArea: null,
        timezone: null,
        emailVerified: null,
        postalCode: null,
        approxLat: null,
        approxLng: null,
        locationSource: null,
        role: "member",
        status: "deleted",
      })
      .where(eq(users.id, userId));
    return { notifications, photoKey: user.image };
  });
  if (photoKey) await deletePhoto(photoKey).catch(() => undefined);
  if (notifications.length > 0) await notify(notifications);
}
