/** Profile field rules shared by joining (S3), editing a profile and contact details (S4). */
import { DomainError } from "../errors";
import { normalizeEmail } from "../email/normalize";

export const NAME_MAX = 60;
export const GENERAL_AREA_MAX = 40; // R8
export const PHONE_MIN_DIGITS = 7;
export const PHONE_MAX_LENGTH = 25;

const collapse = (value: string) => value.trim().replace(/\s+/g, " ");

export function cleanName(value: string, what: string): string {
  const trimmed = collapse(value);
  if (!trimmed) throw new DomainError("invalid_input", `Enter ${what}.`);
  if (trimmed.length > NAME_MAX) throw new DomainError("invalid_input", `Keep ${what} to ${NAME_MAX} characters or fewer.`);
  return trimmed;
}

export function cleanGeneralArea(value: string): string {
  const area = collapse(value);
  if (!area) throw new DomainError("invalid_input", "Enter your general area, like a town or neighborhood.");
  if (area.length > GENERAL_AREA_MAX) {
    throw new DomainError("invalid_input", `Keep your general area to ${GENERAL_AREA_MAX} characters, like a town or neighborhood.`);
  }
  return area;
}

export function cleanEmail(value: string): string {
  const email = normalizeEmail(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new DomainError("invalid_input", "Enter a valid email address, like name@example.com.");
  }
  return email;
}

/** Phone numbers are kept as typed (members read them, nothing dials them), within sane limits. */
export function cleanPhone(value: string): string {
  const phone = collapse(value);
  const digits = phone.replace(/\D/g, "");
  if (!/^\+?[\d\s().-]+$/.test(phone) || digits.length < PHONE_MIN_DIGITS || phone.length > PHONE_MAX_LENGTH) {
    throw new DomainError("invalid_input", "Enter a phone number with at least 7 digits, like 555-010-0100.");
  }
  return phone;
}
