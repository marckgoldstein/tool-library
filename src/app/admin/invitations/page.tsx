import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { SubmitButton } from "@/components/submit-button";
import { activeMembership, cleanTimezone, listForAdmin } from "@/server/invitations/service";
import { decideAction, type DecideResult } from "./actions";

export const metadata: Metadata = { title: "Member suggestions", robots: { index: false } };
export const dynamic = "force-dynamic";

const STATUS_LABEL = {
  pending_admin: "Waiting for you",
  approved: "Invite sent",
  accepted: "Joined",
  declined: "Declined",
  expired: "Invite expired",
} as const;

const RESULT: Record<DecideResult, { ok: boolean; text: string }> = {
  approved: { ok: true, text: "Approved. The invite link is on its way." },
  declined: { ok: true, text: "Declined. We've let the member who suggested them know." },
  resent: { ok: true, text: "A new invite link is on its way. The old link no longer works." },
  not_found: { ok: false, text: "That suggestion couldn't be found. Reload the page and try again." },
  already_decided: { ok: false, text: "That suggestion was already decided. The list below is up to date." },
  joined: { ok: false, text: "That person has already joined, so no new link was sent." },
  failed: { ok: false, text: "That didn't work. Reload the page and try again." },
};

/** S2: the admin approves or declines suggestions (D10). The suggester is shown here only (D11). */
export default async function AdminInvitationsPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const admin = await activeMembership(user.id);
  if (!admin || admin.role !== "admin") notFound(); // admin pages check the role (CLAUDE.md)
  const { result } = await searchParams;
  const flash = result && result in RESULT ? RESULT[result as DecideResult] : null;
  const rows = await listForAdmin(user.id);
  const pending = rows.filter((r) => r.status === "pending_admin");
  const sent = rows.filter((r) => r.status === "approved" || r.status === "expired");
  const past = rows.filter((r) => r.status === "accepted" || r.status === "declined");
  const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: cleanTimezone(admin.timezone) });

  return (
    <>
      <h1>Member suggestions</h1>
      {flash && (
        <p
          className={flash.ok ? "notice success" : "error-text"}
          role={flash.ok ? "status" : "alert"}
          data-testid="admin-result"
        >
          {flash.text}
        </p>
      )}

      <h2>Waiting for you ({pending.length})</h2>
      {pending.length === 0 ? (
        <p>Nothing to review. New suggestions from members appear here, and you&apos;ll get an email for each one.</p>
      ) : (
        <ul className="cards" data-testid="pending-suggestions">
          {pending.map((r) => (
            <li key={r.id} className="panel" aria-labelledby={`inv-${r.id}`}>
              <h3 id={`inv-${r.id}`}>{r.inviteeName}</h3>
              <dl className="details">
                <dt>Email</dt>
                <dd>{r.inviteeEmail}</dd>
                <dt>Suggested by</dt>
                <dd>{r.suggestedByName ?? "A member"}</dd>
                <dt>Suggested on</dt>
                <dd>
                  <time dateTime={r.createdAt.toISOString()}>{dateFmt.format(r.createdAt)}</time>
                </dd>
              </dl>
              <form action={decideAction} className="actions">
                <input type="hidden" name="invitationId" value={r.id} />
                <SubmitButton name="decision" value="approve" pendingLabel="Sending invite…">
                  Approve and send invite
                </SubmitButton>
                <SubmitButton name="decision" value="decline" className="secondary">
                  Decline
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}

      <h2>Invites sent</h2>
      {sent.length === 0 ? (
        <p>No open invites.</p>
      ) : (
        <ul className="rows" data-testid="sent-invites">
          {sent.map((r) => (
            <li key={r.id}>
              <span>
                {r.inviteeName} <span className="muted">{r.inviteeEmail}</span>
              </span>
              <span className="status" data-status={r.status}>
                {r.status === "approved" && r.expiresAt
                  ? `Link works until ${dateFmt.format(r.expiresAt)}`
                  : STATUS_LABEL[r.status]}
              </span>
              <form action={decideAction}>
                <input type="hidden" name="invitationId" value={r.id} />
                <SubmitButton name="decision" value="resend" className="secondary" pendingLabel="Sending…">
                  Send a new link
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}

      <h2>Decided</h2>
      {past.length === 0 ? (
        <p>None yet.</p>
      ) : (
        <ul className="rows">
          {past.map((r) => (
            <li key={r.id}>
              <span>{r.inviteeName}</span>
              <span className="status" data-status={r.status}>
                {STATUS_LABEL[r.status]}
              </span>
              <time className="muted" dateTime={r.createdAt.toISOString()}>
                {dateFmt.format(r.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
