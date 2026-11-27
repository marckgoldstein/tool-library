import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { activeMembership, cleanTimezone } from "@/server/invitations/service";
import { listLoans, type LoanSummary } from "@/server/loans/queries";

export const metadata: Metadata = { title: "Loans" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  approved: "Approved",
  active: "Picked up",
  overdue: "Overdue",
  returned: "Returned",
  closed: "Closed",
  declined: "Declined",
  cancelled: "Cancelled",
};

function LoanRow({ loan, fmt }: { loan: LoanSummary; fmt: Intl.DateTimeFormat }) {
  return (
    <li>
      <span className="owned-main">
        <Link href={`/loans/${loan.id}`}>{loan.itemTitle}</Link>
        <span className="muted">
          {loan.role === "owner" ? `Lending to ${loan.otherName}` : `Borrowing from ${loan.otherName}`} ·{" "}
          {fmt.format(loan.startAt)} to {fmt.format(loan.endAt)}
        </span>
        {loan.needsAction && (
          <strong className="todo" data-testid="loan-todo">
            {loan.needsAction}
          </strong>
        )}
      </span>
      <span className="status" data-status={loan.status}>
        {STATUS_LABEL[loan.status]}
      </span>
    </li>
  );
}

/** Every loan the member is part of (M5). Things waiting on them come first: this is the owner's to-do list (S19, D20). */
export default async function LoansPage() {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const [{ open, past }, me] = await Promise.all([listLoans(user.id), activeMembership(user.id)]);
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: cleanTimezone(me?.timezone) });
  const todo = open.filter((l) => l.needsAction);
  const rest = open.filter((l) => !l.needsAction);

  return (
    <>
      <h1>Loans</h1>
      {open.length === 0 && past.length === 0 && (
        <p>
          No loans yet. Find something in <Link href="/items">Browse</Link> and request dates, or{" "}
          <Link href="/items/new">list an item</Link> for others to borrow.
        </p>
      )}
      {todo.length > 0 && (
        <section aria-labelledby="todo-heading">
          <h2 id="todo-heading">Waiting on you ({todo.length})</h2>
          <ul className="rows" data-testid="loans-todo">
            {todo.map((l) => (
              <LoanRow key={l.id} loan={l} fmt={fmt} />
            ))}
          </ul>
        </section>
      )}
      {rest.length > 0 && (
        <section aria-labelledby="open-heading">
          <h2 id="open-heading">In progress</h2>
          <ul className="rows" data-testid="loans-open">
            {rest.map((l) => (
              <LoanRow key={l.id} loan={l} fmt={fmt} />
            ))}
          </ul>
        </section>
      )}
      {past.length > 0 && (
        <section aria-labelledby="past-heading">
          <h2 id="past-heading">Past</h2>
          <ul className="rows" data-testid="loans-past">
            {past.map((l) => (
              <LoanRow key={l.id} loan={l} fmt={fmt} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
