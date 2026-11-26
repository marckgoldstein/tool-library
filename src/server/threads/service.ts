/**
 * Threads (M4: S10 canned messages, S11 contact sharing).
 *
 * - One thread per asker per item (unique index); threads open before any request (D12).
 * - Messages are canned only, keyed by template_key and filtered by role and stage (D24).
 * - A contact share copies one saved value to one thread (D13). The value is shown
 *   only to the two people in the thread; emails never carry it (CLAUDE.md), but the
 *   recipient's email does carry the recipient-only note (PRD section 9).
 * - Like the loan service: one transaction per action, emails after commit.
 */
import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type Tx } from "@/db";
import { contactShares, conversations, items, loans, memberships, messages, userContacts, users, type ContactType } from "@/db/schema";
import {
  CONTACT_SHARE_RECIPIENT_NOTE,
  cannedText,
  categoriesFor,
  contactShareText,
  isAllowedTemplate,
  type CannedCategory,
  type ThreadRole,
  type ThreadStage,
} from "@/content/canned-messages";
import { sendEmail, type OutgoingEmail } from "../email/transport";
import { DomainError, forbidden, notFound } from "../errors";

/** PRD section 8: rate limits on messages. Generous for real use, a brake on abuse. */
export const MESSAGES_PER_HOUR = 30;

export interface ThreadDeps {
  send?: (email: OutgoingEmail) => Promise<unknown>;
  now?: () => Date;
}
const defaults: Required<ThreadDeps> = { send: sendEmail, now: () => new Date() };
const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";
const threadLink = (id: string) => `${appUrl()}/threads/${id}`;

async function deliver(deps: Required<ThreadDeps>, emails: OutgoingEmail[]) {
  for (const e of emails) await deps.send(e).catch(() => undefined); // logged as failed; never undoes the message
}

type Conversation = typeof conversations.$inferSelect;
type LoanStatus = typeof loans.$inferSelect.status;

// ---------- stage ----------

/** The thread's stage comes from its latest loan (S10): what can sensibly be said now. */
export function stageFromLoan(status: LoanStatus | null | undefined): ThreadStage {
  if (!status || status === "requested") return "before_pickup";
  if (status === "approved") return "approved";
  if (status === "active" || status === "returned") return "picked_up";
  return "closed"; // closed, declined, cancelled
}

async function latestLoanStatus(tx: Tx | typeof db, conversationId: string): Promise<LoanStatus | null> {
  const [row] = await tx
    .select({ status: loans.status })
    .from(loans)
    .where(eq(loans.conversationId, conversationId))
    .orderBy(desc(loans.createdAt))
    .limit(1);
  return row?.status ?? null;
}

// ---------- access ----------

async function activeMemberGroup(tx: Tx | typeof db, userId: string) {
  const [row] = await tx
    .select({ communityId: memberships.communityId, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.userId, userId), sql`${memberships.removedAt} is null`, eq(users.status, "active")));
  return row ?? null;
}

function roleIn(conversation: Conversation, userId: string): ThreadRole | null {
  if (conversation.askerId === userId) return "asker";
  if (conversation.ownerId === userId) return "owner";
  return null;
}

/** Only the two people in a thread may read or write it. Not found and not allowed look the same. */
async function loadThreadForParty(tx: Tx | typeof db, userId: string, conversationId: string) {
  const [conversation] = await tx.select().from(conversations).where(eq(conversations.id, conversationId));
  const role = conversation ? roleIn(conversation, userId) : null;
  if (!conversation || !role) throw notFound("Thread");
  if (!(await activeMemberGroup(tx, userId))) throw notFound("Thread");
  return { conversation, role };
}

async function otherPartyActive(tx: Tx | typeof db, conversation: Conversation, role: ThreadRole) {
  const otherId = role === "asker" ? conversation.ownerId : conversation.askerId;
  const [other] = await tx.select({ id: users.id, name: users.name, email: users.email, status: users.status }).from(users).where(eq(users.id, otherId));
  return other!;
}

async function checkRate(tx: Tx, senderId: string, now: Date) {
  const since = new Date(now.getTime() - 3_600_000);
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.senderId, senderId), gt(messages.createdAt, since)));
  if ((row?.n ?? 0) >= MESSAGES_PER_HOUR) {
    throw new DomainError("conflict", "You've sent a lot of messages in the last hour. Try again a little later.");
  }
}

// ---------- S10: open a thread ----------

/** Open (or return) the asker's thread on an item. Threads can start before any request (D12). */
export async function openThread(askerId: string, itemId: string): Promise<Conversation> {
  return db.transaction(async (tx) => {
    const group = await activeMemberGroup(tx, askerId);
    if (!group) throw forbidden("Only members of the group can message an owner.");
    const [item] = await tx.select().from(items).where(eq(items.id, itemId));
    if (!item || item.communityId !== group.communityId) throw notFound("Item");
    if (item.ownerId === askerId) throw new DomainError("invalid_input", "This is your own item.");
    if (item.status === "paused" || item.status === "delisted") throw notFound("Item");
    const ownerGroup = await activeMemberGroup(tx, item.ownerId);
    if (!ownerGroup) throw notFound("Item");
    const [existing] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.itemId, itemId), eq(conversations.askerId, askerId)));
    if (existing) return existing;
    const [created] = await tx
      .insert(conversations)
      .values({ itemId, askerId, ownerId: item.ownerId })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    // Opened at the same moment in another tab: return that one.
    const [raced] = await tx.select().from(conversations).where(and(eq(conversations.itemId, itemId), eq(conversations.askerId, askerId)));
    return raced!;
  });
}

// ---------- S10: send a canned message ----------

export async function sendCannedMessage(senderId: string, conversationId: string, templateKey: string, overrides?: ThreadDeps) {
  const deps = { ...defaults, ...overrides };
  const now = deps.now();
  const { message, emails } = await db.transaction(async (tx) => {
    const { conversation, role } = await loadThreadForParty(tx, senderId, conversationId);
    const stage = stageFromLoan(await latestLoanStatus(tx, conversation.id));
    if (!isAllowedTemplate(templateKey, role, stage)) {
      throw new DomainError("invalid_input", "That message isn't available at this point in the thread.");
    }
    const other = await otherPartyActive(tx, conversation, role);
    if (other.status !== "active") throw new DomainError("invalid_state", "This member is no longer in the group, so the thread is closed.");
    await checkRate(tx, senderId, now);
    const [message] = await tx
      .insert(messages)
      .values({ conversationId: conversation.id, senderId, kind: "canned", templateKey, createdAt: now })
      .returning();
    const [item] = await tx.select({ title: items.title }).from(items).where(eq(items.id, conversation.itemId));
    const [sender] = await tx.select({ name: users.name }).from(users).where(eq(users.id, senderId));
    const emails: OutgoingEmail[] = [
      {
        to: other.email,
        toUserId: other.id,
        template: "thread.message",
        relatedId: conversation.id,
        subject: `New message about ${item?.title ?? "an item"}`,
        text: [
          `${sender?.name ?? "A member"} wrote about ${item?.title ?? "an item"}:`,
          `“${cannedText(templateKey)}”`,
          `Reply in the thread: ${threadLink(conversation.id)}`,
        ].join("\n\n"),
      },
    ];
    return { message: message!, emails };
  });
  await deliver(deps, emails);
  return message;
}

// ---------- S11: send a saved contact detail ----------

export async function sendContactDetail(senderId: string, conversationId: string, type: ContactType, overrides?: ThreadDeps) {
  const deps = { ...defaults, ...overrides };
  const now = deps.now();
  const { share, emails } = await db.transaction(async (tx) => {
    const { conversation, role } = await loadThreadForParty(tx, senderId, conversationId);
    const other = await otherPartyActive(tx, conversation, role);
    if (other.status !== "active") throw new DomainError("invalid_state", "This member is no longer in the group, so the thread is closed.");
    const [contact] = await tx
      .select()
      .from(userContacts)
      .where(and(eq(userContacts.userId, senderId), eq(userContacts.type, type)))
      .orderBy(desc(userContacts.createdAt))
      .limit(1);
    if (!contact) {
      throw new DomainError("invalid_input", `You haven't saved ${type === "phone" ? "a phone number" : "an email"} yet. Add one on Your profile.`);
    }
    await checkRate(tx, senderId, now);
    const [share] = await tx
      .insert(contactShares)
      .values({ conversationId: conversation.id, senderId, userContactId: contact.id, contactType: type, valueShared: contact.value, sharedAt: now })
      .returning();
    await tx.insert(messages).values({ conversationId: conversation.id, senderId, kind: "contact_share", contactShareId: share!.id, createdAt: now });
    const [item] = await tx.select({ title: items.title }).from(items).where(eq(items.id, conversation.itemId));
    const [sender] = await tx.select({ name: users.name }).from(users).where(eq(users.id, senderId));
    const emails: OutgoingEmail[] = [
      {
        to: other.email,
        toUserId: other.id,
        template: "thread.contact_share",
        relatedId: conversation.id,
        subject: `${sender?.name ?? "A member"} sent you their contact details`,
        text: [
          `${sender?.name ?? "A member"} sent you their ${type === "phone" ? "phone number" : "email address"} about ${item?.title ?? "an item"}. It's in the thread, not in this email: ${threadLink(conversation.id)}`,
          CONTACT_SHARE_RECIPIENT_NOTE,
        ].join("\n\n"),
      },
    ];
    return { share: share!, emails };
  });
  await deliver(deps, emails);
  return share;
}

// ---------- reading ----------

export interface ThreadMessageView {
  id: string;
  mine: boolean;
  senderName: string;
  createdAt: Date;
  kind: "canned" | "contact_share";
  text: string;
  /** PRD section 9: drawn under a contact share for the recipient only, never stored as a message. */
  recipientNote: string | null;
}

export interface ThreadView {
  id: string;
  role: ThreadRole;
  stage: ThreadStage;
  item: { id: string; title: string; status: string };
  other: { id: string; name: string; active: boolean };
  messages: ThreadMessageView[];
  categories: CannedCategory[];
  savedContactTypes: ContactType[];
  canWrite: boolean;
  hasContactShare: boolean;
}

export async function getThread(viewerId: string, conversationId: string): Promise<ThreadView> {
  const { conversation, role } = await loadThreadForParty(db, viewerId, conversationId);
  const stage = stageFromLoan(await latestLoanStatus(db, conversation.id));
  const other = await otherPartyActive(db, conversation, role);
  const [item] = await db.select({ id: items.id, title: items.title, status: items.status }).from(items).where(eq(items.id, conversation.itemId));
  const sender = alias(users, "sender");
  const rows = await db
    .select({
      id: messages.id,
      senderId: messages.senderId,
      senderName: sender.name,
      kind: messages.kind,
      templateKey: messages.templateKey,
      createdAt: messages.createdAt,
      shareValue: contactShares.valueShared,
    })
    .from(messages)
    .innerJoin(sender, eq(sender.id, messages.senderId))
    .leftJoin(contactShares, eq(contactShares.id, messages.contactShareId))
    .where(eq(messages.conversationId, conversation.id))
    .orderBy(messages.createdAt);
  const saved = await db.select({ type: userContacts.type }).from(userContacts).where(eq(userContacts.userId, viewerId));
  const savedContactTypes = (["phone", "email"] as const).filter((t) => saved.some((s) => s.type === t));
  const canWrite = other.status === "active";
  return {
    id: conversation.id,
    role,
    stage,
    item: item!,
    other: { id: other.id, name: other.name ?? "Member", active: other.status === "active" },
    messages: rows.map((r) => {
      const mine = r.senderId === viewerId;
      const isShare = r.kind === "contact_share";
      return {
        id: r.id,
        mine,
        senderName: mine ? "You" : (r.senderName ?? "Member"),
        createdAt: r.createdAt,
        kind: r.kind,
        text: isShare ? contactShareText(r.shareValue ?? "") : (cannedText(r.templateKey ?? "") ?? "(message no longer available)"),
        recipientNote: isShare && !mine ? CONTACT_SHARE_RECIPIENT_NOTE : null,
      };
    }),
    categories: canWrite ? categoriesFor(role, stage) : [],
    savedContactTypes: canWrite ? savedContactTypes : [],
    canWrite,
    hasContactShare: rows.some((r) => r.kind === "contact_share"),
  };
}

export interface ThreadSummary {
  id: string;
  itemId: string;
  itemTitle: string;
  otherName: string;
  role: ThreadRole;
  lastAt: Date;
  lastText: string | null;
  lastMine: boolean;
}

/** The viewer's threads, most recent activity first. Previews never show a contact value. */
export async function listThreads(viewerId: string): Promise<ThreadSummary[]> {
  if (!(await activeMemberGroup(db, viewerId))) return [];
  const asker = alias(users, "asker");
  const owner = alias(users, "owner");
  const rows = await db
    .select({
      id: conversations.id,
      itemId: conversations.itemId,
      itemTitle: items.title,
      askerId: conversations.askerId,
      askerName: asker.name,
      ownerName: owner.name,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .innerJoin(items, eq(items.id, conversations.itemId))
    .innerJoin(asker, eq(asker.id, conversations.askerId))
    .innerJoin(owner, eq(owner.id, conversations.ownerId))
    .where(or(eq(conversations.askerId, viewerId), eq(conversations.ownerId, viewerId)));
  if (rows.length === 0) return [];
  const latest = await db
    .selectDistinctOn([messages.conversationId], {
      conversationId: messages.conversationId,
      senderId: messages.senderId,
      kind: messages.kind,
      templateKey: messages.templateKey,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(inArray(messages.conversationId, rows.map((r) => r.id)))
    .orderBy(messages.conversationId, desc(messages.createdAt));
  const byId = new Map(latest.map((m) => [m.conversationId, m]));
  return rows
    .map((r) => {
      const last = byId.get(r.id);
      const role: ThreadRole = r.askerId === viewerId ? "asker" : "owner";
      return {
        id: r.id,
        itemId: r.itemId,
        itemTitle: r.itemTitle,
        otherName: (role === "asker" ? r.ownerName : r.askerName) ?? "Member",
        role,
        lastAt: last?.createdAt ?? r.createdAt,
        lastText: !last ? null : last.kind === "contact_share" ? "Sent contact details" : (cannedText(last.templateKey ?? "") ?? null),
        lastMine: last?.senderId === viewerId,
      };
    })
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}
