"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { SubmitButton } from "@/components/submit-button";
import { TimezoneField } from "@/components/timezone-field";
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
  const [state, action] = useActionState(joinAction.bind(null, token), initial);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state]);
  const v = state.values;
  const key = state.status === "error" ? JSON.stringify(v) : "fresh";

  return (
    <form className="stack wide" action={action} aria-labelledby="join-heading">
      {state.status === "error" && (
        <p ref={errorRef} tabIndex={-1} role="alert" className="error-text" data-testid="join-error">
          {state.message}
        </p>
      )}
      <TimezoneField />

      <fieldset key={`profile-${key}`}>
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
            defaultValue={v?.displayName ?? suggestedName}
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
            defaultValue={v?.generalArea}
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

      <fieldset key={`notices-${key}`}>
        <legend>Before you join</legend>
        <div className="notices">
          {notices.map((n) => (
            <section key={n.id} aria-labelledby={`join-notice-${n.id}`}>
              <h3 id={`join-notice-${n.id}`}>{n.title}</h3>
              <p>{n.body}</p>
            </section>
          ))}
          <p>
            <Link href="/notices" target="_blank">
              Read all notices and how we use your data
            </Link>{" "}
            (opens in a new tab)
          </p>
        </div>
        <div className="field check">
          <input
            id="acceptNotices"
            name="acceptNotices"
            type="checkbox"
            value="yes"
            required
            defaultChecked={v?.acceptedNotices}
            data-error="acceptNotices-error"
          />
          <label htmlFor="acceptNotices">I&apos;ve read these notices and accept them</label>
          <p id="acceptNotices-error" className="error-msg">
            Tick the box to accept the notices. You can&apos;t join without accepting them.
          </p>
        </div>
      </fieldset>

      <SubmitButton pendingLabel="Joining…">Join and email me a sign-in link</SubmitButton>
    </form>
  );
}
