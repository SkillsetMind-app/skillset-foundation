import { describe, expect, it } from "vitest";

import { isPlatformFlagOn } from "@/domain/platform-settings";

// The SQL half of this gate is `(ps.value #>> '{}')::boolean` (migration
// 20260810030000). `#>>` extracts text, so a jsonb STRING "true" casts to
// boolean true there. Every TypeScript reader used a strict `=== true`, which
// says false for that same row — the divergence this predicate closes.
describe("isPlatformFlagOn", () => {
  it("is on for a jsonb boolean true (how the flag is written today)", () => {
    expect(isPlatformFlagOn(true)).toBe(true);
  });

  it("is on for a jsonb string \"true\" — the lockout case", () => {
    // Written as '"true"'::jsonb by hand, SQL blocks every creator from
    // creating a course. If TS disagreed, /api/payments/activation/checkout
    // would answer 409 activation_not_required and nobody could pay to
    // unblock themselves.
    expect(isPlatformFlagOn("true")).toBe(true);
  });

  it("is off for every value that is not recognisably on", () => {
    for (const value of [
      false,
      "false",
      null,
      undefined,
      0,
      1,
      "TRUE",
      "yes",
      "",
      {},
      [],
    ]) {
      expect(isPlatformFlagOn(value)).toBe(false);
    }
  });
});
