"use client";

import { useActionState, useEffect, useRef } from "react";
import { SubmitButton } from "@/components/submit-button";
import { useKeptFormAction } from "@/components/use-kept-form";
import { saveContactsAction, saveProfileAction, type FormState } from "./actions";

const initial: FormState = { status: "idle" };

function Result({ state, testId }: { state: FormState; testId: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.status !== "idle") ref.current?.focus();
  }, [state]);
  if (state.status === "idle") return null;
  return (
    <p
      ref={ref}
      tabIndex={-1}
      role={state.status === "error" ? "alert" : "status"}
      className={state.status === "error" ? "error-text" : "notice success"}
      data-testid={testId}
    >
      {state.message}
    </p>
  );
}

export function ProfileForm({
  name,
  generalArea,
  hasPhoto,
  generalAreaMax,
}: {
  name: string;
  generalArea: string;
  hasPhoto: boolean;
  generalAreaMax: number;
}) {
  // Kept form: an error leaves typed values and the chosen photo in place; a save remounts from the new values.
  const { state, formAction, onSubmit, pending } = useKeptFormAction(saveProfileAction, initial);
  const key = `${name}|${generalArea}|${hasPhoto}`;
  return (
    <form className="stack wide" action={formAction} onSubmit={onSubmit} aria-labelledby="profile-heading" key={key}>
      <Result state={state} testId="profile-result" />
      <div className="field">
        <label htmlFor="displayName">Display name</label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          autoComplete="name"
          required
          maxLength={60}
          defaultValue={name}
          data-error="displayName-error"
        />
        <p id="displayName-error" className="error-msg">
          Enter the name other members will see.
        </p>
      </div>
      <div className="field">
        <label htmlFor="generalArea">General area</label>
        <input
          id="generalArea"
          name="generalArea"
          type="text"
          autoComplete="off"
          required
          maxLength={generalAreaMax}
          defaultValue={generalArea}
          aria-describedby="generalArea-hint"
          data-error="generalArea-error"
        />
        <p id="generalArea-hint" className="hint">
          Your town or neighborhood, not your address. Up to {generalAreaMax} characters.
        </p>
        <p id="generalArea-error" className="error-msg">
          Enter your town or neighborhood.
        </p>
      </div>
      <div className="field">
        <label htmlFor="photo">
          {hasPhoto ? "Replace your photo" : "Profile photo"} <span className="hint">(optional)</span>
        </label>
        <input
          id="photo"
          name="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          aria-describedby="photo-hint"
        />
        <p id="photo-hint" className="hint">
          JPEG, PNG, WebP or HEIC, up to 10 MB. We remove location data from photos.
        </p>
      </div>
      {hasPhoto && (
        <div className="field check">
          <input id="removePhoto" name="removePhoto" type="checkbox" value="yes" />
          <label htmlFor="removePhoto">Remove my photo</label>
        </div>
      )}
      <SubmitButton pendingLabel="Saving…" pending={pending}>
        Save profile
      </SubmitButton>
    </form>
  );
}

export function ContactsForm({ phone, email }: { phone: string; email: string }) {
  const [state, action] = useActionState(saveContactsAction, initial);
  const v = state.status === "error" ? state.values : undefined;
  const key = v ? JSON.stringify(v) : `${phone}|${email}`;
  return (
    <form className="stack wide" action={action} aria-labelledby="contacts-heading">
      <Result state={state} testId="contacts-result" />
      <div className="field" key={`p-${key}`}>
        <label htmlFor="phone">
          Phone number <span className="hint">(optional)</span>
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          maxLength={25}
          pattern="\+?[0-9\s\(\).\-]{7,25}"
          defaultValue={v?.phone ?? phone}
          data-error="phone-error"
        />
        <p id="phone-error" className="error-msg">
          Enter a phone number with at least 7 digits, like 555-010-0100.
        </p>
      </div>
      <div className="field" key={`e-${key}`}>
        <label htmlFor="contactEmail">
          Email for contact <span className="hint">(optional)</span>
        </label>
        <input
          id="contactEmail"
          name="contactEmail"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={254}
          defaultValue={v?.contactEmail ?? email}
          aria-describedby="contactEmail-hint"
          data-error="contactEmail-error"
        />
        <p id="contactEmail-hint" className="hint">
          Can differ from the address you sign in with.
        </p>
        <p id="contactEmail-error" className="error-msg">
          Enter a valid email address, like name@example.com.
        </p>
      </div>
      <SubmitButton pendingLabel="Saving…">Save contact details</SubmitButton>
    </form>
  );
}
