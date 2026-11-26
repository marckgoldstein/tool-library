import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { FormValidation } from "@/components/form-validation";
import { EXCLUDED_ITEMS } from "@/content/categories";
import { DomainError } from "@/server/errors";
import { CONDITIONS, DESCRIPTION_MAX, HANDOFF_MAX, MAX_PHOTOS, TITLE_MAX, getItem, listCategories, type ItemView } from "@/server/items/service";
import { photoUrl } from "@/server/storage/photos";
import { updateItemAction } from "../../actions";
import { ItemForm } from "../../item-form";

export const metadata: Metadata = { title: "Edit item" };
export const dynamic = "force-dynamic";

/** S8: the owner edits their item, unless a loan locks the listing (D23). */
export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
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
  if (!item.isOwner || item.status === "delisted") notFound();

  if (item.locked) {
    return (
      <>
        <h1>Edit {item.title}</h1>
        <p className="notice warn">
          This item has an approved or active loan, so it can&apos;t be edited, paused or delisted until the loan closes.
        </p>
        <p>
          <Link href={`/items/${item.id}`}>Back to the item</Link>
        </p>
      </>
    );
  }

  const categories = await listCategories();
  return (
    <>
      <h1 id="item-heading">Edit {item.title}</h1>
      <FormValidation />
      <ItemForm
        action={updateItemAction.bind(null, item.id)}
        categories={categories}
        conditions={CONDITIONS}
        exclusions={EXCLUDED_ITEMS}
        limits={{ title: TITLE_MAX, description: DESCRIPTION_MAX, handoff: HANDOFF_MAX, photos: MAX_PHOTOS }}
        defaults={{
          title: item.title,
          categoryId: item.categoryId,
          description: item.description,
          condition: item.condition,
          handoffNotes: item.handoffNotes ?? "",
        }}
        existingPhotos={item.photos.map((p) => ({ id: p.id, url: photoUrl(p.storageKey) }))}
        submitLabel="Save changes"
      />
      <p>
        <Link href={`/items/${item.id}`}>Cancel</Link>
      </p>
    </>
  );
}
