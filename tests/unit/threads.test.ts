import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { conversations, items, memberships, messages, userContacts, users } from "@/db/schema";
import type { OutgoingEmail } from "@/server/email/transport";
import { approveLoan, markPickedUp, requestLoan } from "@/server/loans/service";
import {
  MESSAGES_PER_HOUR,
  getThread,
  listThreads,
  openThread,
  sendCannedMessage,
  sendContactDetail,
  stageFromLoan,
} from "@/server/threads/service";
import { hours, join, makeCommunity, makeUser, resetDb, scenario } from "../support/factories";

const quiet = { notify: async () => {} };
let sent: OutgoingEmail[] = [];
const deps = { send: async (e: OutgoingEmail) => void sent.push(e) };

beforeEach(async () => {
  await resetDb();
  sent = [];
});
afterAll(() => pool.end());

describe("S10: threads and canned messages", () => {
  it("opens one thread per asker per item, before any request (D12)", async () => {
    const s = await scenario();
    const first = await openThread(s.borrower.id, s.item.id);
    const again = await openThread(s.borrower.id, s.item.id);
    expect(again.id).toBe(first.id);
    expect(first).toMatchObject({ askerId: s.borrower.id, ownerId: s.owner.id, itemId: s.item.id });
    const other = await openThread(s.other.id, s.item.id);
    expect(other.id).not.toBe(first.id);
    expect(await db.select().from(conversations)).toHaveLength(2);
  });

  it("refuses your own item, paused items and other groups", async () => {
    const s = await scenario();
    await expect(openThread(s.owner.id, s.item.id)).rejects.toMatchObject({ code: "invalid_input" });
    await db.update(items).set({ status: "paused" }).where(eq(items.id, s.item.id));
    await expect(openThread(s.borrower.id, s.item.id)).rejects.toMatchObject({ code: "not_found" });
    await db.update(items).set({ status: "available" }).where(eq(items.id, s.item.id));
    const g = await makeCommunity();
    const outsider = await makeUser();
    await join(outsider.id, g.id);
    await expect(openThread(outsider.id, s.item.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("sends canned messages, emails the other person with the words, and never takes free text", async () => {
    const s = await scenario();
    const t = await openThread(s.borrower.id, s.item.id);
    await sendCannedMessage(s.borrower.id, t.id, "ask.condition", deps);
    expect(sent[0]).toMatchObject({ to: s.owner.email, template: "thread.message" });
    expect(sent[0]!.text).toContain("What condition is it in?");
    expect(sent[0]!.text).toContain(`/threads/${t.id}`);
    await sendCannedMessage(s.owner.id, t.id, "answer.complete", deps);
    await expect(sendCannedMessage(s.borrower.id, t.id, "Hi, can I come at 5?", deps)).rejects.toMatchObject({ code: "invalid_input" });
    const view = await getThread(s.owner.id, t.id);
    expect(view.messages.map((m) => [m.mine, m.text])).toEqual([
      [false, "What condition is it in?"],
      [true, "It comes with everything shown in the photos."],
    ]);
  });

  it("filters the tree by role and loan stage (D24)", async () => {
    const s = await scenario();
    const t = await openThread(s.borrower.id, s.item.id);
    expect((await getThread(s.borrower.id, t.id)).categories.map((c) => c.key)).toEqual(["ask", "courtesy"]);
    expect((await getThread(s.owner.id, t.id)).categories.map((c) => c.key)).toEqual(["answer", "courtesy"]);
    await expect(sendCannedMessage(s.borrower.id, t.id, "answer.available", deps)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(sendCannedMessage(s.borrower.id, t.id, "return.on_way", deps)).rejects.toMatchObject({ code: "invalid_input" });

    const loan = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(1), endAt: hours(5) }, quiet);
    await approveLoan(s.owner.id, loan.id, quiet);
    expect((await getThread(s.borrower.id, t.id)).stage).toBe("approved");
    await sendCannedMessage(s.borrower.id, t.id, "pickup.evenings", deps);
    await sendContactDetailFor(s.owner.id, t.id);
    await markPickedUp(s.owner.id, loan.id, quiet);
    const after = await getThread(s.borrower.id, t.id);
    expect(after.stage).toBe("picked_up");
    expect(after.categories.map((c) => c.key)).toEqual(["return", "courtesy"]);
    await sendCannedMessage(s.borrower.id, t.id, "return.on_way", deps);
  });

  it("maps every loan status to a stage", () => {
    expect(stageFromLoan(null)).toBe("before_pickup");
    expect(stageFromLoan("requested")).toBe("before_pickup");
    expect(stageFromLoan("approved")).toBe("approved");
    expect(stageFromLoan("active")).toBe("picked_up");
    expect(stageFromLoan("returned")).toBe("picked_up");
    for (const st of ["closed", "declined", "cancelled"] as const) expect(stageFromLoan(st)).toBe("closed");
  });

  it("is readable only by the two people in it, and lists newest first", async () => {
    const s = await scenario();
    const t = await openThread(s.borrower.id, s.item.id);
    await expect(getThread(s.other.id, t.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(getThread(s.admin.id, t.id)).rejects.toMatchObject({ code: "not_found" });
    await sendCannedMessage(s.borrower.id, t.id, "ask.tips", deps);
    const [summary] = await listThreads(s.owner.id);
    expect(summary).toMatchObject({ id: t.id, role: "owner", otherName: "Ben Borrower", lastText: "Any tips for using it?", lastMine: false });
  });

  it("rate-limits messages", async () => {
    const s = await scenario();
    const t = await openThread(s.borrower.id, s.item.id);
    const now = new Date();
    await db.insert(messages).values(
      Array.from({ length: MESSAGES_PER_HOUR }, () => ({ conversationId: t.id, senderId: s.borrower.id, kind: "canned" as const, templateKey: "courtesy.thanks", createdAt: now })),
    );
    await expect(sendCannedMessage(s.borrower.id, t.id, "ask.tips", deps)).rejects.toMatchObject({ code: "conflict" });
  });

  it("closes the thread for writing once the other member is removed", async () => {
    const s = await scenario();
    const t = await openThread(s.borrower.id, s.item.id);
    await db.update(users).set({ status: "removed" }).where(eq(users.id, s.owner.id));
    await db.update(memberships).set({ removedAt: new Date() }).where(eq(memberships.userId, s.owner.id));
    const view = await getThread(s.borrower.id, t.id);
    expect(view).toMatchObject({ canWrite: false, categories: [] });
    await expect(sendCannedMessage(s.borrower.id, t.id, "ask.tips", deps)).rejects.toMatchObject({ code: "invalid_state" });
  });
});

async function sendContactDetailFor(userId: string, threadId: string) {
  await db.insert(userContacts).values({ userId, type: "phone", value: "555-010-0100" });
  return sendContactDetail(userId, threadId, "phone", deps);
}

describe("S11: send a saved contact detail", () => {
  it("copies the value into the thread; both see it, only the recipient sees the note", async () => {
    const s = await scenario();
    const t = await openThread(s.borrower.id, s.item.id);
    sent = [];
    const share = await sendContactDetailFor(s.owner.id, t.id);
    expect(share).toMatchObject({ contactType: "phone", valueShared: "555-010-0100", senderId: s.owner.id });

    const ownerView = await getThread(s.owner.id, t.id);
    const borrowerView = await getThread(s.borrower.id, t.id);
    expect(ownerView.messages.at(-1)).toMatchObject({ text: "Here's my contact info: 555-010-0100", recipientNote: null, mine: true });
    expect(borrowerView.messages.at(-1)).toMatchObject({
      text: "Here's my contact info: 555-010-0100",
      recipientNote: "Only contact this person if you are ready to give them your contact details.",
    });
    expect(borrowerView.hasContactShare).toBe(true);

    // The email carries the note and a link, never the value (CLAUDE.md, D13).
    expect(sent[0]).toMatchObject({ to: s.borrower.email, template: "thread.contact_share" });
    expect(sent[0]!.text).toContain("Only contact this person if you are ready to give them your contact details.");
    expect(sent[0]!.text).not.toContain("555-010-0100");
    expect((await listThreads(s.borrower.id))[0]!.lastText).toBe("Sent contact details");
  });

  it("needs a saved detail of that type, and works at any stage", async () => {
    const s = await scenario();
    const t = await openThread(s.borrower.id, s.item.id);
    await expect(sendContactDetail(s.borrower.id, t.id, "email", deps)).rejects.toMatchObject({ code: "invalid_input" });
    await db.insert(userContacts).values({ userId: s.borrower.id, type: "email", value: "ben.contact@example.test" });
    await expect(sendContactDetail(s.borrower.id, t.id, "email", deps)).resolves.toMatchObject({ valueShared: "ben.contact@example.test" });
    expect((await getThread(s.borrower.id, t.id)).savedContactTypes).toEqual(["email"]);
  });

  it("can't be sent into someone else's thread", async () => {
    const s = await scenario();
    const t = await openThread(s.borrower.id, s.item.id);
    await db.insert(userContacts).values({ userId: s.other.id, type: "phone", value: "555-010-0199" });
    await expect(sendContactDetail(s.other.id, t.id, "phone", deps)).rejects.toMatchObject({ code: "not_found" });
  });
});
