import { describe, expect, it } from "vitest";

import {
  isCouponExpired,
  isValidCouponCode,
  normalizeCouponCode,
} from "@/domain/course-commerce";

describe("normalizeCouponCode", () => {
  it("uppercases and strips characters the server would reject", () => {
    expect(normalizeCouponCode("launch 10!")).toBe("LAUNCH10");
    expect(normalizeCouponCode("black-friday_25")).toBe("BLACK-FRIDAY25");
  });

  it("caps the code at 24 characters", () => {
    expect(normalizeCouponCode("A".repeat(40))).toHaveLength(24);
  });

  it("returns an empty string when nothing survives", () => {
    expect(normalizeCouponCode("!!!")).toBe("");
  });
});

describe("isValidCouponCode", () => {
  it("accepts 3-24 chars starting alphanumeric", () => {
    expect(isValidCouponCode("SAVE10")).toBe(true);
    expect(isValidCouponCode("A-1")).toBe(true);
    expect(isValidCouponCode("A".repeat(24))).toBe(true);
  });

  it("rejects short, long, lowercase, and dash-leading codes", () => {
    expect(isValidCouponCode("AB")).toBe(false);
    expect(isValidCouponCode("A".repeat(25))).toBe(false);
    expect(isValidCouponCode("save10")).toBe(false);
    expect(isValidCouponCode("-SAVE")).toBe(false);
  });
});

describe("isCouponExpired", () => {
  const now = new Date("2026-07-10T12:00:00Z");

  it("treats a missing expiry as never expiring", () => {
    expect(isCouponExpired({ expiresAt: undefined }, now)).toBe(false);
  });

  it("flags past and exact-boundary expiries", () => {
    expect(isCouponExpired({ expiresAt: "2026-07-09T00:00:00Z" }, now)).toBe(true);
    expect(isCouponExpired({ expiresAt: "2026-07-10T12:00:00Z" }, now)).toBe(true);
  });

  it("keeps future expiries live", () => {
    expect(isCouponExpired({ expiresAt: "2026-08-01T00:00:00Z" }, now)).toBe(false);
  });
});

