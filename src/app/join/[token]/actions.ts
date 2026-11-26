"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { DomainError } from "@/server/errors";
import { acceptInvitation, validateJoin } from "@/server/invitations/service";
import { PhotoError, processPhoto, savePhoto } from "@/server/storage/photos";

export interface JoinState {
  status: "idle" | "error";
  message?: string;
  values?: { displayName: string; generalArea: string; acceptedNotices: boolean };
}

/** S3: create the member from the invite, then email a sign-in link (sign-in stays magic-link only, D27). */
export async function joinAction(token: string, _prev: JoinState, formData: FormData): Promise<JoinState> {
  const values = {
    displayName: String(formData.get("displayName") ?? ""),
    generalArea: String(formData.get("generalArea") ?? ""),
    acceptedNotices: formData.get("acceptNotices") === "yes",
  };
  const timezone = String(formData.get("timezone") ?? "");
  let email: string;
  try {
    validateJoin({ ...values, timezone }); // check the fields before storing a photo

    let photoKey: string | null = null;
    const photo = formData.get("photo");
    if (photo instanceof File && photo.size > 0) {
      const processed = await processPhoto(Buffer.from(await photo.arrayBuffer()), photo.type);
      photoKey = await savePhoto(processed, "profiles");
    }
    const user = await acceptInvitation(token, { ...values, timezone, photoKey });
    email = user.email;
  } catch (e) {
    if (e instanceof DomainError || e instanceof PhotoError) return { status: "error", message: e.message, values };
    throw e;
  }
  await signIn("email", { email, redirectTo: "/", redirect: false });
  redirect("/sign-in/check-email?joined=1");
}
