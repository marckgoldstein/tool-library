/**
 * Items (M3: S7 list, S8 edit/pause/delist, S9 search).
 *
 * - Every query is scoped to the member's group (CLAUDE.md).
 * - Status changes lock the item row, like the loan service, and are refused
 *   while a loan locks the listing (D23). "on_loan" is set only by the loan service.
 * - Search (S9) uses item.search_vector (title A, description B, GIN index)
 *   plus the category names. Paused, delisted and removed members' items are
 *   hidden; items out on loan are shown and marked.
 */
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type Tx } from "@/db";
import { categories, itemPhotos, items, memberships, users } from "@/db/schema";
import { DomainError, forbidden, notFound } from "../errors";
import { isListingLocked } from "../loans/service";

export const TITLE_MAX = 80;
export const DESCRIPTION_MAX = 2000;
export const HANDOFF_MAX = 500;
export const MAX_PHOTOS = 6;
export const CONDITIONS = ["Like new", "Good", "Fair", "Well used"] as const;

type Item = typeof items.$inferSelect;

// ---------- membership ----------

async function memberGroup(userId: string, tx: Tx | typeof db = db) {
  const [row] = await tx
    .select({ communityId: memberships.communityId })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.userId, userId), isNull(memberships.removedAt), eq(users.status, "active")));
  if (!row) throw forbidden("Only members of the group can do that.");
  return row.communityId;
}

// ---------- categories ----------

export async function listCategories() {
  const rows = await db.select().from(categories).orderBy(asc(categories.name));
  const top = rows.filter((c) => !c.parentId);
  return top.map((t) => ({ id: t.id, name: t.name, children: rows.filter((c) => c.parentId === t.id).map((c) => ({ id: c.id, name: c.name })) }));
}

// ---------- validation ----------

export interface ItemFields {
  title: string;
  categoryId: string;
  description: string;
  condition: string;
  handoffNotes: string;
}

function clean(text: string) {
  return text.trim().replace(/[ \t]+/g, " ");
}

async function validateFields(input: ItemFields, tx: Tx | typeof db) {
  const title = clean(input.title);
  if (!title) throw new DomainError("invalid_input", "Give the item a title, like “Cordless drill”.");
  if (title.length > TITLE_MAX) throw new DomainError("invalid_input", `Keep the title to ${TITLE_MAX} characters or fewer.`);
  const description = input.description.trim();
  if (!description) throw new DomainError("invalid_input", "Describe the item: what it is and what comes with it.");
  if (description.length > DESCRIPTION_MAX) throw new DomainError("invalid_input", `Keep the description under ${DESCRIPTION_MAX.toLocaleString("en-US")} characters.`);
  if (!(CONDITIONS as readonly string[]).includes(input.condition)) throw new DomainError("invalid_input", "Choose the item's condition.");
  const handoffNotes = input.handoffNotes.trim();
  if (handoffNotes.length > HANDOFF_MAX) throw new DomainError("invalid_input", `Keep handoff notes under ${HANDOFF_MAX} characters.`);
  const [category] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, input.categoryId));
  if (!category) throw new DomainError("invalid_input", "Choose a category.");
  return { title, description, condition: input.condition, handoffNotes: handoffNotes || null, categoryId: category.id };
}

// ---------- S7: list an item ----------

export async function createItem(ownerId: string, input: ItemFields & { photoKeys: string[] }): Promise<Item> {
  if (input.photoKeys.length === 0) throw new DomainError("invalid_input", "Add at least one photo of the item.");
  if (input.photoKeys.length > MAX_PHOTOS) throw new DomainError("invalid_input", `Add up to ${MAX_PHOTOS} photos.`);
  return db.transaction(async (tx) => {
    const communityId = await memberGroup(ownerId, tx);
    const fields = await validateFields(input, tx);
    const [item] = await tx.insert(items).values({ ...fields, ownerId, communityId, status: "available" }).returning();
    await tx.insert(itemPhotos).values(input.photoKeys.map((storageKey, sortOrder) => ({ itemId: item!.id, storageKey, sortOrder })));
    return item!;
  });
}

// ---------- S8: edit, pause, delist ----------

async function lockOwnItem(tx: Tx, ownerId: string, itemId: string) {
  const [item] = await tx.select().from(items).where(eq(items.id, itemId)).for("update");
  if (!item || item.ownerId !== ownerId) throw notFound("Item");
  if (item.status === "delisted") throw new DomainError("invalid_state", "This item is delisted.");
  if (await isListingLocked(item.id, tx)) {
    throw new DomainError("listing_locked", "This item has an approved or active loan, so it can't be changed until the loan closes.");
  }
  return item;
}

export async function updateItem(
  ownerId: string,
  itemId: string,
  input: ItemFields & { addPhotoKeys: string[]; removePhotoIds: string[] },
): Promise<Item> {
  return db.transaction(async (tx) => {
    const item = await lockOwnItem(tx, ownerId, itemId);
    const fields = await validateFields(input, tx);
    const current = await tx.select().from(itemPhotos).where(eq(itemPhotos.itemId, item.id)).orderBy(asc(itemPhotos.sortOrder));
    const remove = new Set(input.removePhotoIds.filter((id) => current.some((p) => p.id === id)));
    const remaining = current.length - remove.size + input.addPhotoKeys.length;
    if (remaining < 1) throw new DomainError("invalid_input", "Keep at least one photo of the item.");
    if (remaining > MAX_PHOTOS) throw new DomainError("invalid_input", `An item can have up to ${MAX_PHOTOS} photos.`);
    if (remove.size > 0) await tx.delete(itemPhotos).where(inArray(itemPhotos.id, [...remove]));
    const nextOrder = Math.max(-1, ...current.map((p) => p.sortOrder)) + 1;
    if (input.addPhotoKeys.length > 0) {
      await tx.insert(itemPhotos).values(input.addPhotoKeys.map((storageKey, i) => ({ itemId: item.id, storageKey, sortOrder: nextOrder + i })));
    }
    const [updated] = await tx.update(items).set(fields).where(eq(items.id, item.id)).returning();
    return updated!;
  });
}

export type OwnerStatusAction = "pause" | "resume" | "delist";

export async function setItemStatus(ownerId: string, itemId: string, action: OwnerStatusAction): Promise<Item> {
  return db.transaction(async (tx) => {
    const item = await lockOwnItem(tx, ownerId, itemId);
    const to = action === "pause" ? "paused" : action === "resume" ? "available" : "delisted";
    const allowed: Record<OwnerStatusAction, Item["status"][]> = {
      pause: ["available"],
      resume: ["paused"],
      delist: ["available", "paused"],
    };
    if (!allowed[action].includes(item.status)) {
      throw new DomainError("invalid_state", `This item is ${item.status.replace("_", " ")}; that isn't available.`);
    }
    const [updated] = await tx.update(items).set({ status: to }).where(eq(items.id, item.id)).returning();
    return updated!;
  });
}

// ---------- reading ----------

const owner = alias(users, "owner");
const ownerMembership = alias(memberships, "owner_membership");
const parentCategory = alias(categories, "parent_category");

export interface ItemView {
  id: string;
  title: string;
  description: string;
  condition: string;
  handoffNotes: string | null;
  status: Item["status"];
  categoryId: string;
  categoryName: string;
  parentCategoryName: string | null;
  owner: { id: string; name: string; generalArea: string | null };
  photos: { id: string; storageKey: string }[];
  isOwner: boolean;
  locked: boolean;
}

/** An item as a group member sees it. Paused items show only to their owner; delisted ones to nobody but the owner. */
export async function getItem(viewerId: string, itemId: string): Promise<ItemView> {
  const communityId = await memberGroup(viewerId).catch(() => {
    throw notFound("Item");
  });
  const [row] = await db
    .select({
      item: items,
      categoryName: categories.name,
      parentCategoryName: parentCategory.name,
      ownerName: owner.name,
      ownerArea: owner.generalArea,
      ownerStatus: owner.status,
      ownerRemovedAt: ownerMembership.removedAt,
    })
    .from(items)
    .innerJoin(categories, eq(categories.id, items.categoryId))
    .leftJoin(parentCategory, eq(parentCategory.id, categories.parentId))
    .innerJoin(owner, eq(owner.id, items.ownerId))
    .innerJoin(ownerMembership, and(eq(ownerMembership.userId, items.ownerId), eq(ownerMembership.communityId, items.communityId)))
    .where(and(eq(items.id, itemId), eq(items.communityId, communityId)));
  if (!row) throw notFound("Item");
  const isOwner = row.item.ownerId === viewerId;
  const ownerActive = row.ownerStatus === "active" && !row.ownerRemovedAt;
  if (!isOwner && (!ownerActive || row.item.status === "paused" || row.item.status === "delisted")) throw notFound("Item");
  const photos = await db
    .select({ id: itemPhotos.id, storageKey: itemPhotos.storageKey })
    .from(itemPhotos)
    .where(eq(itemPhotos.itemId, itemId))
    .orderBy(asc(itemPhotos.sortOrder));
  const { item } = row;
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    condition: item.condition,
    handoffNotes: item.handoffNotes,
    status: item.status,
    categoryId: item.categoryId,
    categoryName: row.categoryName,
    parentCategoryName: row.parentCategoryName,
    owner: { id: item.ownerId, name: row.ownerName ?? "Member", generalArea: row.ownerArea },
    photos,
    isOwner,
    locked: isOwner ? await isListingLocked(item.id) : false,
  };
}

export interface SearchResult {
  id: string;
  title: string;
  categoryName: string;
  status: Item["status"];
  ownerId: string;
  ownerName: string;
  ownerArea: string | null;
  photoKey: string | null;
  isOwn: boolean;
}

/** S9: keyword and category search within the member's group. */
export async function searchItems(viewerId: string, query: { q?: string; categoryId?: string }): Promise<SearchResult[]> {
  const communityId = await memberGroup(viewerId);
  const q = query.q?.trim().slice(0, 200) ?? "";
  const tsq = sql`websearch_to_tsquery('english', ${q})`;
  const categoryText = sql`to_tsvector('english', ${categories.name} || ' ' || coalesce(${parentCategory.name}, ''))`;
  const conditions = [
    eq(items.communityId, communityId),
    inArray(items.status, ["available", "on_loan"]),
    eq(owner.status, "active"),
    isNull(ownerMembership.removedAt),
  ];
  if (q) conditions.push(sql`(${items.searchVector} @@ ${tsq} or ${categoryText} @@ ${tsq})`);
  if (query.categoryId) {
    conditions.push(or(eq(items.categoryId, query.categoryId), eq(categories.parentId, query.categoryId))!);
  }
  const firstPhoto = sql<string | null>`(select ${itemPhotos.storageKey} from ${itemPhotos} where ${itemPhotos.itemId} = ${items.id} order by ${itemPhotos.sortOrder} limit 1)`;
  const rows = await db
    .select({
      id: items.id,
      title: items.title,
      categoryName: categories.name,
      status: items.status,
      ownerId: items.ownerId,
      ownerName: owner.name,
      ownerArea: owner.generalArea,
      photoKey: firstPhoto,
    })
    .from(items)
    .innerJoin(categories, eq(categories.id, items.categoryId))
    .leftJoin(parentCategory, eq(parentCategory.id, categories.parentId))
    .innerJoin(owner, eq(owner.id, items.ownerId))
    .innerJoin(ownerMembership, and(eq(ownerMembership.userId, items.ownerId), eq(ownerMembership.communityId, items.communityId)))
    .where(and(...conditions))
    .orderBy(...(q ? [desc(sql`ts_rank(${items.searchVector}, ${tsq})`)] : []), desc(items.createdAt))
    .limit(60);
  return rows.map((r) => ({ ...r, ownerName: r.ownerName ?? "Member", isOwn: r.ownerId === viewerId }));
}

/** The owner's own items, every status but delisted. */
export async function listOwnItems(ownerId: string) {
  return db
    .select({
      id: items.id,
      title: items.title,
      status: items.status,
      categoryName: categories.name,
      photoKey: sql<string | null>`(select ${itemPhotos.storageKey} from ${itemPhotos} where ${itemPhotos.itemId} = ${items.id} order by ${itemPhotos.sortOrder} limit 1)`,
    })
    .from(items)
    .innerJoin(categories, eq(categories.id, items.categoryId))
    .where(and(eq(items.ownerId, ownerId), ne(items.status, "delisted")))
    .orderBy(desc(items.updatedAt));
}
