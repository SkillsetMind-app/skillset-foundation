import { describe, expect, it } from "vitest";

import {
  affiliateCommissionLedgerId,
  computeAffiliateCommissionMinor,
  parseAffiliateSettlementFromMetadata,
  resolveAffiliateAttribution,
  teacherNetAfterAffiliate,
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

  it("parses settlement from Stripe metadata (stamped minor wins)", () => {
    const settled = parseAffiliateSettlementFromMetadata(
      {
        affiliateUserId: "aff-9",
        affiliateCommissionPct: "25",
        affiliateCommissionMinor: "1500",
      },
      10_000,
      { buyerUserId: "buyer-1", teacherUserId: "teacher-1" },
    );
    expect(settled).toEqual({
      affiliateUserId: "aff-9",
      commissionPct: 25,
      commissionMinor: 1500,
    });
  });

  it("falls back to pct when minor missing and rejects self-affiliate", () => {
    expect(
      parseAffiliateSettlementFromMetadata(
        { affiliateUserId: "aff-1", affiliateCommissionPct: "10" },
        10_000,
      )?.commissionMinor,
    ).toBe(1000);

    expect(
      parseAffiliateSettlementFromMetadata(
        { affiliateUserId: "buyer-1", affiliateCommissionPct: "10" },
        10_000,
        { buyerUserId: "buyer-1" },
      ),
    ).toBeNull();
  });

  it("builds ledger id and reduces teacher net", () => {
    expect(affiliateCommissionLedgerId("ord-1")).toBe("ord-1__aff");
    expect(teacherNetAfterAffiliate(7000, 2000)).toBe(5000);
    expect(teacherNetAfterAffiliate(1000, 5000)).toBe(0);
  });
});
