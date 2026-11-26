"use client";

import { useFormStatus } from "react-dom";

/** A submit button that disables itself while its form is being sent, so it can't post twice. */
export function SubmitButton({
  children,
  pendingLabel,
  className,
  name,
  value,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-disabled={pending} name={name} value={value}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
