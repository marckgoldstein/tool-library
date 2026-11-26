import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { categories, itemPhotos, memberships } from "@/db/schema";
import { createItem, getItem, searchItems, setItemStatus, updateItem } from "@/server/items/service";
import { approveLoan, confirmReturn, markPickedUp, markReturned, requestLoan } from "@/server/loans/service";
import { conversationFor, hours, join, makeCommunity, makeUser, resetDb, scenario, shareContact } from "../support/factories";

const quiet = { notify: async () => {} };

beforeEach(() => resetDb());
afterAll(() => pool.end());

async function tree() {
  const [tools] = await db.insert(categories).values({ name: "Power tools" }).returning();
  const [saws] = await db.insert(categories).values({ name: "Saws", parentId: tools!.id }).returning();
  const [camping] = await db.insert(categories).values({ name: "Camping and outdoors" }).returning();
  return { tools: tools!, saws: saws!, camping: camping! };
}

const fields = (categoryId: string, over: Partial<{ title: string; description: string }> = {}) => ({
  title: over.title ?? "Circular saw",
  categoryId,
  description: over.description ?? "7-1/4 inch blade, with case and spare blade.",
  condition: "Good",
  handoffNotes: "Weekday evenings",
});

describe("S7: list an item", () => {
  it("saves the item with its photos in order and makes it searchable at once", async () => {
    const s = await scenario();
    const c = await tree();
    const item = await createItem(s.owner.id, { ...fields(c.saws.id), photoKeys: ["items/a.webp", "items/b.webp"] });
    expect(item).toMatchObject({ status: "available", ownerId: s.owner.id, communityId: s.community.id, handoffNotes: "Weekday evenings" });
    const photos = await db.select().from(itemPhotos).where(eq(itemPhotos.itemId, item.id)).orderBy(itemPhotos.sortOrder);
    expect(photos.map((p) => p.storageKey)).toEqual(["items/a.webp", "items/b.webp"]);
    const found = await searchItems(s.borrower.id, { q: "circular" });
    expect(found.map((r) => r.id)).toContain(item.id);
  });

  it("requires a photo, a title, a description, a known condition and category", async () => {
    const s = await scenario();
    const c = await tree();
    await expect(createItem(s.owner.id, { ...fields(c.saws.id), photoKeys: [] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(createItem(s.owner.id, { ...fields(c.saws.id, { title: " " }), photoKeys: ["k.webp"] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(createItem(s.owner.id, { ...fields(c.saws.id, { description: "" }), photoKeys: ["k.webp"] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(createItem(s.owner.id, { ...fields(c.saws.id), condition: "Mint", photoKeys: ["k.webp"] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(createItem(s.owner.id, { ...fields("nope"), photoKeys: ["k.webp"] })).rejects.toMatchObject({ code: "invalid_input" });
    const outsider = await makeUser();
    await expect(createItem(outsider.id, { ...fields(c.saws.id), photoKeys: ["k.webp"] })).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("S8: edit, pause, delist", () => {
  it("pause hides it from search, resume brings it back, delist removes it for good", async () => {
    const s = await scenario();
    const c = await tree();
    const item = await createItem(s.owner.id, { ...fields(c.saws.id), photoKeys: ["a.webp"] });
    await setItemStatus(s.owner.id, item.id, "pause");
    expect((await searchItems(s.borrower.id, {})).map((r) => r.id)).not.toContain(item.id);
    await expect(getItem(s.borrower.id, item.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await getItem(s.owner.id, item.id)).status).toBe("paused"); // the owner still sees it
    await setItemStatus(s.owner.id, item.id, "resume");
    expect((await searchItems(s.borrower.id, {})).map((r) => r.id)).toContain(item.id);
    await setItemStatus(s.owner.id, item.id, "delist");
    await expect(setItemStatus(s.owner.id, item.id, "resume")).rejects.toMatchObject({ code: "invalid_state" });
    await expect(setItemStatus(s.borrower.id, s.item.id, "pause")).rejects.toMatchObject({ code: "not_found" }); // not theirs
  });

  it("edits fields and photos, keeping at least one photo", async () => {
    const s = await scenario();
    const c = await tree();
    const item = await createItem(s.owner.id, { ...fields(c.saws.id), photoKeys: ["a.webp"] });
    const [photo] = await db.select().from(itemPhotos).where(eq(itemPhotos.itemId, item.id));
    await expect(updateItem(s.owner.id, item.id, { ...fields(c.saws.id), addPhotoKeys: [], removePhotoIds: [photo!.id] })).rejects.toMatchObject({ code: "invalid_input" });
    const updated = await updateItem(s.owner.id, item.id, { ...fields(c.saws.id, { title: "Worm-drive saw" }), addPhotoKeys: ["b.webp"], removePhotoIds: [photo!.id] });
    expect(updated.title).toBe("Worm-drive saw");
    const photos = await db.select().from(itemPhotos).where(eq(itemPhotos.itemId, item.id));
    expect(photos.map((p) => p.storageKey)).toEqual(["b.webp"]);
  });

  it("all three are blocked while a loan locks the listing (D23), and allowed once it closes", async () => {
    const s = await scenario();
    const loan = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(1), endAt: hours(5) }, quiet);
    await approveLoan(s.owner.id, loan.id, quiet);
    const c = await tree();
    await expect(setItemStatus(s.owner.id, s.item.id, "pause")).rejects.toMatchObject({ code: "listing_locked" });
    await expect(setItemStatus(s.owner.id, s.item.id, "delist")).rejects.toMatchObject({ code: "listing_locked" });
    await expect(updateItem(s.owner.id, s.item.id, { ...fields(c.saws.id), addPhotoKeys: ["x.webp"], removePhotoIds: [] })).rejects.toMatchObject({ code: "listing_locked" });

    await shareContact((await conversationFor(s.item.id, s.borrower.id)).id, s.owner.id);
    await markPickedUp(s.owner.id, loan.id, quiet);
    await markReturned(s.borrower.id, loan.id, quiet);
    await confirmReturn(s.owner.id, loan.id, "fine", null, quiet);
    await expect(setItemStatus(s.owner.id, s.item.id, "pause")).resolves.toMatchObject({ status: "paused" });
  });
});

describe("S9: search", () => {
  it("matches keywords in title, description and category, ranks title hits first", async () => {
    const s = await scenario();
    const c = await tree();
    const saw = await createItem(s.owner.id, { ...fields(c.saws.id, { title: "Tile saw", description: "Wet cutting for ceramic." }), photoKeys: ["a.webp"] });
    const tent = await createItem(s.other.id, { ...fields(c.camping.id, { title: "4-person tent", description: "Rain fly included; easy to set up with a saw-tooth pole." }), photoKeys: ["b.webp"] });
    const sawHits = await searchItems(s.borrower.id, { q: "saw" });
    expect(sawHits[0]!.id).toBe(saw.id);
    expect((await searchItems(s.borrower.id, { q: "ceramic" })).map((r) => r.id)).toEqual([saw.id]);
    expect((await searchItems(s.borrower.id, { q: "camping" })).map((r) => r.id)).toEqual([tent.id]); // category name
    expect(await searchItems(s.borrower.id, { q: "kayak" })).toEqual([]);
  });

  it("filters by category, a top-level category including its children", async () => {
    const s = await scenario();
    const c = await tree();
    const saw = await createItem(s.owner.id, { ...fields(c.saws.id), photoKeys: ["a.webp"] });
    await createItem(s.owner.id, { ...fields(c.camping.id, { title: "Cooler" }), photoKeys: ["b.webp"] });
    expect((await searchItems(s.borrower.id, { categoryId: c.tools.id })).map((r) => r.id)).toEqual([saw.id]);
    expect((await searchItems(s.borrower.id, { categoryId: c.saws.id })).map((r) => r.id)).toEqual([saw.id]);
  });

  it("shows the owner's general area, marks items on loan, and hides other groups and removed owners", async () => {
    const s = await scenario();
    const loan = await requestLoan({ borrowerId: s.borrower.id, itemId: s.item.id, startAt: hours(1), endAt: hours(5) }, quiet);
    await approveLoan(s.owner.id, loan.id, quiet);
    await shareContact((await conversationFor(s.item.id, s.borrower.id)).id, s.owner.id);
    await markPickedUp(s.owner.id, loan.id, quiet);
    const [hit] = await searchItems(s.other.id, {});
    expect(hit).toMatchObject({ id: s.item.id, status: "on_loan" }); // unavailable: marked, not hidden

    const otherGroup = await makeCommunity();
    const outsider = await makeUser();
    await join(outsider.id, otherGroup.id);
    expect(await searchItems(outsider.id, {})).toEqual([]);
    await expect(getItem(outsider.id, s.item.id)).rejects.toMatchObject({ code: "not_found" });

    await db.update(memberships).set({ removedAt: new Date() }).where(eq(memberships.userId, s.owner.id));
    expect(await searchItems(s.other.id, {})).toEqual([]);
  });
});
