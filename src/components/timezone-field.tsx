"use client";

import { useEffect, useRef } from "react";

/**
 * Sends the browser's IANA timezone with the form (R7), so times show in the
 * member's own zone. Without JavaScript the server falls back to the pilot default.
 */
export function TimezoneField({ name = "timezone" }: { name?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  }, []);
  return <input ref={ref} type="hidden" name={name} defaultValue="" />;
}
