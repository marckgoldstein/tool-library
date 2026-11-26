/**
 * Email transports (T5). Every send is written to email_log first, so a failed
 * send can be found and retried by hand (D29: no job queue).
 *
 * - "dev": nothing leaves the machine. The body is kept in email_log and shown
 *   at /dev/mailbox, which is how local sign-in and the browser tests read links.
 * - "resend": production, added when hosting is chosen (T1/T5). Not wired yet.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { emailLog } from "@/db/schema";

export interface OutgoingEmail {
  to: string;
  toUserId?: string | null;
  template: string;
  relatedId?: string | null;
  subject: string;
  text: string;
}

export type EmailTransportName = "dev" | "resend";

export function currentTransport(): EmailTransportName {
  const value = process.env.EMAIL_TRANSPORT ?? "dev";
  if (value !== "dev" && value !== "resend") throw new Error(`Unknown EMAIL_TRANSPORT: ${value}`);
  return value;
}

export async function sendEmail(email: OutgoingEmail): Promise<{ id: string }> {
  const transport = currentTransport();
  const [row] = await db
    .insert(emailLog)
    .values({
      toEmail: email.to.toLowerCase(),
      toUserId: email.toUserId ?? null,
      template: email.template,
      relatedId: email.relatedId ?? null,
      subject: email.subject,
      body: transport === "dev" ? email.text : null,
      status: "queued",
    })
    .returning({ id: emailLog.id });
  if (!row) throw new Error("Could not log email");

  try {
    if (transport === "resend") {
      throw new Error("Resend transport is not configured yet (pending hosting decision, T1).");
    }
    await db.update(emailLog).set({ status: "sent", sentAt: new Date() }).where(eq(emailLog.id, row.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(emailLog).set({ status: "failed", error: message }).where(eq(emailLog.id, row.id));
    throw error;
  }
  return row;
}
