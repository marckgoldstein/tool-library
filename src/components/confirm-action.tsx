"use client";

import { useId, useRef } from "react";
import { SubmitButton } from "./submit-button";

/**
 * A button that asks before it acts, using the native <dialog> (D33: platform
 * features first). The dialog holds the real <form>, so nothing is sent until
 * the person confirms. Escape and the cancel button close it without acting;
 * the cancel button gets focus first, so a stray Enter keeps things as they are.
 */
export function ConfirmAction({
  label,
  title,
  children,
  confirmLabel,
  pendingLabel = "Working…",
  cancelLabel = "Cancel",
  action,
  fields,
  variant = "secondary",
  danger = false,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  /** Shown on the confirm button while it sends, e.g. "Removing…". */
  pendingLabel?: string;
  /** Says what stays as it is, e.g. "Keep Ben", "Keep it listed". */
  cancelLabel?: string;
  action: (formData: FormData) => void | Promise<void>;
  fields: Record<string, string>;
  /** How the opening button looks: an outlined button, or a quieter text button for less common actions. */
  variant?: "secondary" | "quiet";
  danger?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const triggerClass = [variant, danger ? "danger" : ""].filter(Boolean).join(" ");
  return (
    <>
      <button type="button" className={triggerClass} onClick={() => ref.current?.showModal()}>
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
            <button type="button" className="secondary" onClick={() => ref.current?.close()} autoFocus>
              {cancelLabel}
            </button>
            <SubmitButton className={danger ? "danger" : undefined} pendingLabel={pendingLabel}>
              {confirmLabel}
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
