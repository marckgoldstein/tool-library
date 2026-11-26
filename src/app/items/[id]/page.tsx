import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { ConfirmAction } from "@/components/confirm-action";
import { SubmitButton } from "@/components/submit-button";
import { NOTICES } from "@/content/notices";
import { DomainError } from "@/server/errors";
import { getItem, type ItemView } from "@/server/items/service";
import { photoUrl } from "@/server/storage/photos";
import { itemStatusAction, type ItemResult } from "../actions";

export const metadata: Metadata = { title: "Item" };
export const dynamic = "force-dynamic";

const RESULT: Record<ItemResult, { ok: boolean; text: string }> = {
  listed: { ok: true, text: "Listed. Members in your group can find it now." },
  saved: { ok: true, text: "Changes saved." },
  paused: { ok: true, text: "Paused. It's hidden from search until you resume it." },
  resumed: { ok: true, text: "Available again. Members can find it in search." },
  delisted: { ok: true, text: "Delisted." },
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

/** An item's page, from search (S9). Owners manage it here (S8). Requests arrive with the loan loop (M5). */
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
      <h2>About this item</h2>
      <p className="prewrap">{item.description}</p>

      {item.isOwner ? (
        <section aria-labelledby="manage-heading">
          <h2 id="manage-heading">Manage your listing</h2>
          {item.locked ? (
            <p className="notice warn">
              This item has an approved or active loan, so it can&apos;t be edited, paused or delisted until the loan closes.
            </p>
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
      ) : (
        <section aria-labelledby="borrow-heading">
          <h2 id="borrow-heading">Borrowing</h2>
          {item.status === "on_loan" && <p>It&apos;s out on loan right now.</p>}
          <p className="notice">
            <strong>{lendingRisk.title}:</strong> {lendingRisk.body}
          </p>
          <p className="muted">Messaging the owner and requesting dates arrive in the next milestones.</p>
        </section>
      )}
    </>
  );
}
