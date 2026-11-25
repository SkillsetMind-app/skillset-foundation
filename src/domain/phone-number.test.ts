import { describe, expect, it } from "vitest";

import { isValidPhoneNumber } from "@/domain/user-profile";

// The profile phone field accepts the way people write it; what counts is the
// digits (8 to 15).
describe("isValidPhoneNumber", () => {
  it("accepts everyday formats", () => {
    expect(isValidPhoneNumber("+55 (16) 99999-1234")).toBe(true);
    expect(isValidPhoneNumber("16999991234")).toBe(true);
    expect(isValidPhoneNumber("+1 555 123 4567")).toBe(true);
  });

  it("rejects too short, too long and no number", () => {
    expect(isValidPhoneNumber("1234567")).toBe(false);
    expect(isValidPhoneNumber("1234567890123456")).toBe(false);
    expect(isValidPhoneNumber("")).toBe(false);
    expect(isValidPhoneNumber("my phone")).toBe(false);
  });
});
