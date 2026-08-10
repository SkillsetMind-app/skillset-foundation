import { describe, expect, it } from "vitest";

import type { CourseCoupon } from "@/domain/course-commerce";
import {
  applyCouponPercentOff,
  redeemCourseCoupon,
} from "@/domain/coupon-redemption";

const baseCoupon = {
  id: "c1",
  courseId: "course-1",
  ownerId: "t1",
  code: "SAVE20",
  percentOff: 20,
  maxRedemptions: 100,
  redeemedCount: 1,
  active: true,
  expiresAt: undefined,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as CourseCoupon;

describe("coupon-redemption", () => {
  it("applies percent off", () => {
    expect(applyCouponPercentOff(10_000, 20)).toEqual({
      discountMinor: 2000,
      amountMinorAfter: 8000,
    });
  });

  it("redeems an active coupon", () => {
    const result = redeemCourseCoupon({
      amountMinor: 10_000,
      coupon: baseCoupon,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.amountMinorAfter).toBe(8000);
      expect(result.code).toBe("SAVE20");
    }
  });

  it("rejects inactive coupon", () => {
    const result = redeemCourseCoupon({
      amountMinor: 10_000,
      coupon: { ...baseCoupon, active: false },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects maxed coupon", () => {
    const result = redeemCourseCoupon({
      amountMinor: 10_000,
      coupon: { ...baseCoupon, redeemedCount: 100, maxRedemptions: 100 },
    });
    expect(result.ok).toBe(false);
  });

  // null maxRedemptions == unlimited: a redemption count far past any cap must
  // still go through, or "unlimited" silently becomes "capped at whatever the
  // last teacher typed".
  it("redeems an unlimited coupon past any cap", () => {
    const result = redeemCourseCoupon({
      amountMinor: 10_000,
      coupon: { ...baseCoupon, redeemedCount: 999_999, maxRedemptions: null },
    });
    expect(result.ok).toBe(true);
  });
});
