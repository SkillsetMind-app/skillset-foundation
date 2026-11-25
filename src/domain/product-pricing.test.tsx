import { describe, expect, it } from "vitest";

import {
  getCoursePricingShape,
  isLegacyOnlyPricing,
  paymentChoiceOf,
  paymentChoicesFor,
  paymentTypeOfChoice,
  resolveCoursePrice,
  yearlySavingMinor,
  type ProductOffer,
} from "@/domain/product-pricing";
import { paymentTypeFitsFormat } from "@/domain/teacher-course";

const course = {
  id: "course-1",
  priceAmountMinor: 9900,
  currency: "brl",
  paymentType: "one_time" as const,
};

describe("resolveCoursePrice", () => {
  it("never charges the legacy price for a missing explicit price ID", () => {
    expect(resolveCoursePrice(course, [], { priceId: "removed-price" })).toBeNull();
  });
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
    expect(resolveCoursePrice(course, offers, { offerId: "empty" })).toBeNull();
  });

  it("resolves an explicitly selected non-default offer by public code", () => {
    const offers: ProductOffer[] = [
      {
        id: "offer-default",
        courseId: "course-1",
        name: "Standard",
        isDefault: true,
        prices: [
          {
            id: "price-default",
            offerId: "offer-default",
            amountMinor: 9900,
            currency: "BRL",
            paymentType: "one_time",
          },
        ],
      },
      {
        id: "offer-launch",
        courseId: "course-1",
        name: "Launch",
        publicCode: "LAUNCH",
        prices: [
          {
            id: "price-launch",
            offerId: "offer-launch",
            amountMinor: 7900,
            currency: "BRL",
            paymentType: "one_time",
          },
        ],
      },
    ];

    expect(
      resolveCoursePrice(course, offers, { publicCode: "launch" }),
    ).toMatchObject({
      source: "offer",
      offerId: "offer-launch",
      priceId: "price-launch",
      amountMinor: 7900,
    });
  });

  it("never falls back when an explicit offer selection is invalid", () => {
    const offers: ProductOffer[] = [
      {
        id: "offer-default",
        courseId: "course-1",
        name: "Standard",
        isDefault: true,
        prices: [
          {
            id: "price-default",
            offerId: "offer-default",
            amountMinor: 9900,
            currency: "BRL",
            paymentType: "one_time",
          },
        ],
      },
    ];

    expect(
      resolveCoursePrice(course, offers, { publicCode: "missing" }),
    ).toBeNull();
  });
});

describe("getCoursePricingShape", () => {
  // The screen showed "Free" and "Monthly subscription" together in the same draft.
  it("a course with no price is free, and the payment type does not apply", () => {
    const shape = getCoursePricingShape({
      priceAmountMinor: 0,
      currency: "usd",
      paymentType: "subscription_monthly",
      installmentsEnabled: true,
      installmentsMax: 12,
    });

    expect(shape.free).toBe(true);
    expect(shape.paymentType).toBeNull();
    expect(shape.installmentsMax).toBeNull();
    expect(shape.amountMinor).toBe(0);
  });

  it("a null or negative price is also free", () => {
    expect(getCoursePricingShape({ priceAmountMinor: null }).free).toBe(true);
    expect(getCoursePricingShape({ priceAmountMinor: -100 }).free).toBe(true);
  });

  it("a subscription with a price keeps its type and the currency in uppercase", () => {
    const shape = getCoursePricingShape({
      priceAmountMinor: 2900,
      currency: "brl",
      paymentType: "subscription_monthly",
    });

    expect(shape).toEqual({
      free: false,
      paymentType: "subscription_monthly",
      amountMinor: 2900,
      currency: "BRL",
      installmentsMax: null,
    });
  });

  it("a paid course with no stored paymentType sells as a one-time purchase and counts the installments", () => {
    const shape = getCoursePricingShape({
      priceAmountMinor: 9900,
      installmentsEnabled: true,
      installmentsMax: 6,
    });

    expect(shape.paymentType).toBe("one_time");
    expect(shape.installmentsMax).toBe(6);
    expect(shape.currency).toBe("USD");
  });
});

// "How will people pay?": three cards, read from what is already stored.
describe("os cartoes de pagamento", () => {
  // Each form stored today lands on one card, changing nothing: the yearly one
  // alone (old product) stays under Monthly fee, as yearly.
  it.each([
    ["free", "free"],
    ["one_time", "one_payment"],
    ["subscription_monthly", "membership"],
    ["subscription_yearly", "membership"],
  ] as const)("%s appears on the %s card", (paymentType, choice) => {
    expect(paymentChoiceOf(paymentType)).toBe(choice);
  });

  it("choosing a card stores its form; Monthly fee starts out monthly", () => {
    expect(paymentTypeOfChoice("free")).toBe("free");
    expect(paymentTypeOfChoice("one_payment")).toBe("one_time");
    expect(paymentTypeOfChoice("membership")).toBe("subscription_monthly");
  });

  it("each type shows its cards, in screen order", () => {
    expect(paymentChoicesFor("course")).toEqual(["free", "one_payment", "membership"]);
    expect(paymentChoicesFor("community")).toEqual(["free", "membership"]);
    expect(paymentChoicesFor("live_event")).toEqual(["free", "one_payment"]);
    expect(paymentChoicesFor("ebook")).toEqual(["free", "one_payment"]);
  });

  // Product created before the rule: the screen shows what it is.
  it("the stored card appears even outside the type's list", () => {
    expect(paymentChoicesFor("community", "one_payment")).toEqual(["free", "one_payment", "membership"]);
    expect(paymentChoicesFor("live_event", "membership")).toEqual(["free", "one_payment", "membership"]);
    expect(paymentChoicesFor("ebook", "one_payment")).toEqual(["free", "one_payment"]);
  });

  // Mirror of course_payment_type_fits_format (20261007030000).
  it("the forms each type accepts", () => {
    const types = ["free", "one_time", "subscription_monthly", "subscription_yearly"] as const;
    const accepted = (format: Parameters<typeof paymentTypeFitsFormat>[0]) =>
      types.filter((type) => paymentTypeFitsFormat(format, type));
    expect(accepted("course")).toEqual(["free", "one_time", "subscription_monthly", "subscription_yearly"]);
    expect(accepted("community")).toEqual(["free", "subscription_monthly", "subscription_yearly"]);
    expect(accepted("live_event")).toEqual(["free", "one_time"]);
    expect(accepted("ebook")).toEqual(["free", "one_time"]);
  });
});

describe("economia do plano anual", () => {
  it("compares against 12 monthly payments", () => {
    expect(yearlySavingMinor(2900, 29000)).toBe(5800);
    expect(yearlySavingMinor(2900, 34800)).toBe(0);
    expect(yearlySavingMinor(2900, 40000)).toBe(-5200);
    expect(yearlySavingMinor(1999, 19990)).toBe(3998);
  });
});
