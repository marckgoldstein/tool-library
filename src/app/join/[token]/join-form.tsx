"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { SubmitButton } from "@/components/submit-button";
import { TimezoneField } from "@/components/timezone-field";
import { useKeptFormAction } from "@/components/use-kept-form";
import type { Notice } from "@/content/notices";
import { joinAction, type JoinState } from "./actions";

const initial: JoinState = { status: "idle" };

export function JoinForm({
  token,
  suggestedName,
  notices,
  generalAreaMax,
}: {
  token: string;
  suggestedName: string;
  notices: Notice[];
  generalAreaMax: number;
}) {
  // Kept form: after a server error, typed values and the chosen photo stay in place.
  const { state, formAction, onSubmit, pending } = useKeptFormAction(joinAction.bind(null, token), initial);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state]);

  return (
    <form className="stack wide" action={formAction} onSubmit={onSubmit} aria-labelledby="join-heading">
      {state.status === "error" && (
        <p ref={errorRef} tabIndex={-1} role="alert" className="error-text" data-testid="join-error">
          {state.message}
        </p>
      )}
      <TimezoneField />

      <fieldset>
        <legend>Your profile</legend>
        <p className="hint">Other members see these on your profile and your listings.</p>
        <div className="field">
          <label htmlFor="displayName">Display name</label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            autoComplete="name"
            required
            maxLength={60}
            defaultValue={suggestedName}
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
            aria-describedby="generalArea-hint"
            data-error="generalArea-error"
          />
          <p id="generalArea-hint" className="hint">
            Your town or neighborhood, not your address. Up to {generalAreaMax} characters. It helps people plan
            pickups.
          </p>
          <p id="generalArea-error" className="error-msg">
            Enter your town or neighborhood.
          </p>
        </div>
        <div className="field">
          <label htmlFor="photo">
            Profile photo <span className="hint">(optional)</span>
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
      </fieldset>

      <fieldset>
        <legend>Before you join</legend>
        <p className="hint">A few plain-language notices. Open any of them to read it in full.</p>
        <div className="notices">
          {notices.map((n) => (
            <details key={n.id}>
              <summary>
                <span>
                  <strong>{n.title}:</strong> {n.summary}
                </span>
              </summary>
              <p>{n.body}</p>
            </details>
          ))}
        </div>
        <p className="hint">
          <Link href="/notices" target="_blank">
            All notices and how we use your data
          </Link>{" "}
          (opens in a new tab)
        </p>
        <div className="field check">
          <input
            id="acceptNotices"
            name="acceptNotices"
            type="checkbox"
            value="yes"
            required
            data-error="acceptNotices-error"
          />
          <label htmlFor="acceptNotices">I&apos;ve read these notices and accept them</label>
          <p id="acceptNotices-error" className="error-msg">
            Tick the box to accept the notices. You can&apos;t join without accepting them.
          </p>
        </div>
      </fieldset>

      <SubmitButton pendingLabel="Joining…" pending={pending}>
        Join and email me a sign-in link
      </SubmitButton>
    </form>
  );
}
