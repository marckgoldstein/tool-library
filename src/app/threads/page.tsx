import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { activeMembership, cleanTimezone } from "@/server/invitations/service";
import { listThreads } from "@/server/threads/service";

export const metadata: Metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

/** The member's threads, newest activity first (S10). */
export default async function MessagesPage() {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const [threads, me] = await Promise.all([listThreads(user.id), activeMembership(user.id)]);
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: cleanTimezone(me?.timezone) });
  return (
    <>
      <h1>Messages</h1>
      {threads.length === 0 ? (
        <p>
          No messages yet. To ask about something, open it from <Link href="/items">Browse</Link> and use the{" "}
          <strong>Ask … about it</strong> button under the item&apos;s details.
        </p>
      ) : (
        <ul className="rows" data-testid="threads">
          {threads.map((t) => (
            <li key={t.id}>
              <span>
                <Link href={`/threads/${t.id}`}>{t.itemTitle}</Link>{" "}
                <span className="muted">
                  {t.role === "owner" ? "asked by" : "owned by"} {t.otherName}
                </span>
                {t.lastText && (
                  <span className="preview">
                    {t.lastMine ? "You: " : ""}
                    {t.lastText}
                  </span>
                )}
              </span>
              <time className="muted" dateTime={t.lastAt.toISOString()}>
                {fmt.format(t.lastAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
