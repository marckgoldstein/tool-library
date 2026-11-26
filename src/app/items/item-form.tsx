"use client";

import { useEffect, useRef } from "react";
import { SubmitButton } from "@/components/submit-button";
import { useKeptFormAction } from "@/components/use-kept-form";
import type { ItemFields } from "@/server/items/service";
import type { ItemFormState } from "./actions";

export interface CategoryOption {
  id: string;
  name: string;
  children: { id: string; name: string }[];
}

const initial: ItemFormState = { status: "idle" };

/** ["Weapons", "Vehicles", "Consumables"] → "Weapons, vehicles and consumables". */
function sentenceList(words: string[]) {
  const lower = words.map((w, i) => (i === 0 ? w : w.charAt(0).toLowerCase() + w.slice(1)));
  return lower.length < 2 ? lower.join("") : `${lower.slice(0, -1).join(", ")} and ${lower.at(-1)}`;
}

/** The list (S7) and edit (S8) form. Existing photos come rendered by the server page, with their URLs. */
export function ItemForm({
  action,
  categories,
  conditions,
  exclusions,
  limits,
  defaults,
  existingPhotos = [],
  submitLabel,
}: {
  action: (state: ItemFormState, formData: FormData) => Promise<ItemFormState>;
  categories: CategoryOption[];
  conditions: readonly string[];
  exclusions: string[];
  limits: { title: number; description: number; handoff: number; photos: number };
  defaults?: ItemFields;
  existingPhotos?: { id: string; url: string }[];
  submitLabel: string;
}) {
  const { state, formAction, onSubmit, pending } = useKeptFormAction(action, initial);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state]);
  // Fields keep what was typed after an error (no form reset), so defaults only seed the first render.
  const v = defaults;
  const isEdit = existingPhotos.length > 0;

  return (
    <form className="stack wide" action={formAction} onSubmit={onSubmit} aria-labelledby="item-heading">
      {state.status === "error" && (
        <p ref={errorRef} tabIndex={-1} role="alert" className="error-text" data-testid="item-error">
          {state.message}
        </p>
      )}
      <div className="field">
        <label htmlFor="title">Title</label>
        <input id="title" name="title" type="text" required maxLength={limits.title} defaultValue={v?.title} autoComplete="off" data-error="title-error" aria-describedby="title-hint" />
        <p id="title-hint" className="hint">What people would search for, like &ldquo;Cordless drill&rdquo; or &ldquo;4-person tent&rdquo;.</p>
        <p id="title-error" className="error-msg">Give the item a title.</p>
      </div>
      <div className="field">
        <label htmlFor="categoryId">Category</label>
        <select id="categoryId" name="categoryId" required defaultValue={v?.categoryId ?? ""} data-error="category-error">
          <option value="" disabled>
            Choose a category
          </option>
          {categories.map((c) =>
            c.children.length === 0 ? (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ) : (
              <optgroup key={c.id} label={c.name}>
                <option value={c.id}>{c.name} (general)</option>
                {c.children.map((child) => (
                  <option key={child.id} value={child.id}>
                    {child.name}
                  </option>
                ))}
              </optgroup>
            ),
          )}
        </select>
        <p id="category-error" className="error-msg">Choose a category.</p>
      </div>
      <div className="field">
        <label htmlFor="description">Description</label>
        <textarea id="description" name="description" required rows={5} maxLength={limits.description} defaultValue={v?.description} data-error="description-error" aria-describedby="description-hint" />
        <p id="description-hint" className="hint">What it is, what comes with it (blades, batteries, charger), anything to know before using it.</p>
        <p id="description-error" className="error-msg">Describe the item.</p>
      </div>
      <fieldset>
        <legend>Condition</legend>
        <div className="choices">
          {conditions.map((c, i) => (
            <div className="field check" key={c}>
              <input
                id={`condition-${i}`}
                type="radio"
                name="condition"
                value={c}
                required
                defaultChecked={v?.condition === c}
                data-error="condition-error"
              />
              <label htmlFor={`condition-${i}`}>{c}</label>
            </div>
          ))}
        </div>
        <p id="condition-error" className="error-msg">
          Choose the item&apos;s condition.
        </p>
      </fieldset>
      <div className="field">
        <label htmlFor="handoffNotes">
          Handoff notes <span className="hint">(optional)</span>
        </label>
        <textarea id="handoffNotes" name="handoffNotes" rows={2} maxLength={limits.handoff} defaultValue={v?.handoffNotes} aria-describedby="handoff-hint" />
        <p id="handoff-hint" className="hint">When pickup usually works, like &ldquo;Weekday evenings&rdquo;. Don&apos;t include your address.</p>
      </div>

      {isEdit && (
        <fieldset>
          <legend>Current photos</legend>
          <ul className="photo-grid">
            {existingPhotos.map((p, i) => (
              <li key={p.id}>
                {/* eslint-disable-next-line @next/next/no-img-element -- served by our /media route */}
                <img src={p.url} alt={`Photo ${i + 1}`} width={120} height={120} />
                <div className="field check">
                  <input id={`remove-${p.id}`} type="checkbox" name="removePhoto" value={p.id} />
                  <label htmlFor={`remove-${p.id}`}>Remove photo {i + 1}</label>
                </div>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <div className="field">
        <label htmlFor="photos">{isEdit ? "Add photos" : "Photos"}</label>
        <input
          id="photos"
          name="photos"
          type="file"
          multiple
          required={!isEdit}
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          aria-describedby="photos-hint"
          data-error="photos-error"
        />
        <p id="photos-hint" className="hint">
          {isEdit ? "" : "At least one. "}Up to 4 at a time and {limits.photos} in all; JPEG, PNG, WebP or HEIC, 10 MB each. We remove location data.
        </p>
        <p id="photos-error" className="error-msg">Add at least one photo of the item.</p>
      </div>

      <section className="notice warn" aria-labelledby="excluded-heading">
        <h2 id="excluded-heading" className="notice-heading">Items that can&apos;t be listed</h2>
        <p>{sentenceList(exclusions)}. Anything else legal is fine.</p>
      </section>
      <SubmitButton pendingLabel="Saving…" pending={pending}>
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
