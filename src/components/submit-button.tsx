"use client";

import { useFormStatus } from "react-dom";

/**
 * A submit button that disables itself while its form is being sent, so it can't post twice.
 * Forms submitted from an onSubmit handler (not the `action` prop) pass `pending` themselves.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className,
  name,
  value,
  pending: pendingProp,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  name?: string;
  value?: string;
  pending?: boolean;
}) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <button type="submit" className={className} disabled={pending} aria-disabled={pending} name={name} value={value}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
