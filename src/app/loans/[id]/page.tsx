import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { items, loanEvents, loans, users } from "@/db/schema";
import { displayStatus } from "@/server/loans/rules";
import { reasonText } from "@/content/canned-messages";

export const metadata: Metadata = { title: "Loan" };
export const dynamic = "force-dynamic";

const PILOT_TIMEZONE = "America/New_York"; // R7 default until the member's own zone is captured

const STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  approved: "Approved",
  active: "Picked up",
  overdue: "Overdue",
  returned: "Returned, waiting for the owner",
  closed: "Closed",
  declined: "Declined",
  cancelled: "Cancelled",
};

/** Read-only loan view, linked from every loan email. Actions arrive with the loan-loop UI (M5). */
export default async function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");
  const { id } = await params;

  const [row] = await db
    .select({ loan: loans, itemTitle: items.title })
    .from(loans)
    .innerJoin(items, eq(items.id, loans.itemId))
    .where(eq(loans.id, id));
  const isParty = row && (row.loan.borrowerId === session.user.id || row.loan.ownerId === session.user.id);
  // Not found and not allowed look the same, so loan ids can't be probed.
  if (!row || (!isParty && session.user.role !== "admin")) notFound();

  const [viewer] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, session.user.id));
  const timeZone = viewer?.timezone ?? PILOT_TIMEZONE;
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone });
  const events = await db.select().from(loanEvents).where(eq(loanEvents.loanId, id)).orderBy(asc(loanEvents.createdAt));

  const { loan } = row;
  const status = displayStatus(loan);
  const role = loan.ownerId === session.user.id ? "You're lending this" : "You're borrowing this";

  return (
    <>
      <h1>{row.itemTitle}</h1>
      <p>
        <span className="status" data-status={status} data-testid="loan-status">
          {STATUS_LABEL[status]}
        </span>{" "}
        · {isParty ? role : "Admin view"}
      </p>
      <dl className="panel details">
        <dt>From</dt>
        <dd data-testid="loan-start">{fmt.format(loan.startAt)}</dd>
        <dt>Due back</dt>
        <dd data-testid="loan-end">{fmt.format(loan.endAt)}</dd>
        <dt>Times shown in</dt>
        <dd>{timeZone.replaceAll("_", " ")}</dd>
      </dl>
      <h2>History</h2>
      <ol className="timeline">
        {events.map((e) => (
          <li key={e.id}>
            <time dateTime={e.createdAt.toISOString()}>{fmt.format(e.createdAt)}</time>
            <span>
              {STATUS_LABEL[e.toStatus] ?? e.toStatus}
              {e.reasonKey && reasonText(e.reasonKey) ? ` — ${reasonText(e.reasonKey)}` : ""}
              {!e.actorId ? " (automatic)" : ""}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}
