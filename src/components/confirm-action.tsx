"use client";

import { useId, useRef } from "react";
import { SubmitButton } from "./submit-button";

/**
 * A button that asks before it acts, using the native <dialog> (D33: platform
 * features first). The dialog holds the real <form>, so nothing is sent until
 * the person confirms. Escape and "Keep it" close it without acting.
 */
export function ConfirmAction({
  label,
  title,
  children,
  confirmLabel,
  action,
  fields,
  danger = false,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  action: (formData: FormData) => void | Promise<void>;
  fields: Record<string, string>;
  danger?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button type="button" className={danger ? "secondary danger" : "secondary"} onClick={() => ref.current?.showModal()}>
        {label}
      </button>
      <dialog ref={ref} aria-labelledby={titleId} className="confirm">
        <form action={action}>
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <h2 id={titleId}>{title}</h2>
          <div className="confirm-body">{children}</div>
          <div className="actions">
            <SubmitButton className={danger ? "danger" : undefined} pendingLabel="Working…">
              {confirmLabel}
            </SubmitButton>
            <button type="button" className="secondary" onClick={() => ref.current?.close()} autoFocus>
              Keep it
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
