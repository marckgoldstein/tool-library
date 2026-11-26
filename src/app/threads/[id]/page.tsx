import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { ConfirmAction } from "@/components/confirm-action";
import { SubmitButton } from "@/components/submit-button";
import { DomainError } from "@/server/errors";
import { activeMembership, cleanTimezone } from "@/server/invitations/service";
import { getOwnContacts } from "@/server/profiles/service";
import { getThread, type ThreadView } from "@/server/threads/service";
import { sendMessageAction, shareContactAction, type ThreadResult } from "../actions";

export const metadata: Metadata = { title: "Thread", robots: { index: false } };
export const dynamic = "force-dynamic";

const RESULT: Record<ThreadResult, { ok: boolean; text: string }> = {
  sent: { ok: true, text: "Sent." },
  shared: { ok: true, text: "Contact details sent. Only this member can see them." },
  not_allowed: { ok: false, text: "That message isn't available at this point. Pick one from the list below." },
  no_contact: { ok: false, text: "Save a phone number or email on Your profile first, then send it from here." },
  closed: { ok: false, text: "This member is no longer in the group, so the thread is closed." },
  slow_down: { ok: false, text: "You've sent a lot of messages in the last hour. Try again a little later." },
  failed: { ok: false, text: "That didn't send. Reload the page and try again." },
};

const STAGE_LABEL: Record<ThreadView["stage"], string> = {
  before_pickup: "Before a loan is approved",
  approved: "Loan approved, before pickup",
  picked_up: "Item picked up",
  closed: "Loan finished",
};

/** S10 and S11: one thread per asker per item, canned messages and contact sharing. */
export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const { id } = await params;
  let thread: ThreadView;
  try {
    thread = await getThread(user.id, id);
  } catch (e) {
    if (e instanceof DomainError) notFound();
    throw e;
  }
  const { result } = await searchParams;
  const flash = result && result in RESULT ? RESULT[result as ThreadResult] : null;
  const me = await activeMembership(user.id);
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: cleanTimezone(me?.timezone) });
  // The sender's own saved values, shown only to them in the confirm step.
  const own = thread.savedContactTypes.length > 0 ? await getOwnContacts(user.id) : { phone: null, email: null };

  return (
    <>
      <p className="muted">
        <Link href="/threads">Messages</Link> ›{" "}
        <Link href={`/items/${thread.item.id}`}>{thread.item.title}</Link>
      </p>
      <h1>
        {thread.role === "asker" ? "You and " : "About your item, with "}
        <Link href={`/members/${thread.other.id}`}>{thread.other.name}</Link>
      </h1>
      <p className="muted" data-testid="thread-stage">
        {STAGE_LABEL[thread.stage]}
      </p>
      {flash && (
        <p className={flash.ok ? "notice success" : "error-text"} role={flash.ok ? "status" : "alert"} data-testid="thread-result">
          {flash.text}
        </p>
      )}

      <h2 className="visually-hidden">Messages</h2>
      {thread.messages.length === 0 ? (
        <p data-testid="thread-empty">No messages yet. Pick one below to start.</p>
      ) : (
        <ol className="thread" aria-label={`Messages with ${thread.other.name}`} data-testid="thread-messages">
          {thread.messages.map((m, i) => (
            <li
              key={m.id}
              id={i === thread.messages.length - 1 ? "latest" : undefined}
              className={m.mine ? "msg mine" : "msg"}
              data-kind={m.kind}
            >
              <p className="msg-meta">
                <span>{m.senderName}</span> <time dateTime={m.createdAt.toISOString()}>{fmt.format(m.createdAt)}</time>
              </p>
              <p className="msg-text">{m.text}</p>
              {m.recipientNote && (
                <p className="msg-note" data-testid="recipient-note">
                  {m.recipientNote}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      {thread.canWrite ? (
        <section aria-labelledby="reply-heading" className="composer">
          <h2 id="reply-heading">Send a message</h2>
          <p className="hint">Messages are picked from a list, so everyone stays clear and kind. {thread.other.name} gets an email.</p>
          {thread.categories.map((c) => (
            <form key={c.key} action={sendMessageAction} className="canned" aria-labelledby={`cat-${c.key}`}>
              <input type="hidden" name="threadId" value={thread.id} />
              <h3 id={`cat-${c.key}`}>{c.label}</h3>
              <div className="canned-options">
                {c.messages.map((msg) => (
                  <SubmitButton key={msg.key} name="templateKey" value={msg.key} className="secondary canned-option">
                    {msg.text}
                  </SubmitButton>
                ))}
              </div>
            </form>
          ))}

          <section aria-labelledby="contact-heading" className="share">
            <h3 id="contact-heading">Send contact details</h3>
            {thread.savedContactTypes.length === 0 ? (
              <p>
                You haven&apos;t saved any contact details.{" "}
                <Link href="/profile">Add a phone number or email on Your profile</Link>, then send it from here.
              </p>
            ) : (
              <div className="actions">
                {thread.savedContactTypes.map((type) => {
                  const value = type === "phone" ? own.phone : own.email;
                  const label = type === "phone" ? "Send my phone number" : "Send my email";
                  return (
                    <ConfirmAction
                      key={type}
                      label={label}
                      title={`Send your ${type === "phone" ? "phone number" : "email"} to ${thread.other.name}?`}
                      confirmLabel={label}
                      action={shareContactAction}
                      fields={{ threadId: thread.id, contactType: type }}
                    >
                      <p>
                        {thread.other.name} will see: <strong>Here&apos;s my contact info: {value}</strong>
                      </p>
                      <p>Only the two of you can see it, and it can&apos;t be unsent.</p>
                    </ConfirmAction>
                  );
                })}
              </div>
            )}
            {!thread.hasContactShare && (
              <p className="hint">Pickup needs at least one of you to send contact details in this thread.</p>
            )}
          </section>
        </section>
      ) : (
        <p className="notice warn">{thread.other.name} is no longer in the group, so this thread is closed.</p>
      )}
    </>
  );
}
