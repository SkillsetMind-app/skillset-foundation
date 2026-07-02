import { describe, expect, it } from "vitest";

import { toDate } from "@/lib/format-date";

describe("toDate", () => {
  it("parses ISO strings (the Postgres shape that was silently failing)", () => {
    expect(toDate("2026-07-02T10:00:00.000Z")?.toISOString()).toBe(
      "2026-07-02T10:00:00.000Z",
    );
  });

  it("passes Date and epoch-millis numbers through", () => {
    const now = new Date();
    expect(toDate(now)).toBe(now);
    expect(toDate(0)?.getTime()).toBe(0);
    expect(toDate(1_700_000_000_000)?.getTime()).toBe(1_700_000_000_000);
  });

  it("still accepts the three legacy Firestore shapes", () => {
    expect(toDate({ seconds: 1_700_000_000 })?.getTime()).toBe(1_700_000_000_000);
    expect(toDate({ toMillis: () => 1_700_000_000_000 })?.getTime()).toBe(
      1_700_000_000_000,
    );
    expect(
      toDate({ toDate: () => new Date(1_700_000_000_000) })?.getTime(),
    ).toBe(1_700_000_000_000);
  });

  it("returns null for empty/invalid so callers keep their fallback", () => {
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate("not a date")).toBeNull();
    expect(toDate({})).toBeNull();
  });
});
