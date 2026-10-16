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
  // A tela mostrava "Free" e "Monthly subscription" juntos no mesmo rascunho.
  it("um curso sem valor e gratuito, e o tipo de pagamento nao se aplica", () => {
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

  it("preco nulo ou negativo tambem e gratuito", () => {
    expect(getCoursePricingShape({ priceAmountMinor: null }).free).toBe(true);
    expect(getCoursePricingShape({ priceAmountMinor: -100 }).free).toBe(true);
  });

  it("assinatura com valor mantem o tipo e a moeda em maiuscula", () => {
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

  it("curso pago sem paymentType gravado vende avulso e conta as parcelas", () => {
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

// "Como as pessoas vao pagar?": tres cartoes lidos do que ja esta gravado.
describe("os cartoes de pagamento", () => {
  // Cada forma gravada hoje cai num cartao, sem mudar nada: o anual sozinho
  // (produto antigo) fica em Mensalidade, como anual.
  it.each([
    ["free", "free"],
    ["one_time", "one_payment"],
    ["subscription_monthly", "membership"],
    ["subscription_yearly", "membership"],
  ] as const)("%s aparece no cartao %s", (paymentType, choice) => {
    expect(paymentChoiceOf(paymentType)).toBe(choice);
  });

  it("escolher um cartao grava a forma dele; Mensalidade nasce mensal", () => {
    expect(paymentTypeOfChoice("free")).toBe("free");
    expect(paymentTypeOfChoice("one_payment")).toBe("one_time");
    expect(paymentTypeOfChoice("membership")).toBe("subscription_monthly");
  });

  it("cada tipo mostra os seus cartoes, na ordem da tela", () => {
    expect(paymentChoicesFor("course")).toEqual(["free", "one_payment", "membership"]);
    expect(paymentChoicesFor("community")).toEqual(["free", "membership"]);
    expect(paymentChoicesFor("live_event")).toEqual(["free", "one_payment"]);
    expect(paymentChoicesFor("ebook")).toEqual(["free", "one_payment"]);
  });

  // Produto criado antes da regra: a tela mostra o que ele e.
  it("o cartao ja gravado aparece mesmo fora da lista do tipo", () => {
    expect(paymentChoicesFor("community", "one_payment")).toEqual(["free", "one_payment", "membership"]);
    expect(paymentChoicesFor("live_event", "membership")).toEqual(["free", "one_payment", "membership"]);
    expect(paymentChoicesFor("ebook", "one_payment")).toEqual(["free", "one_payment"]);
  });

  // Espelho de course_payment_type_fits_format (20261007030000).
  it("as formas que cada tipo aceita", () => {
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
  it("compara com 12 mensalidades", () => {
    expect(yearlySavingMinor(2900, 29000)).toBe(5800);
    expect(yearlySavingMinor(2900, 34800)).toBe(0);
    expect(yearlySavingMinor(2900, 40000)).toBe(-5200);
    expect(yearlySavingMinor(1999, 19990)).toBe(3998);
  });
});
