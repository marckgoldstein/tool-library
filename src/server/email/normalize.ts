/** Email addresses are compared and stored trimmed and lower-cased. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
