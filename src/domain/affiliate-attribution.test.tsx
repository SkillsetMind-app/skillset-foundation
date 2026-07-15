import { describe, expect, it } from "vitest";

import {
  computeAffiliateCommissionMinor,
  resolveAffiliateAttribution,
} from "@/domain/affiliate-attribution";

describe("affiliate-attribution", () => {
  it("computes commission floor percent", () => {
    expect(computeAffiliateCommissionMinor(10_000, 25)).toBe(2500);
  });

  it("attributes a valid affiliate", () => {
    const result = resolveAffiliateAttribution({
      affiliateRef: "aff-1",
      buyerUserId: "buyer-1",
      teacherUserId: "teacher-1",
      affiliateEnabled: true,
      commissionPct: 20,
      amountMinor: 10_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.affiliateUserId).toBe("aff-1");
      expect(result.commissionMinor).toBe(2000);
    }
  });

  it("rejects self-affiliate and disabled program", () => {
    expect(
      resolveAffiliateAttribution({
        affiliateRef: "buyer-1",
        buyerUserId: "buyer-1",
        teacherUserId: "teacher-1",
        affiliateEnabled: true,
        commissionPct: 20,
        amountMinor: 10_000,
      }).ok,
    ).toBe(false);

    expect(
      resolveAffiliateAttribution({
        affiliateRef: "aff-1",
        buyerUserId: "buyer-1",
        teacherUserId: "teacher-1",
        affiliateEnabled: false,
        commissionPct: 20,
        amountMinor: 10_000,
      }).ok,
    ).toBe(false);
  });
});
