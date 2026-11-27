import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { ConfirmAction } from "@/components/confirm-action";
import { SubmitButton } from "@/components/submit-button";
import { CANCEL_DECLINE_REASONS, reasonText } from "@/content/canned-messages";
import { NOTICES } from "@/content/notices";
import { DomainError } from "@/server/errors";
import { activeMembership, cleanTimezone } from "@/server/invitations/service";
import { getLoanView, type LoanView } from "@/server/loans/queries";
import { adminCloseAction, loanAction, type LoanResult } from "../actions";

export const metadata: Metadata = { title: "Loan" };
export const dynamic = "force-dynamic";

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

const OUTCOME_LABEL = { fine: "Came back fine", damaged: "Came back damaged", not_returned: "Not returned" } as const;

const RESULT: Record<LoanResult, { ok: boolean; text: string }> = {
  requested: { ok: true, text: "Request sent. The owner gets an email and approves or declines." },
  withdrawn: { ok: true, text: "Request withdrawn. The owner has been told." },
  approved: { ok: true, text: "Approved. Any other requests for the same dates were declined automatically." },
  declined: { ok: true, text: "Declined. The borrower has been told." },
  picked_up: { ok: true, text: "Marked as picked up. The due time is the approved end time." },
  cancelled: { ok: true, text: "Loan cancelled. The other member has been told, and the listing is unlocked." },
  returned: { ok: true, text: "Marked as returned. The owner will check it over and confirm." },
  closed: { ok: true, text: "Loan closed. Thanks for lending." },
  contact_required: {
    ok: false,
    text: "One of you needs to send a contact detail in the thread before pickup, so you can arrange the handoff.",
  },
  conflict: { ok: false, text: "Those dates overlap a loan that's already approved." },
  needs_reason: { ok: false, text: "Choose a reason, then try again." },
  needs_note: { ok: false, text: "Add a note describing what happened, then try again." },
  invalid_state: { ok: false, text: "This loan has moved on since you opened the page. The page now shows where it stands." },
  failed: { ok: false, text: "That didn't work. Reload the page and try again." },
};

const meetingNotice = NOTICES.find((n) => n.id === "meeting-in-person")!;
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

function ReasonSelect({ required }: { required: boolean }) {
  return (
    <div className="field">
      <label htmlFor="reasonKey">
        Reason {required ? null : <span className="hint">(optional)</span>}
      </label>
      <select id="reasonKey" name="reasonKey" required={required} defaultValue="">
        <option value="" disabled={required}>
          {required ? "Choose a reason" : "No reason"}
        </option>
        {CANCEL_DECLINE_REASONS.map((r) => (
          <option key={r.key} value={r.key}>
            {r.text}
          </option>
        ))}
      </select>
    </div>
  );
}

function Actions({ loan }: { loan: LoanView }) {
  const other = loan.role === "owner" ? loan.borrower : loan.owner;
  const otherFirst = firstName(other.name);
  const fields = { loanId: loan.id };
  const { role, status } = loan;

  if (role === "admin") {
    const open = ["requested", "approved", "active", "overdue", "returned"].includes(status);
    const removed = !loan.borrower.active || !loan.owner.active;
    // S23 (R1): with a member removed, nobody else can finish the loan, so the admin can.
    if (open && removed) {
      return (
        <div className="actions">
          <ConfirmAction
            label="Close this loan…"
            title="Close this loan for the removed member?"
            confirmLabel="Close the loan"
            pendingLabel="Closing…"
            cancelLabel="Leave it open"
            action={adminCloseAction}
            fields={fields}
            danger
          >
            <p>
              {status === "requested" || status === "approved"
                ? "It hasn't been picked up, so it's cancelled whatever you choose. "
                : null}
              The other member is emailed, and the history records you as the one who closed it.
            </p>
            <fieldset>
              <legend>Outcome</legend>
              <div className="field check">
                <input id="a-fine" type="radio" name="outcome" value="fine" defaultChecked />
                <label htmlFor="a-fine">Came back fine</label>
              </div>
              <div className="field check">
                <input id="a-damaged" type="radio" name="outcome" value="damaged" />
                <label htmlFor="a-damaged">Came back damaged</label>
              </div>
              <div className="field check">
                <input id="a-missing" type="radio" name="outcome" value="not_returned" />
                <label htmlFor="a-missing">Didn&apos;t come back</label>
              </div>
            </fieldset>
            <div className="field">
              <label htmlFor="admin-note">Note</label>
              <textarea id="admin-note" name="note" rows={3} maxLength={2000} required />
            </div>
          </ConfirmAction>
        </div>
      );
    }
    return <p className="muted">Only the two members in this loan can act on it.</p>;
  }

  if (status === "requested" && role === "borrower") {
    return (
      <div className="actions">
        <ConfirmAction
          label="Withdraw request…"
          title="Withdraw this request?"
          confirmLabel="Withdraw request"
          pendingLabel="Withdrawing…"
          cancelLabel="Keep my request"
          action={loanAction}
          fields={{ ...fields, intent: "withdraw" }}
        >
          <p>{otherFirst} will be told. You can send a new request any time.</p>
        </ConfirmAction>
      </div>
    );
  }

  if (status === "requested" && role === "owner") {
    return (
      <div className="actions">
        <form action={loanAction}>
          <input type="hidden" name="loanId" value={loan.id} />
          <SubmitButton name="intent" value="approve" pendingLabel="Approving…">
            Approve request
          </SubmitButton>
        </form>
        <ConfirmAction
          label="Decline…"
          title={`Decline ${otherFirst}'s request?`}
          confirmLabel="Decline request"
          pendingLabel="Declining…"
          cancelLabel="Keep it open"
          action={loanAction}
          fields={{ ...fields, intent: "decline" }}
          danger
        >
          <p>{otherFirst} gets an email. A reason helps, but you don&apos;t have to give one.</p>
          <ReasonSelect required={false} />
        </ConfirmAction>
      </div>
    );
  }

  if (status === "approved") {
    return (
      <>
        <p className="notice">
          <strong>{meetingNotice.title}:</strong> {meetingNotice.body}
        </p>
        <div className="actions">
          {role === "owner" &&
            (loan.hasContactShare ? (
              <form action={loanAction}>
                <input type="hidden" name="loanId" value={loan.id} />
                <SubmitButton name="intent" value="pickup" pendingLabel="Saving…">
                  Mark picked up
                </SubmitButton>
              </form>
            ) : (
              // S15: disabled with a prompt until a contact detail is shared in the thread.
              <span className="pickup-gate">
                <button type="button" disabled aria-describedby="pickup-gate-hint">
                  Mark picked up
                </button>
                <span id="pickup-gate-hint" className="hint" data-testid="pickup-gate">
                  One of you needs to send a contact detail first.{" "}
                  <Link href={`/threads/${loan.conversationId}`}>Open the thread</Link> to send yours.
                </span>
              </span>
            ))}
          <ConfirmAction
            label="Cancel loan…"
            title="Cancel this loan before pickup?"
            confirmLabel="Cancel loan"
            pendingLabel="Cancelling…"
            cancelLabel="Keep the loan"
            action={loanAction}
            fields={{ ...fields, intent: "cancel" }}
            danger
          >
            <p>{otherFirst} gets an email with the reason, and the listing opens up again.</p>
            <ReasonSelect required />
          </ConfirmAction>
        </div>
        {role === "borrower" && !loan.hasContactShare && (
          <p className="hint" data-testid="pickup-gate">
            Before pickup, one of you needs to send a contact detail in the{" "}
            <Link href={`/threads/${loan.conversationId}`}>thread</Link>.
          </p>
        )}
      </>
    );
  }

  if ((status === "active" || status === "overdue") && role === "borrower") {
    return (
      <div className="actions">
        <ConfirmAction
          label="Mark returned…"
          title={`Have you given the item back to ${otherFirst}?`}
          confirmLabel="Yes, mark returned"
          pendingLabel="Saving…"
          cancelLabel="Not yet"
          action={loanAction}
          fields={{ ...fields, intent: "returned" }}
        >
          <p>{otherFirst} will check it over and confirm, which closes the loan.</p>
        </ConfirmAction>
      </div>
    );
  }

  if ((status === "active" || status === "overdue" || status === "returned") && role === "owner") {
    const returned = status === "returned";
    return (
      <div className="actions">
        <ConfirmAction
          label={returned ? "Confirm the return…" : "Not coming back…"}
          title={returned ? `How did it come back from ${otherFirst}?` : `Close the loan as not returned?`}
          confirmLabel={returned ? "Close the loan" : "Close as not returned"}
          pendingLabel="Closing…"
          cancelLabel={returned ? "Not yet" : "Keep waiting"}
          action={loanAction}
          fields={returned ? { ...fields, intent: "close" } : { ...fields, intent: "close", outcome: "not_returned" }}
          danger={!returned}
        >
          {returned ? (
            <fieldset>
              <legend>Outcome</legend>
              <div className="field check">
                <input id="outcome-fine" type="radio" name="outcome" value="fine" defaultChecked />
                <label htmlFor="outcome-fine">Came back fine</label>
              </div>
              <div className="field check">
                <input id="outcome-damaged" type="radio" name="outcome" value="damaged" />
                <label htmlFor="outcome-damaged">Came back damaged</label>
              </div>
              <div className="field check">
                <input id="outcome-missing" type="radio" name="outcome" value="not_returned" />
                <label htmlFor="outcome-missing">Didn&apos;t come back</label>
              </div>
            </fieldset>
          ) : (
            <p>The item is delisted and the admin is emailed to help sort it out. {otherFirst} is told too.</p>
          )}
          <div className="field">
            <label htmlFor="note">
              Note {returned ? <span className="hint">(needed if it was damaged or didn&apos;t come back)</span> : null}
            </label>
            <textarea id="note" name="note" rows={3} maxLength={2000} required={!returned} />
          </div>
        </ConfirmAction>
      </div>
    );
  }

  return null;
}

/** The loan, from emails and the Loans page (M5: S12–S20). Actions depend on who's looking and where the loan stands. */
export default async function LoanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");
  const { id } = await params;
  let loan: LoanView;
  try {
    loan = await getLoanView(session.user.id, session.user.role, id);
  } catch (e) {
    if (e instanceof DomainError) notFound();
    throw e;
  }
  const { result } = await searchParams;
  const flash = result && result in RESULT ? RESULT[result as LoanResult] : null;
  const me = await activeMembership(session.user.id);
  const timeZone = cleanTimezone(me?.timezone);
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone });
  const roleLine = loan.role === "owner" ? "You're lending this" : loan.role === "borrower" ? "You're borrowing this" : "Admin view";

  return (
    <>
      <p className="muted">
        <Link href="/loans">Loans</Link> › <Link href={`/items/${loan.item.id}`}>{loan.item.title}</Link>
      </p>
      {flash && (
        <p className={flash.ok ? "notice success" : "error-text"} role={flash.ok ? "status" : "alert"} data-testid="loan-result">
          {flash.text}
        </p>
      )}
      <h1>{loan.item.title}</h1>
      <p>
        <span className="status" data-status={loan.status} data-testid="loan-status">
          {STATUS_LABEL[loan.status]}
        </span>{" "}
        · {roleLine}
      </p>
      <dl className="panel details">
        <dt>Lender</dt>
        <dd>
          <Link href={`/members/${loan.owner.id}`}>{loan.role === "owner" ? "You" : loan.owner.name}</Link>
          {!loan.owner.active && <span className="muted"> (no longer in the group)</span>}
        </dd>
        <dt>Borrower</dt>
        <dd>
          <Link href={`/members/${loan.borrower.id}`}>{loan.role === "borrower" ? "You" : loan.borrower.name}</Link>
          {!loan.borrower.active && <span className="muted"> (no longer in the group)</span>}
        </dd>
        <dt>From</dt>
        <dd data-testid="loan-start">{fmt.format(loan.startAt)}</dd>
        <dt>Due back</dt>
        <dd data-testid="loan-end">{fmt.format(loan.endAt)}</dd>
        {loan.outcome && (
          <>
            <dt>Outcome</dt>
            <dd data-testid="loan-outcome">{OUTCOME_LABEL[loan.outcome]}</dd>
          </>
        )}
        <dt>Times shown in</dt>
        <dd>{timeZone.replaceAll("_", " ")}</dd>
      </dl>
      {loan.role !== "admin" && (
        <p>
          <Link href={`/threads/${loan.conversationId}`}>Messages with {firstName(loan.role === "owner" ? loan.borrower.name : loan.owner.name)}</Link>
        </p>
      )}

      <section aria-labelledby="next-heading">
        <h2 id="next-heading" className="visually-hidden">
          What you can do
        </h2>
        <Actions loan={loan} />
      </section>

      <h2>History</h2>
      <ol className="timeline">
        {loan.events.map((e) => (
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
