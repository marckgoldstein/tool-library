/**
 * Pure loan rules (PRD v1.0 section 5). No database access here, so these
 * are cheap to unit-test and safe to use in UI code.
 */
import type { LoanStatus } from "@/db/schema";

export interface TimeRange {
  startAt: Date;
  endAt: Date;
}

/** Half-open ranges [start, end) overlap. A loan ending at 10:00 doesn't clash with one starting at 10:00. */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

/** Statuses that block other loans' dates (S12, S14). */
export const BLOCKING_STATUSES: LoanStatus[] = ["approved", "active"];

/** Statuses that lock the listing against edits, pause, and delist (D23). */
export const LOCKING_STATUSES: LoanStatus[] = ["approved", "active", "returned"];

/** Statuses that count as "open" for account deletion (D21). */
export const OPEN_STATUSES: LoanStatus[] = ["approved", "active", "returned"];

/** Overdue is derived, never stored (D30): active and past the end time. */
export function isOverdue(loan: { status: LoanStatus; endAt: Date }, now: Date = new Date()): boolean {
  return loan.status === "active" && now.getTime() > loan.endAt.getTime();
}

/** The status shown to people, which adds the derived "overdue" state. */
export type DisplayStatus = LoanStatus | "overdue";
export function displayStatus(loan: { status: LoanStatus; endAt: Date }, now: Date = new Date()): DisplayStatus {
  return isOverdue(loan, now) ? "overdue" : loan.status;
}

export function validateRange(range: TimeRange, now: Date): string | null {
  if (Number.isNaN(range.startAt.getTime()) || Number.isNaN(range.endAt.getTime())) {
    return "Choose a start and end date and time.";
  }
  if (range.endAt <= range.startAt) return "The end must be after the start.";
  if (range.endAt <= now) return "The end must be in the future.";
  return null;
}
