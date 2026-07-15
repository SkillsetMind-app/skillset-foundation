import { describe, expect, it } from "vitest";

import {
  isLegacyOnlyPricing,
  resolveCoursePrice,
  type ProductOffer,
} from "@/domain/product-pricing";

const course = {
  id: "course-1",
  priceAmountMinor: 9900,
  currency: "brl",
  paymentType: "one_time" as const,
};

describe("resolveCoursePrice", () => {
  it("uses legacy course columns when no offers exist", () => {
    const resolved = resolveCoursePrice(course, []);
    expect(resolved).toEqual({
      source: "legacy",
      amountMinor: 9900,
      currency: "BRL",
      paymentType: "one_time",
    });
    expect(isLegacyOnlyPricing([])).toBe(true);
  });

  it("prefers default offer active price over legacy", () => {
    const offers: ProductOffer[] = [
      {
        id: "offer-a",
        courseId: "course-1",
        name: "Default",
        isDefault: true,
        prices: [
          {
            id: "price-a",
            offerId: "offer-a",
            amountMinor: 14900,
            currency: "BRL",
            paymentType: "subscription_monthly",
            stripePriceId: "price_123",
          },
        ],
      },
    ];
    const resolved = resolveCoursePrice(course, offers);
    expect(resolved?.source).toBe("offer");
    expect(resolved?.amountMinor).toBe(14900);
    expect(resolved?.paymentType).toBe("subscription_monthly");
    expect(resolved?.stripePriceId).toBe("price_123");
  });

  it("falls back to legacy when offer has no prices", () => {
    const offers: ProductOffer[] = [
      {
        id: "empty",
        courseId: "course-1",
        name: "Empty",
        isDefault: true,
        prices: [],
      },
    ];
    expect(resolveCoursePrice(course, offers)?.source).toBe("legacy");
  });
});
