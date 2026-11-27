import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { ConfirmAction } from "@/components/confirm-action";
import { activeMembership, cleanTimezone } from "@/server/invitations/service";
import { listMembersForAdmin } from "@/server/members/service";
import { memberAction, type MemberResult } from "./actions";

export const metadata: Metadata = { title: "Members", robots: { index: false } };
export const dynamic = "force-dynamic";

const RESULT: Record<MemberResult, { ok: boolean; text: string }> = {
  removed: { ok: true, text: "Removed. They're signed out and can't sign in again." },
  removed_open: {
    ok: true,
    text: "Removed. They still have open loans: the other members keep seeing them, and you can close them for the removed member when it's time.",
  },
  promoted: { ok: true, text: "They're now an admin. Problem reports go to an admin who isn't part of the loan." },
  demoted: { ok: true, text: "They're a member again." },
  last_admin: { ok: false, text: "The group needs at least one admin. Make someone else an admin first." },
  self: { ok: false, text: "You can't remove yourself. Ask another admin." },
  not_found: { ok: false, text: "That member couldn't be found. Reload the page and try again." },
  failed: { ok: false, text: "That didn't work. Reload the page and try again." },
};

/** S6 and T9: the admin removes members and chooses who else is an admin. */
export default async function AdminMembersPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const me = await activeMembership(user.id);
  if (!me || me.role !== "admin") notFound();
  const { result } = await searchParams;
  const flash = result && result in RESULT ? RESULT[result as MemberResult] : null;
  const { active, removed } = await listMembersForAdmin(user.id);
  const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: cleanTimezone(me.timezone) });
  const adminCount = active.filter((m) => m.role === "admin").length;

  return (
    <>
      <h1>Members</h1>
      <p>
        Removing someone signs them out and stops them signing in. Loans they&apos;re part of stay visible to the other
        member. Having two admins means problem reports can go to one who isn&apos;t involved.
      </p>
      {flash && (
        <p className={flash.ok ? "notice success" : "error-text"} role={flash.ok ? "status" : "alert"} data-testid="members-result">
          {flash.text}
        </p>
      )}

      <h2>Active ({active.length})</h2>
      <ul className="rows" data-testid="active-members">
        {active.map((m) => {
          const name = m.name ?? m.email;
          const isMe = m.id === user.id;
          return (
            <li key={m.id}>
              <span>
                <Link href={`/members/${m.id}`}>{name}</Link>
                {isMe && <span className="muted"> (you)</span>} <span className="muted">{m.email}</span>
              </span>
              {m.role === "admin" && <span className="role">Admin</span>}
              <time className="muted" dateTime={m.joinedAt.toISOString()}>
                Joined {dateFmt.format(m.joinedAt)}
              </time>
              <span className="actions">
                {m.role === "admin" ? (
                  adminCount > 1 && (
                    <ConfirmAction
                      label="Remove admin role…"
                      title={isMe ? "Step down as admin?" : `Make ${name} a member again?`}
                      confirmLabel={isMe ? "Step down" : "Remove admin role"}
                      pendingLabel="Updating…"
                      cancelLabel={isMe ? "Stay admin" : `Keep ${name} as admin`}
                      action={memberAction}
                      fields={{ memberId: m.id, intent: "demote" }}
                      variant="quiet"
                    >
                      <p>
                        {isMe ? "You" : "They"}&apos;ll no longer see member suggestions or this page, or get problem
                        reports from loans.
                      </p>
                    </ConfirmAction>
                  )
                ) : (
                  <ConfirmAction
                    label="Make admin…"
                    title={`Make ${name} an admin?`}
                    confirmLabel={`Make ${name} an admin`}
                    pendingLabel="Updating…"
                    cancelLabel={`Keep ${name} as a member`}
                    action={memberAction}
                    fields={{ memberId: m.id, intent: "promote" }}
                    variant="quiet"
                  >
                    <p>Admins see every member&apos;s email address, who suggested each new member, and this page.</p>
                    <p>They approve new members, can remove people, and get problem reports when a loan goes wrong.</p>
                  </ConfirmAction>
                )}
                {!isMe && !(m.role === "admin" && adminCount <= 1) && (
                  <ConfirmAction
                    label="Remove…"
                    title={`Remove ${name} from the group?`}
                    confirmLabel={`Remove ${name}`}
                    pendingLabel="Removing…"
                    cancelLabel={`Keep ${name}`}
                    action={memberAction}
                    fields={{ memberId: m.id, intent: "remove" }}
                    danger
                  >
                    <p>They&apos;ll be signed out and won&apos;t be able to sign in. Their profile is hidden from members.</p>
                    <p>Loans they&apos;re part of stay visible to the other member. This can&apos;t be undone here.</p>
                  </ConfirmAction>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <h2>Removed ({removed.length})</h2>
      {removed.length === 0 ? (
        <p>No one has been removed.</p>
      ) : (
        <ul className="rows" data-testid="removed-members">
          {removed.map((m) => (
            <li key={m.id}>
              <span>{m.name ?? m.email}</span>
              {m.removedAt && (
                <time className="muted" dateTime={m.removedAt.toISOString()}>
                  Removed {dateFmt.format(m.removedAt)}
                </time>
              )}
              {m.openLoans.length > 0 && (
                <span className="owned-main" data-testid="removed-open-loans">
                  <strong className="todo">
                    {m.openLoans.length === 1 ? "1 open loan to close" : `${m.openLoans.length} open loans to close`}
                  </strong>
                  {m.openLoans.map((l) => (
                    <Link key={l.id} href={`/loans/${l.id}`}>
                      {l.itemTitle}
                    </Link>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
