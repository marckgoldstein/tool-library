/**
 * Profiles (M2: S4, S5).
 *
 * - Contact details (S4, D13) are private: only their owner reads them here.
 *   They leave this module only through a contact share (S11, M4), which copies
 *   one value to one member.
 * - The public profile (S5) shows name, photo, general area, join date and
 *   lend/borrow counts, to members of the same group only. Who invited them is
 *   never returned (D11), and neither is their email address.
 */
import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { loans, memberships, userContacts, users, type ContactType } from "@/db/schema";
import { DomainError, notFound } from "../errors";
import { cleanEmail, cleanGeneralArea, cleanName, cleanPhone } from "./validation";

// ---------- S5: public profile ----------

export interface PublicProfile {
  id: string;
  name: string;
  photoKey: string | null;
  generalArea: string | null;
  joinedAt: Date;
  lentCount: number;
  borrowedCount: number;
  isSelf: boolean;
}

async function activeMembershipRow(userId: string) {
  const [row] = await db
    .select({ communityId: memberships.communityId, joinedAt: memberships.joinedAt })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.userId, userId), isNull(memberships.removedAt), eq(users.status, "active")));
  return row ?? null;
}

/** A member's profile as another member of the same group sees it. Not found and not allowed look the same. */
export async function getPublicProfile(viewerId: string, memberId: string): Promise<PublicProfile> {
  const viewer = await activeMembershipRow(viewerId);
  if (!viewer) throw notFound("Member");
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      photoKey: users.image,
      generalArea: users.generalArea,
      joinedAt: memberships.joinedAt,
    })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(
      and(
        eq(users.id, memberId),
        eq(users.status, "active"),
        eq(memberships.communityId, viewer.communityId),
        isNull(memberships.removedAt),
      ),
    );
  if (!row) throw notFound("Member");

  // Counts update when a loan closes (S5): only closed loans count.
  const [lent] = await db
    .select({ n: count() })
    .from(loans)
    .where(and(eq(loans.ownerId, memberId), eq(loans.status, "closed")));
  const [borrowed] = await db
    .select({ n: count() })
    .from(loans)
    .where(and(eq(loans.borrowerId, memberId), eq(loans.status, "closed")));

  return {
    id: row.id,
    name: row.name ?? "Member",
    photoKey: row.photoKey,
    generalArea: row.generalArea,
    joinedAt: row.joinedAt,
    lentCount: lent?.n ?? 0,
    borrowedCount: borrowed?.n ?? 0,
    isSelf: viewerId === memberId,
  };
}

// ---------- editing your own profile ----------

export async function getOwnProfile(userId: string) {
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email, generalArea: users.generalArea, photoKey: users.image })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.status, "active")));
  if (!row) throw notFound("Member");
  return row;
}

export interface ProfileInput {
  displayName: string;
  generalArea: string;
  /** A new stored photo, or undefined to keep the current one. */
  photoKey?: string;
  removePhoto?: boolean;
}

export async function updateProfile(userId: string, input: ProfileInput) {
  const name = cleanName(input.displayName, "a display name");
  const generalArea = cleanGeneralArea(input.generalArea);
  const photo = input.photoKey !== undefined ? { image: input.photoKey } : input.removePhoto ? { image: null } : {};
  const [updated] = await db
    .update(users)
    .set({ name, generalArea, ...photo })
    .where(and(eq(users.id, userId), eq(users.status, "active")))
    .returning({ id: users.id, name: users.name, generalArea: users.generalArea, photoKey: users.image });
  if (!updated) throw notFound("Member");
  return updated;
}

// ---------- S4: contact details ----------

export interface OwnContacts {
  phone: string | null;
  email: string | null;
}

/** The member's own saved contact details. Never call this for anyone but the signed-in member. */
export async function getOwnContacts(userId: string): Promise<OwnContacts> {
  const rows = await db
    .select({ type: userContacts.type, value: userContacts.value })
    .from(userContacts)
    .where(eq(userContacts.userId, userId))
    .orderBy(userContacts.createdAt);
  const latest = (type: ContactType) => rows.filter((r) => r.type === type).at(-1)?.value ?? null;
  return { phone: latest("phone"), email: latest("email") };
}

/**
 * Save one phone number and one email for sharing. A blank field removes that
 * detail. Past shares keep the value as it was sent (contact_share.value_shared).
 */
export async function saveContacts(userId: string, input: { phone: string; email: string }): Promise<OwnContacts> {
  const phone = input.phone.trim() ? cleanPhone(input.phone) : null;
  const email = input.email.trim() ? cleanEmail(input.email) : null;
  return db.transaction(async (tx) => {
    const [member] = await tx.select({ status: users.status }).from(users).where(eq(users.id, userId));
    if (!member || member.status !== "active") throw new DomainError("forbidden", "Only active members can save contact details.");
    for (const [type, value] of [["phone", phone], ["email", email]] as const) {
      const existing = await tx
        .select({ id: userContacts.id, value: userContacts.value })
        .from(userContacts)
        .where(and(eq(userContacts.userId, userId), eq(userContacts.type, type)));
      if (value === null) {
        for (const row of existing) await tx.delete(userContacts).where(eq(userContacts.id, row.id));
      } else if (existing.length === 0) {
        await tx.insert(userContacts).values({ userId, type, value });
      } else {
        const [keep, ...extra] = existing;
        if (keep!.value !== value) await tx.update(userContacts).set({ value }).where(eq(userContacts.id, keep!.id));
        for (const row of extra) await tx.delete(userContacts).where(eq(userContacts.id, row.id));
      }
    }
    return { phone, email };
  });
}
