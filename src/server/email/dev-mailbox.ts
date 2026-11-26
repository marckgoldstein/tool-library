/** The local mailbox exists only with the dev email transport, and never in production unless explicitly enabled for tests. */
export function devMailboxEnabled(): boolean {
  if (process.env.EMAIL_TRANSPORT !== "dev") return false;
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_MAILBOX === "1";
}
