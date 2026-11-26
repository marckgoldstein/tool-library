import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { emailLog } from "@/db/schema";
import { devMailboxEnabled } from "@/server/email/dev-mailbox";

export const metadata: Metadata = { title: "Local mailbox", robots: { index: false } };
export const dynamic = "force-dynamic";

const linkify = (text: string) =>
  text.split(/(https?:\/\/\S+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part}>
        {part}
      </a>
    ) : (
      part
    ),
  );

export default async function DevMailboxPage() {
  if (!devMailboxEnabled()) notFound();
  const mail = await db.select().from(emailLog).orderBy(desc(emailLog.createdAt)).limit(50);
  return (
    <>
      <h1>Local mailbox</h1>
      <p>Development only. Every email the app would send appears here, newest first.</p>
      {mail.length === 0 && <p>No emails yet.</p>}
      <ul className="mail">
        {mail.map((m) => (
          <li key={m.id} className="panel" data-testid="mail-item">
            <p>
              <strong>To:</strong> {m.toEmail} · <strong>{m.subject}</strong> · {m.status}
            </p>
            <pre>{linkify(m.body ?? "")}</pre>
          </li>
        ))}
      </ul>
    </>
  );
}
