import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { ConfirmAction } from "@/components/confirm-action";
import { SubmitButton } from "@/components/submit-button";
import { NOTICES } from "@/content/notices";
import { loanLine } from "@/components/loan-line";
import { DomainError } from "@/server/errors";
import { activeMembership, cleanTimezone } from "@/server/invitations/service";
import { getItem, type ItemView } from "@/server/items/service";
import { photoUrl } from "@/server/storage/photos";
import { adminDelistAction, itemStatusAction, type ItemResult } from "../actions";
import { askOwnerAction } from "../../threads/actions";
import { RequestForm } from "../../loans/request-form";
import { openLoanForItem } from "@/server/loans/queries";
import { alignedLocalMin } from "@/lib/zoned-time";

export const metadata: Metadata = { title: "Item" };
export const dynamic = "force-dynamic";

const RESULT: Record<ItemResult, { ok: boolean; text: string }> = {
  listed: { ok: true, text: "Listed. Members in your group can find it now." },
  saved: { ok: true, text: "Changes saved." },
  paused: { ok: true, text: "Paused. It's hidden from search until you resume it." },
  resumed: { ok: true, text: "Available again. Members can find it in search." },
  delisted: { ok: true, text: "Delisted." },
  admin_delisted: { ok: true, text: "Taken down. The owner has been emailed your note." },
  needs_note: { ok: false, text: "Add a note for the owner explaining why, then try again." },
  locked: { ok: false, text: "This item has an approved or active loan, so it can't be changed until the loan closes." },
  failed: { ok: false, text: "That didn't work. Reload the page and try again." },
};

const STATUS_LABEL: Record<ItemView["status"], string> = {
  available: "Available",
  on_loan: "On loan",
  paused: "Paused",
  delisted: "Delisted",
};

const lendingRisk = NOTICES.find((n) => n.id === "lending-risk")!;

/** An item's page, from search (S9). Owners manage it here (S8); members ask about it (S10) and request dates (S12). */
export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const { id } = await params;
  let item: ItemView;
  try {
    item = await getItem(user.id, id);
  } catch (e) {
    if (e instanceof DomainError) notFound();
    throw e;
  }
  const { result } = await searchParams;
  const flash = result && result in RESULT ? RESULT[result as ItemResult] : null;
  const category = item.parentCategoryName ? `${item.parentCategoryName} › ${item.categoryName}` : item.categoryName;
  const firstName = item.owner.name.trim().split(/\s+/)[0] ?? item.owner.name;
  const me = await activeMembership(user.id);
  const timeZone = cleanTimezone(me?.timezone);
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone });
  const myLoan = item.isOwner ? null : await openLoanForItem(user.id, item.id);

  return (
    <>
      {flash && (
        <p className={flash.ok ? "notice success" : "error-text"} role={flash.ok ? "status" : "alert"} data-testid="item-result">
          {flash.text}
        </p>
      )}
      <h1>{item.title}</h1>
      <p>
        <span className="status" data-status={item.status} data-testid="item-status">
          {STATUS_LABEL[item.status]}
        </span>{" "}
        <span className="muted">{category}</span>
      </p>

      {item.photos.length > 0 ? (
        <ul className="photo-strip" aria-label="Photos">
          {item.photos.map((p, i) => (
            <li key={p.id}>
              {/* eslint-disable-next-line @next/next/no-img-element -- served by our /media route */}
              <img src={photoUrl(p.storageKey)} alt={`${item.title}, photo ${i + 1} of ${item.photos.length}`} loading={i === 0 ? "eager" : "lazy"} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No photos yet.</p>
      )}

      <dl className="panel details">
        <dt>Condition</dt>
        <dd>{item.condition}</dd>
        <dt>Owner</dt>
        <dd>
          <Link href={`/members/${item.owner.id}`}>{item.isOwner ? "You" : item.owner.name}</Link>
          {item.owner.generalArea ? <span className="muted"> · {item.owner.generalArea}</span> : null}
        </dd>
        {item.handoffNotes && (
          <>
            <dt>Handoff</dt>
            <dd>{item.handoffNotes}</dd>
          </>
        )}
      </dl>

      {!item.isOwner && (
        <section aria-labelledby="borrow-heading" className="borrow">
          <h2 id="borrow-heading" className="visually-hidden">
            Borrowing
          </h2>
          {item.status === "on_loan" && <p>It&apos;s out on loan right now. You can still ask {firstName} about it.</p>}
          <form action={askOwnerAction}>
            <input type="hidden" name="itemId" value={item.id} />
            {/* Secondary: requesting dates is the main action on this page, and only one button should lead. */}
            <SubmitButton pendingLabel="Opening…" className="secondary">
              Ask {firstName} about it
            </SubmitButton>
          </form>
          <p className="hint">You pick from a short list of set messages, and {firstName} gets an email.</p>
          {myLoan ? (
            <p className="notice" data-testid="my-request">
              You have a {myLoan.status === "requested" ? "request" : "loan"} for {fmt.format(myLoan.startAt)} to{" "}
              {fmt.format(myLoan.endAt)}. <Link href={`/loans/${myLoan.id}`}>See where it stands</Link>
            </p>
          ) : (
            <RequestForm
              itemId={item.id}
              ownerFirstName={firstName}
              minLocal={alignedLocalMin(new Date(), timeZone)}
              timeZoneLabel={timeZone.replaceAll("_", " ")}
            />
          )}
          <div className="notices">
            <details>
              <summary>
                <span>
                  <strong>{lendingRisk.title}:</strong> {lendingRisk.summary}
                </span>
              </summary>
              <p>{lendingRisk.body}</p>
            </details>
          </div>
        </section>
      )}

      {!item.isOwner && user.role === "admin" && item.status !== "delisted" && (
        <section aria-labelledby="admin-heading" className="admin-tools">
          <h2 id="admin-heading">Admin</h2>
          <ConfirmAction
            label="Take down this listing…"
            title={`Take down ${item.title}?`}
            confirmLabel="Take down listing"
            pendingLabel="Taking down…"
            cancelLabel="Leave it listed"
            action={adminDelistAction}
            fields={{ itemId: item.id }}
            variant="quiet"
            danger
          >
            <p>It disappears from search. {firstName} is emailed your note. This can&apos;t be undone here.</p>
            <div className="field">
              <label htmlFor="admin-note">Note for {firstName}</label>
              <textarea id="admin-note" name="note" rows={3} maxLength={1000} required />
              <p className="hint">For example, which part of the exclusion list it falls under.</p>
            </div>
          </ConfirmAction>
        </section>
      )}

      <h2>About this item</h2>
      <p className="prewrap">{item.description}</p>

      {item.isOwner ? (
        <section aria-labelledby="manage-heading">
          <h2 id="manage-heading">Manage your listing</h2>
          {item.locked ? (
            <div className="notice warn" data-testid="locked-notice">
              {item.lockingLoan && (
                <p>
                  <strong>{loanLine(item.lockingLoan, fmt)}.</strong>{" "}
                  <Link href={`/loans/${item.lockingLoan.id}`}>See the loan</Link>
                </p>
              )}
              <p>While it&apos;s lent out, it can&apos;t be edited, paused or delisted. That opens up again once the loan closes.</p>
            </div>
          ) : (
            <div className="actions">
              <Link className="button" href={`/items/${item.id}/edit`}>
                Edit item
              </Link>
              {(item.status === "available" || item.status === "paused") && (
                <form action={itemStatusAction}>
                  <input type="hidden" name="itemId" value={item.id} />
                  <SubmitButton name="intent" value={item.status === "available" ? "pause" : "resume"} className="secondary">
                    {item.status === "available" ? "Pause listing" : "Resume listing"}
                  </SubmitButton>
                </form>
              )}
              {(item.status === "available" || item.status === "paused") && (
                <ConfirmAction
                  label="Delist…"
                  title={`Delist ${item.title}?`}
                  confirmLabel="Delist item"
                  pendingLabel="Delisting…"
                  cancelLabel="Keep it listed"
                  action={itemStatusAction}
                  fields={{ itemId: item.id, intent: "delist" }}
                  danger
                >
                  <p>It disappears from search and from your items. To lend it again, list it as a new item.</p>
                  <p>If you only need a break, pause it instead.</p>
                </ConfirmAction>
              )}
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
