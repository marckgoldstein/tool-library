"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { DomainError } from "@/server/errors";
import { adminDelistItem, createItem, setItemStatus, updateItem, type ItemFields, type OwnerStatusAction } from "@/server/items/service";
import { PhotoError, processPhoto, savePhoto } from "@/server/storage/photos";

/** Photos per submit; the server action body limit (next.config.ts) is sized for this many at 10 MB. */
const PHOTOS_PER_SUBMIT = 4;

export interface ItemFormState {
  status: "idle" | "error";
  message?: string;
  values?: ItemFields;
}

function fieldsFrom(formData: FormData): ItemFields {
  return {
    title: String(formData.get("title") ?? ""),
    categoryId: String(formData.get("categoryId") ?? ""),
    description: String(formData.get("description") ?? ""),
    condition: String(formData.get("condition") ?? ""),
    handoffNotes: String(formData.get("handoffNotes") ?? ""),
  };
}

/** Resize, strip location data (D32) and store each uploaded photo. */
async function storePhotos(formData: FormData): Promise<string[]> {
  const files = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > PHOTOS_PER_SUBMIT) throw new PhotoError(`Add up to ${PHOTOS_PER_SUBMIT} photos at a time.`);
  const keys: string[] = [];
  for (const file of files) keys.push(await savePhoto(await processPhoto(Buffer.from(await file.arrayBuffer()), file.type), "items"));
  return keys;
}

const SIGNED_OUT: ItemFormState = { status: "error", message: "Your session ended. Sign in again, then save." };

export async function createItemAction(_prev: ItemFormState, formData: FormData): Promise<ItemFormState> {
  const user = await requireUser();
  if (!user) return SIGNED_OUT;
  const values = fieldsFrom(formData);
  let id: string;
  try {
    const photoKeys = await storePhotos(formData);
    id = (await createItem(user.id, { ...values, photoKeys })).id;
  } catch (e) {
    if (e instanceof DomainError || e instanceof PhotoError) return { status: "error", message: e.message, values };
    throw e;
  }
  revalidatePath("/items");
  redirect(`/items/${id}?result=listed`);
}

export async function updateItemAction(itemId: string, _prev: ItemFormState, formData: FormData): Promise<ItemFormState> {
  const user = await requireUser();
  if (!user) return SIGNED_OUT;
  const values = fieldsFrom(formData);
  try {
    const addPhotoKeys = await storePhotos(formData);
    const removePhotoIds = formData.getAll("removePhoto").map(String);
    await updateItem(user.id, itemId, { ...values, addPhotoKeys, removePhotoIds });
  } catch (e) {
    if (e instanceof DomainError || e instanceof PhotoError) return { status: "error", message: e.message, values };
    throw e;
  }
  revalidatePath("/items");
  redirect(`/items/${itemId}?result=saved`);
}

export type ItemResult = "listed" | "saved" | "paused" | "resumed" | "delisted" | "admin_delisted" | "needs_note" | "locked" | "failed";

/** S24: the admin delists any item, with a note emailed to the owner. */
export async function adminDelistAction(formData: FormData) {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const itemId = String(formData.get("itemId") ?? "");
  let result: ItemResult = "admin_delisted";
  try {
    await adminDelistItem(user.id, itemId, String(formData.get("note") ?? ""));
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    result = e.code === "listing_locked" ? "locked" : e.code === "invalid_input" ? "needs_note" : "failed";
  }
  revalidatePath("/items");
  redirect(result === "admin_delisted" ? "/items?result=admin_delisted" : `/items/${itemId}?result=${result}`);
}

export async function itemStatusAction(formData: FormData) {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const itemId = String(formData.get("itemId") ?? "");
  const action = String(formData.get("intent") ?? "") as OwnerStatusAction;
  let result: ItemResult;
  try {
    if (!["pause", "resume", "delist"].includes(action)) throw new DomainError("invalid_input", "Unknown action.");
    await setItemStatus(user.id, itemId, action);
    result = action === "pause" ? "paused" : action === "resume" ? "resumed" : "delisted";
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    result = e.code === "listing_locked" ? "locked" : "failed";
  }
  revalidatePath("/items");
  redirect(result === "delisted" ? `/items/mine?result=delisted` : `/items/${itemId}?result=${result}`);
}
