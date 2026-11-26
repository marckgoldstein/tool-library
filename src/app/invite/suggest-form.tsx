"use client";

import { useActionState, useEffect, useRef } from "react";
import { SubmitButton } from "@/components/submit-button";
import { suggestAction, type SuggestState } from "./actions";

const initial: SuggestState = { status: "idle" };

export function SuggestForm() {
  const [state, action] = useActionState(suggestAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state.status === "sent") formRef.current?.reset();
    if (state.status !== "idle") statusRef.current?.focus();
  }, [state]);

  // A new key after each result remounts the fields, so echoed values show on an error.
  const key = state.status === "error" ? JSON.stringify(state.values) : "fresh";

  return (
    <form ref={formRef} className="stack" action={action} aria-labelledby="suggest-heading">
      {state.status !== "idle" && (
        <p
          ref={statusRef}
          tabIndex={-1}
          role={state.status === "error" ? "alert" : "status"}
          className={state.status === "error" ? "error-text" : "notice success"}
          data-testid="suggest-result"
        >
          {state.message}
        </p>
      )}
      <div className="field" key={`name-${key}`}>
        <label htmlFor="name">Their name</label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="off"
          required
          maxLength={60}
          defaultValue={state.values?.name}
          data-error="name-error"
          enterKeyHint="next"
        />
        <p id="name-error" className="error-msg">
          Enter the name of the person you&apos;re suggesting.
        </p>
      </div>
      <div className="field" key={`email-${key}`}>
        <label htmlFor="email">Their email address</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          maxLength={254}
          defaultValue={state.values?.email}
          aria-describedby="email-hint"
          data-error="email-error"
          enterKeyHint="send"
        />
        <p id="email-hint" className="hint">
          Their invite goes to this address, so it has to be one they check.
        </p>
        <p id="email-error" className="error-msg">
          Enter a valid email address, like name@example.com.
        </p>
      </div>
      <SubmitButton pendingLabel="Sending suggestion…">Suggest this person</SubmitButton>
    </form>
  );
}
