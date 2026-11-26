"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { DomainError } from "@/server/errors";
import { openThread, sendCannedMessage, sendContactDetail } from "@/server/threads/service";

/** Result codes for the thread page's flash message (codes only: nothing personal in URLs). */
export type ThreadResult = "sent" | "shared" | "not_allowed" | "no_contact" | "closed" | "slow_down" | "failed";

function codeFor(e: DomainError): ThreadResult {
  if (e.code === "invalid_state") return "closed";
  if (e.code === "conflict") return "slow_down";
  if (e.message.includes("haven't saved")) return "no_contact";
  if (e.code === "invalid_input") return "not_allowed";
  return "failed";
}

export async function askOwnerAction(formData: FormData) {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const itemId = String(formData.get("itemId") ?? "");
  let threadId: string;
  try {
    threadId = (await openThread(user.id, itemId)).id;
  } catch (e) {
    if (e instanceof DomainError) redirect(`/items/${itemId}`);
    throw e;
  }
  redirect(`/threads/${threadId}`);
}

export async function sendMessageAction(formData: FormData) {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const threadId = String(formData.get("threadId") ?? "");
  const templateKey = String(formData.get("templateKey") ?? "");
  let result: ThreadResult = "sent";
  try {
    await sendCannedMessage(user.id, threadId, templateKey);
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    if (e.code === "not_found") redirect("/threads");
    result = codeFor(e);
  }
  revalidatePath(`/threads/${threadId}`);
  redirect(`/threads/${threadId}?result=${result}#latest`);
}

export async function shareContactAction(formData: FormData) {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const threadId = String(formData.get("threadId") ?? "");
  const type = String(formData.get("contactType") ?? "");
  let result: ThreadResult = "shared";
  try {
    if (type !== "phone" && type !== "email") throw new DomainError("invalid_input", "Unknown contact type.");
    await sendContactDetail(user.id, threadId, type);
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    if (e.code === "not_found") redirect("/threads");
    result = codeFor(e);
  }
  revalidatePath(`/threads/${threadId}`);
  redirect(`/threads/${threadId}?result=${result}#latest`);
}
