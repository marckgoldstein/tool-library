/**
 * Distributed Tool Library — v0.1 data model (PRD v1.0, section 6).
 *
 * Property names are camelCase in code; the database uses snake_case
 * (drizzle `casing: "snake_case"`). The PRD's `user` table is `app_user`
 * here because USER is a reserved word in Postgres.
 */
import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

const id = () =>
  text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow();
const ts = () => timestamp({ withTimezone: true, mode: "date" });
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

// ---------- Enums ----------

export const roleEnum = pgEnum("role", ["member", "admin"]);
export const userStatusEnum = pgEnum("user_status", ["active", "removed", "deleted"]);
export const locationSourceEnum = pgEnum("location_source", ["zip", "device"]);
export const contactTypeEnum = pgEnum("contact_type", ["phone", "email"]);
export const invitationStatusEnum = pgEnum("invitation_status", [
  "pending_admin",
  "approved",
  "accepted",
  "declined",
  "expired",
]);
export const itemStatusEnum = pgEnum("item_status", ["available", "on_loan", "paused", "delisted"]);
export const messageKindEnum = pgEnum("message_kind", ["canned", "contact_share"]);
export const loanStatusEnum = pgEnum("loan_status", [
  "requested",
  "approved",
  "active",
  "returned",
  "closed",
  "declined",
  "cancelled",
]);
export const loanOutcomeEnum = pgEnum("loan_outcome", ["fine", "damaged", "not_returned"]);
export const emailStatusEnum = pgEnum("email_status", ["queued", "sent", "failed"]);

export type LoanStatus = (typeof loanStatusEnum.enumValues)[number];
export type LoanOutcome = (typeof loanOutcomeEnum.enumValues)[number];
export type ItemStatus = (typeof itemStatusEnum.enumValues)[number];
export type ContactType = (typeof contactTypeEnum.enumValues)[number];

// ---------- People and groups ----------

export const users = pgTable("app_user", {
  id: id(),
  email: text().notNull().unique(),
  // Auth.js expects `name`, `emailVerified` and `image`.
  name: text("display_name"),
  emailVerified: timestamp("email_verified", { withTimezone: true, mode: "date" }),
  image: text("photo_key"),
  generalArea: varchar({ length: 40 }), // R8: town or neighborhood, never an address
  timezone: text(), // IANA zone from the browser at join (R7)
  termsAcceptedAt: ts(), // required notices accepted (PRD section 10)
  role: roleEnum().notNull().default("member"),
  status: userStatusEnum().notNull().default("active"),
  createdAt: createdAt(),
  // Reserved for later location search (D1); not collected in v0.1.
  postalCode: text(),
  approxLat: numeric({ precision: 6, scale: 3 }),
  approxLng: numeric({ precision: 6, scale: 3 }),
  locationSource: locationSourceEnum(),
});

export const userContacts = pgTable(
  "user_contact",
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: contactTypeEnum().notNull(),
    value: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId)],
);

export const communities = pgTable("community", {
  id: id(),
  name: text().notNull(),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "membership",
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    communityId: text()
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    role: roleEnum().notNull().default("member"),
    invitedBy: text().references(() => users.id, { onDelete: "set null" }), // recorded, never shown (D11)
    joinedAt: createdAt(),
    removedAt: ts(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.communityId] })],
);

export const invitations = pgTable(
  "invitation",
  {
    id: id(),
    communityId: text()
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    suggestedBy: text()
      .notNull()
      .references(() => users.id),
    inviteeName: text().notNull(),
    inviteeEmail: text().notNull(),
    status: invitationStatusEnum().notNull().default("pending_admin"),
    tokenHash: text().unique(), // single-use invite link, stored hashed
    expiresAt: ts(),
    decidedBy: text().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.communityId, t.status),
    index().on(t.inviteeEmail),
    // S1: one open invitation per address per group. Expired links are marked
    // "expired" before a new suggestion is checked, so they don't block it.
    uniqueIndex("invitation_open_email_idx")
      .on(t.communityId, t.inviteeEmail)
      .where(sql`${t.status} in ('pending_admin', 'approved')`),
  ],
);

// ---------- Items ----------

export const categories = pgTable(
  "category",
  {
    id: id(),
    name: text().notNull(),
    parentId: text().references((): AnyPgColumn => categories.id),
  },
  (t) => [unique().on(t.parentId, t.name).nullsNotDistinct()],
);

export const items = pgTable(
  "item",
  {
    id: id(),
    ownerId: text()
      .notNull()
      .references(() => users.id),
    communityId: text()
      .notNull()
      .references(() => communities.id),
    categoryId: text()
      .notNull()
      .references(() => categories.id),
    title: text().notNull(),
    description: text().notNull(),
    condition: text().notNull(),
    handoffNotes: text(),
    attributes: jsonb().notNull().default(sql`'{}'::jsonb`), // category-specific, queryable
    status: itemStatusEnum().notNull().default("available"),
    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
    // S9: full-text search over title (weight A) and description (weight B). Category names are matched in the query.
    searchVector: tsvector()
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("description", '')), 'B')`,
      ),
  },
  (t) => [
    index().on(t.communityId, t.status),
    index().on(t.ownerId),
    index("item_search_idx").using("gin", t.searchVector),
  ],
);

export const itemPhotos = pgTable(
  "item_photo",
  {
    id: id(),
    itemId: text()
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    storageKey: text().notNull(),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [index().on(t.itemId)],
);

// ---------- Threads and contact sharing ----------

export const conversations = pgTable(
  "conversation",
  {
    id: id(),
    itemId: text()
      .notNull()
      .references(() => items.id),
    askerId: text()
      .notNull()
      .references(() => users.id),
    ownerId: text()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.itemId, t.askerId)],
);

export const contactShares = pgTable(
  "contact_share",
  {
    id: id(),
    conversationId: text()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: text()
      .notNull()
      .references(() => users.id),
    userContactId: text().references(() => userContacts.id, { onDelete: "set null" }),
    contactType: contactTypeEnum().notNull(),
    valueShared: text().notNull(), // copy at send time
    sharedAt: createdAt(),
  },
  (t) => [index().on(t.conversationId)],
);

export const messages = pgTable(
  "message",
  {
    id: id(),
    conversationId: text()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: text()
      .notNull()
      .references(() => users.id),
    kind: messageKindEnum().notNull(),
    templateKey: text(), // canned only; wording lives in code
    contactShareId: text()
      .unique()
      .references(() => contactShares.id), // contact_share only
    createdAt: createdAt(),
  },
  (t) => [index().on(t.conversationId, t.createdAt)],
);

// ---------- Loans ----------

export const loans = pgTable(
  "loan",
  {
    id: id(),
    itemId: text()
      .notNull()
      .references(() => items.id),
    conversationId: text()
      .notNull()
      .references(() => conversations.id), // required (R3)
    borrowerId: text()
      .notNull()
      .references(() => users.id),
    ownerId: text()
      .notNull()
      .references(() => users.id),
    startAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    endAt: timestamp({ withTimezone: true, mode: "date" }).notNull(), // due time
    status: loanStatusEnum().notNull().default("requested"),
    outcome: loanOutcomeEnum(),
    reasonKey: text(), // canned cancel/decline reason
    pickedUpAt: ts(),
    returnedAt: ts(),
    closedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.itemId, t.status),
    index().on(t.borrowerId, t.status),
    index().on(t.ownerId, t.status),
  ],
);

export const loanEvents = pgTable(
  "loan_event",
  {
    id: id(),
    loanId: text()
      .notNull()
      .references(() => loans.id, { onDelete: "cascade" }),
    actorId: text().references(() => users.id), // null = system
    fromStatus: loanStatusEnum(),
    toStatus: loanStatusEnum().notNull(),
    reasonKey: text(),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.loanId, t.createdAt)],
);

// ---------- Email ----------

export const emailLog = pgTable(
  "email_log",
  {
    id: id(),
    toUserId: text().references(() => users.id, { onDelete: "set null" }),
    toEmail: text().notNull(),
    template: text().notNull(),
    relatedId: text(),
    subject: text().notNull(),
    body: text(), // kept only by the dev transport, for the local mailbox
    status: emailStatusEnum().notNull().default("queued"),
    error: text(),
    sentAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.toEmail, t.createdAt)],
);

// ---------- Auth.js tables ----------

export const accounts = pgTable(
  "auth_account",
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text().notNull(),
    provider: text().notNull(),
    providerAccountId: text().notNull(),
    refresh_token: text(),
    access_token: text(),
    expires_at: integer(),
    token_type: text(),
    scope: text(),
    id_token: text(),
    session_state: text(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("auth_session", {
  sessionToken: text().primaryKey(),
  userId: text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp({ mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "auth_verification_token",
  {
    identifier: text().notNull(),
    token: text().notNull(),
    expires: timestamp({ mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ---------- Relations (for the query API) ----------

export const loanRelations = relations(loans, ({ one, many }) => ({
  item: one(items, { fields: [loans.itemId], references: [items.id] }),
  conversation: one(conversations, {
    fields: [loans.conversationId],
    references: [conversations.id],
  }),
  events: many(loanEvents),
}));

export const loanEventRelations = relations(loanEvents, ({ one }) => ({
  loan: one(loans, { fields: [loanEvents.loanId], references: [loans.id] }),
}));

export const itemRelations = relations(items, ({ many, one }) => ({
  loans: many(loans),
  photos: many(itemPhotos),
  owner: one(users, { fields: [items.ownerId], references: [users.id] }),
  category: one(categories, { fields: [items.categoryId], references: [categories.id] }),
}));

export const itemPhotoRelations = relations(itemPhotos, ({ one }) => ({
  item: one(items, { fields: [itemPhotos.itemId], references: [items.id] }),
}));

export const conversationRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
  contactShares: many(contactShares),
}));

export const messageRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const contactShareRelations = relations(contactShares, ({ one }) => ({
  conversation: one(conversations, {
    fields: [contactShares.conversationId],
    references: [conversations.id],
  }),
}));
