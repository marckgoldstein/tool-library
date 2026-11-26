"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { DomainError } from "@/server/errors";
import { saveContacts, updateProfile } from "@/server/profiles/service";
import { PhotoError, processPhoto, savePhoto } from "@/server/storage/photos";

export interface FormState {
  status: "idle" | "saved" | "error";
  message?: string;
  values?: Record<string, string>;
}

const SIGNED_OUT: FormState = { status: "error", message: "Your session ended. Sign in again, then save." };

export async function saveProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!user) return SIGNED_OUT;
  const values = {
    displayName: String(formData.get("displayName") ?? ""),
    generalArea: String(formData.get("generalArea") ?? ""),
  };
  try {
    let photoKey: string | undefined;
    const photo = formData.get("photo");
    if (photo instanceof File && photo.size > 0) {
      photoKey = await savePhoto(await processPhoto(Buffer.from(await photo.arrayBuffer()), photo.type), "profiles");
    }
    await updateProfile(user.id, { ...values, photoKey, removePhoto: formData.get("removePhoto") === "yes" });
  } catch (e) {
    if (e instanceof DomainError || e instanceof PhotoError) return { status: "error", message: e.message, values };
    throw e;
  }
  revalidatePath("/", "layout");
  return { status: "saved", message: "Profile saved." };
}

export async function saveContactsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!user) return SIGNED_OUT;
  const values = { phone: String(formData.get("phone") ?? ""), email: String(formData.get("contactEmail") ?? "") };
  try {
    await saveContacts(user.id, values);
  } catch (e) {
    if (e instanceof DomainError) return { status: "error", message: e.message, values: { phone: values.phone, contactEmail: values.email } };
    throw e;
  }
  revalidatePath("/profile");
  return { status: "saved", message: "Contact details saved. Nobody sees them until you choose to send one." };
}
