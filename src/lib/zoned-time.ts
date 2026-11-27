/**
 * Wall-clock times in a member's own timezone (R7) <-> UTC instants, without a
 * date library. `datetime-local` inputs give "YYYY-MM-DDTHH:mm" with no zone; the
 * member's IANA zone (captured at join) says what that means.
 */

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** How far `zone` is ahead of UTC at this instant, in ms. */
function offsetAt(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** "2026-12-01T09:30" in America/New_York -> the UTC instant. Returns null for malformed input. */
export function zonedLocalToUtc(local: string, zone: string): Date | null {
  const m = LOCAL.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes settle the offset across a DST change.
  let guess = wall - offsetAt(new Date(wall), zone);
  guess = wall - offsetAt(new Date(guess), zone);
  const result = new Date(guess);
  return Number.isNaN(result.getTime()) ? null : result;
}

/**
 * A datetime-local `min` that lines up with `step` (minutes). Browsers count steps
 * from `min`, so an unaligned min (12:37 with 15-minute steps) makes 09:00 invalid.
 */
export function alignedLocalMin(instant: Date, zone: string, stepMinutes = 15): string {
  const local = utcToZonedLocal(instant, zone);
  const minutes = Number(local.slice(14, 16));
  const floored = Math.floor(minutes / stepMinutes) * stepMinutes;
  return `${local.slice(0, 14)}${String(floored).padStart(2, "0")}`;
}

/** A UTC instant -> "YYYY-MM-DDTHH:mm" on the wall clock in `zone`, for a datetime-local value. */
export function utcToZonedLocal(instant: Date, zone: string): string {
  const local = new Date(instant.getTime() + offsetAt(instant, zone));
  return local.toISOString().slice(0, 16);
}
