import { describe, expect, it } from "vitest";
import { displayStatus, isOverdue, overlaps, validateRange } from "@/server/loans/rules";
import {
  CANNED_CATEGORIES,
  categoriesFor,
  contactShareText,
  isAllowedTemplate,
  reasonText,
} from "@/content/canned-messages";

const d = (iso: string) => new Date(iso);

describe("loan rules", () => {
  it("treats ranges as half-open", () => {
    const a = { startAt: d("2026-12-01T10:00Z"), endAt: d("2026-12-01T12:00Z") };
    expect(overlaps(a, { startAt: d("2026-12-01T12:00Z"), endAt: d("2026-12-01T13:00Z") })).toBe(false);
    expect(overlaps(a, { startAt: d("2026-12-01T11:59Z"), endAt: d("2026-12-01T13:00Z") })).toBe(true);
  });

  it("derives overdue only for active loans past their end time (D30)", () => {
    const end = d("2026-12-01T12:00Z");
    expect(isOverdue({ status: "active", endAt: end }, d("2026-12-01T12:00:01Z"))).toBe(true);
    expect(isOverdue({ status: "active", endAt: end }, d("2026-12-01T11:59Z"))).toBe(false);
    expect(isOverdue({ status: "returned", endAt: end }, d("2026-12-02T00:00Z"))).toBe(false);
    expect(displayStatus({ status: "active", endAt: end }, d("2026-12-03T00:00Z"))).toBe("overdue");
  });

  it("validates ranges", () => {
    const now = d("2026-12-01T00:00Z");
    expect(validateRange({ startAt: d("2026-12-02T00:00Z"), endAt: d("2026-12-01T00:00Z") }, now)).toMatch(/after/);
    expect(validateRange({ startAt: d("2026-11-01T00:00Z"), endAt: d("2026-11-02T00:00Z") }, now)).toMatch(/future/);
    expect(validateRange({ startAt: d("2026-12-01T01:00Z"), endAt: d("2026-12-01T02:00Z") }, now)).toBeNull();
  });
});

describe("canned message catalog (D24)", () => {
  it("has unique keys", () => {
    const keys = CANNED_CATEGORIES.flatMap((c) => c.messages.map((m) => m.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never shows return options to someone asking about an item", () => {
    const labels = categoriesFor("asker", "before_pickup").map((c) => c.key);
    expect(labels).toEqual(["ask", "courtesy"]);
    expect(isAllowedTemplate("return.done", "asker", "before_pickup")).toBe(false);
    expect(isAllowedTemplate("return.done", "asker", "picked_up")).toBe(true);
    expect(isAllowedTemplate("answer.available", "asker", "before_pickup")).toBe(false);
  });

  it("words contact shares as agreed at sign-off", () => {
    expect(contactShareText("555-0100")).toBe("Here's my contact info: 555-0100");
    expect(reasonText("reason.no_show")).toBe("Didn't show up for pickup.");
  });
});
