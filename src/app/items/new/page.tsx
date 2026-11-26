import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { FormValidation } from "@/components/form-validation";
import { EXCLUDED_ITEMS } from "@/content/categories";
import { CONDITIONS, DESCRIPTION_MAX, HANDOFF_MAX, MAX_PHOTOS, TITLE_MAX, listCategories } from "@/server/items/service";
import { createItemAction } from "../actions";
import { ItemForm } from "../item-form";

export const metadata: Metadata = { title: "List an item" };
export const dynamic = "force-dynamic";

/** S7: list an item. The exclusion list is shown before saving (D3). */
export default async function NewItemPage() {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const categories = await listCategories();
  return (
    <>
      <h1 id="item-heading">List an item</h1>
      <p>Members in your group can find it as soon as you save. You approve every loan.</p>
      <FormValidation />
      <ItemForm
        action={createItemAction}
        categories={categories}
        conditions={CONDITIONS}
        exclusions={EXCLUDED_ITEMS}
        limits={{ title: TITLE_MAX, description: DESCRIPTION_MAX, handoff: HANDOFF_MAX, photos: MAX_PHOTOS }}
        submitLabel="List this item"
      />
    </>
  );
}
