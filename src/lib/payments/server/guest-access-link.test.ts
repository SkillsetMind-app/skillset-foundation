import { describe, expect, it } from "vitest";

import { randomStrongPassword } from "@/lib/payments/server/guest-access-link";

// The project's Auth rules: lowercase, uppercase, digit and symbol, 8 or more.
const SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./~`";

describe("randomStrongPassword", () => {
  it("always carries all four required classes and is long", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const value = randomStrongPassword();
      seen.add(value);
      expect(value.length).toBeGreaterThanOrEqual(8);
      expect(/[a-z]/.test(value)).toBe(true);
      expect(/[A-Z]/.test(value)).toBe(true);
      expect(/[0-9]/.test(value)).toBe(true);
      expect([...value].some((char) => SYMBOLS.includes(char))).toBe(true);
    }
    // Random every time.
    expect(seen.size).toBe(1000);
  });
});
