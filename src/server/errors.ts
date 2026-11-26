/** An expected, user-facing rule violation (not a bug). */
export class DomainError extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "forbidden"
      | "invalid_state"
      | "invalid_input"
      | "conflict"
      | "contact_required"
      | "listing_locked",
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const notFound = (what: string) => new DomainError("not_found", `${what} not found.`);
export const forbidden = (message = "You can't do that.") => new DomainError("forbidden", message);
