import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  categories,
  communities,
  contactShares,
  conversations,
  items,
  memberships,
  userContacts,
  users,
} from "@/db/schema";

/** Empty every app table (fast, keeps the schema). */
export async function resetDb() {
  await db.execute(sql`
    TRUNCATE TABLE loan_event, loan, message, contact_share, conversation, item_photo, item,
      category, invitation, membership, community, user_contact, email_log,
      auth_session, auth_account, auth_verification_token, app_user
    RESTART IDENTITY CASCADE
  `);
}

let counter = 0;
const next = () => ++counter;

export async function makeUser(opts: { role?: "member" | "admin"; name?: string } = {}) {
  const n = next();
  const [user] = await db
    .insert(users)
    .values({ email: `user${n}@example.test`, name: opts.name ?? `User ${n}`, role: opts.role ?? "member" })
    .returning();
  return user!;
}

export async function makeCommunity() {
  const [c] = await db.insert(communities).values({ name: "Pilot group" }).returning();
  return c!;
}

export async function join(userId: string, communityId: string, role: "member" | "admin" = "member") {
  await db.insert(memberships).values({ userId, communityId, role });
}

export async function makeItem(ownerId: string, communityId: string, title = "Tile saw") {
  const [cat] = await db
    .insert(categories)
    .values({ name: `Cat ${next()}` })
    .returning();
  const [item] = await db
    .insert(items)
    .values({ ownerId, communityId, categoryId: cat!.id, title, description: "Works well", condition: "Good" })
    .returning();
  return item!;
}

/** A pilot group with an owner, a borrower, an admin and one item. */
export async function scenario() {
  const community = await makeCommunity();
  const owner = await makeUser({ name: "Olivia Owner" });
  const borrower = await makeUser({ name: "Ben Borrower" });
  const other = await makeUser({ name: "Oscar Other" });
  const admin = await makeUser({ role: "admin", name: "Ada Admin" });
  for (const u of [owner, borrower, other, admin]) await join(u.id, community.id);
  const item = await makeItem(owner.id, community.id);
  return { community, owner, borrower, other, admin, item };
}

export async function shareContact(conversationId: string, senderId: string) {
  const [contact] = await db
    .insert(userContacts)
    .values({ userId: senderId, type: "phone", value: "555-0100" })
    .returning();
  await db.insert(contactShares).values({
    conversationId,
    senderId,
    userContactId: contact!.id,
    contactType: "phone",
    valueShared: contact!.value,
  });
}

export async function conversationFor(itemId: string, askerId: string) {
  const rows = await db.select().from(conversations);
  return rows.find((c) => c.itemId === itemId && c.askerId === askerId)!;
}

export const hours = (h: number, from = new Date()) => new Date(from.getTime() + h * 3600_000);
