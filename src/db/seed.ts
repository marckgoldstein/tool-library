/**
 * Development seed: one pilot group, an admin, three members, the starter
 * categories (T10), a few items, and one loan in each interesting state.
 * Safe to re-run: it clears the app tables first. Never run against production.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "./index";
import { categories, communities, contactShares, items, memberships, userContacts, users } from "./schema";
import { STARTER_CATEGORIES } from "../content/categories";
import { approveLoan, markPickedUp, requestLoan } from "../server/loans/service";

export const SEED_USERS = {
  admin: { email: "admin@example.test", name: "Ada Admin", role: "admin" as const },
  owner: { email: "olivia@example.test", name: "Olivia", role: "member" as const },
  borrower: { email: "ben@example.test", name: "Ben", role: "member" as const },
  other: { email: "oscar@example.test", name: "Oscar", role: "member" as const },
};

const quiet = { notify: async () => {} }; // no emails during seeding

export async function seed() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production.");
  await db.execute(sql`
    TRUNCATE TABLE loan_event, loan, message, contact_share, conversation, item_photo, item,
      category, invitation, membership, community, user_contact, email_log,
      auth_session, auth_account, auth_verification_token, app_user RESTART IDENTITY CASCADE`);

  const [group] = await db.insert(communities).values({ name: "Friends & Family Pilot" }).returning();
  const created: Record<keyof typeof SEED_USERS, typeof users.$inferSelect> = {} as never;
  for (const [key, u] of Object.entries(SEED_USERS) as [keyof typeof SEED_USERS, (typeof SEED_USERS)[keyof typeof SEED_USERS]][]) {
    const [row] = await db
      .insert(users)
      .values({ ...u, generalArea: "Maplewood", timezone: "America/New_York", termsAcceptedAt: new Date() })
      .returning();
    created[key] = row!;
    await db.insert(memberships).values({ userId: row!.id, communityId: group!.id, role: u.role });
  }

  const categoryIds: Record<string, string> = {};
  for (const top of STARTER_CATEGORIES) {
    const [parent] = await db.insert(categories).values({ name: top.name }).returning();
    categoryIds[top.name] = parent!.id;
    for (const child of top.children) {
      const [c] = await db.insert(categories).values({ name: child, parentId: parent!.id }).returning();
      categoryIds[child] = c!.id;
    }
  }

  const newItem = async (title: string, category: string, ownerKey: keyof typeof created) => {
    const [item] = await db
      .insert(items)
      .values({
        ownerId: created[ownerKey].id,
        communityId: group!.id,
        categoryId: categoryIds[category]!,
        title,
        description: `${title}, kept in good working order.`,
        condition: "Good",
        handoffNotes: "Porch pickup, evenings.",
      })
      .returning();
    return item!;
  };

  const saw = await newItem("Wet tile saw", "Saws", "owner");
  const washer = await newItem("Pressure washer", "Pressure washers", "owner");
  await newItem("4-person tent", "Tents", "other");

  const hour = 3600_000;
  const now = Date.now();
  await requestLoan(
    { borrowerId: created.borrower.id, itemId: washer.id, startAt: new Date(now + 24 * hour), endAt: new Date(now + 48 * hour) },
    quiet,
  );
  // An active loan that's already overdue, for the overdue badge (S18).
  const overdue = await requestLoan(
    { borrowerId: created.borrower.id, itemId: saw.id, startAt: new Date(now + hour), endAt: new Date(now + 2 * hour) },
    quiet,
  );
  await approveLoan(created.owner.id, overdue.id, quiet);
  const [contact] = await db
    .insert(userContacts)
    .values({ userId: created.owner.id, type: "phone", value: "555-0100" })
    .returning();
  await db.insert(contactShares).values({
    conversationId: overdue.conversationId,
    senderId: created.owner.id,
    userContactId: contact!.id,
    contactType: "phone",
    valueShared: contact!.value,
  });
  await markPickedUp(created.owner.id, overdue.id, quiet);
  await db.execute(sql`UPDATE loan SET start_at = now() - interval '3 days', end_at = now() - interval '1 day' WHERE id = ${overdue.id}`);

  return { group: group!, users: created, items: { saw, washer }, loans: { overdue } };
}

// Run directly: `npm run db:seed`
if (process.argv[1]?.endsWith("seed.ts")) {
  seed()
    .then((r) => console.log(`Seeded group "${r.group.name}". Sign in as ${SEED_USERS.owner.email} or ${SEED_USERS.admin.email}.`))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
