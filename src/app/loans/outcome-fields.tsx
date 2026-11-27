"use client";

import { useState } from "react";

type Outcome = "fine" | "damaged" | "not_returned";

/**
 * How the item came back, plus the note. The note is required for damaged or
 * not returned (S20), so the browser asks for it before the dialog sends,
 * instead of the server refusing after the dialog has closed.
 */
export function OutcomeFields({ idPrefix, noteAlwaysRequired = false }: { idPrefix: string; noteAlwaysRequired?: boolean }) {
  const [outcome, setOutcome] = useState<Outcome>("fine");
  const needsNote = noteAlwaysRequired || outcome !== "fine";
  const options: { value: Outcome; label: string }[] = [
    { value: "fine", label: "Came back fine" },
    { value: "damaged", label: "Came back damaged" },
    { value: "not_returned", label: "Didn't come back" },
  ];
  return (
    <>
      <fieldset>
        <legend>Outcome</legend>
        {options.map((o) => (
          <div className="field check" key={o.value}>
            <input
              id={`${idPrefix}-${o.value}`}
              type="radio"
              name="outcome"
              value={o.value}
              checked={outcome === o.value}
              onChange={() => setOutcome(o.value)}
            />
            <label htmlFor={`${idPrefix}-${o.value}`}>{o.label}</label>
          </div>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor={`${idPrefix}-note`}>
          Note{" "}
          <span className="hint">{needsNote ? "(required: say what happened)" : "(optional)"}</span>
        </label>
        <textarea id={`${idPrefix}-note`} name="note" rows={3} maxLength={2000} required={needsNote} />
      </div>
    </>
  );
}
