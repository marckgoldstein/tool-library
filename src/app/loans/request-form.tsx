"use client";

import { useEffect, useRef } from "react";
import { SubmitButton } from "@/components/submit-button";
import { useKeptFormAction } from "@/components/use-kept-form";
import { requestLoanAction, type RequestState } from "./actions";

const initial: RequestState = { status: "idle" };

/**
 * S12: the borrower picks dates and times; no minimum or maximum (D4). Times are
 * wall-clock times in the member's own timezone (R7), converted on the server.
 */
export function RequestForm({ itemId, ownerFirstName, minLocal, timeZoneLabel }: { itemId: string; ownerFirstName: string; minLocal: string; timeZoneLabel: string }) {
  const { state, formAction, onSubmit, pending } = useKeptFormAction(requestLoanAction.bind(null, itemId), initial);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state]);
  return (
    <form className="stack request-form" action={formAction} onSubmit={onSubmit} aria-labelledby="request-heading">
      <h3 id="request-heading">Request dates</h3>
      {state.status === "error" && (
        <p ref={errorRef} tabIndex={-1} role="alert" className="error-text" data-testid="request-error">
          {state.message}
        </p>
      )}
      <div className="field">
        <label htmlFor="startAt">From</label>
        <input id="startAt" name="startAt" type="datetime-local" required min={minLocal} step={900} data-error="startAt-error" />
        <p id="startAt-error" className="error-msg">
          Choose when you&apos;d pick it up.
        </p>
      </div>
      <div className="field">
        <label htmlFor="endAt">Until</label>
        <input id="endAt" name="endAt" type="datetime-local" required min={minLocal} step={900} data-error="endAt-error" aria-describedby="endAt-hint" />
        <p id="endAt-hint" className="hint">
          Times are in {timeZoneLabel}. Borrow for as long as you need; {ownerFirstName} decides.
        </p>
        <p id="endAt-error" className="error-msg">
          Choose when you&apos;d bring it back.
        </p>
      </div>
      <SubmitButton pendingLabel="Sending request…" pending={pending}>
        Send request to {ownerFirstName}
      </SubmitButton>
    </form>
  );
}
