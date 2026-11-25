/**
 * Dual-read pricing: legacy course columns OR future offer/price rows.
 * ponytail: no DB tables required yet — pure resolution for checkout/UI.
 */
import {
  paymentTypeFitsFormat,
  type TeacherCourse,
  type TeacherCourseProductFormat,
  type TeacherCoursePaymentType,
} from "@/domain/teacher-course";

export type ProductPrice = {
  id: string;
  offerId: string;
  amountMinor: number;
  currency: string;
  paymentType: TeacherCoursePaymentType;
  stripePriceId?: string | null;
  active?: boolean;
};

export type ProductOffer = {
  id: string;
  courseId: string;
  name: string;
  publicCode?: string | null;
  isDefault?: boolean;
  active?: boolean;
  prices: ProductPrice[];
};

export type ProductPriceSelection = {
  offerId?: string;
  publicCode?: string;
  priceId?: string;
};

export type ResolvedCoursePrice = {
  source: "legacy" | "offer";
  amountMinor: number;
  currency: string;
  paymentType: TeacherCoursePaymentType;
  offerId?: string;
  priceId?: string;
  stripePriceId?: string | null;
};

/**
 * Prefer default active offer's first active price; otherwise legacy course fields.
 */
export function resolveCoursePrice(
  course: Pick<
    TeacherCourse,
    "id" | "priceAmountMinor" | "currency" | "paymentType"
  >,
  offers: ProductOffer[] = [],
  selection: ProductPriceSelection = {},
): ResolvedCoursePrice | null {
  const activeOffers = offers.filter(
    (offer) => offer.active !== false && offer.courseId === course.id,
  );
  const offerId = selection.offerId?.trim();
  const publicCode = selection.publicCode?.trim().toUpperCase();
  const hasExplicitOffer = Boolean(offerId || publicCode);
  const preferred = hasExplicitOffer
    ? activeOffers.find(
        (offer) =>
          (!offerId || offer.id === offerId)
          && (!publicCode || offer.publicCode?.toUpperCase() === publicCode),
      ) ?? null
    : activeOffers.find((offer) => offer.isDefault) ?? activeOffers[0] ?? null;

  if (hasExplicitOffer && !preferred) {
    return null;
  }

  if (preferred) {
    const activePrices = preferred.prices.filter((entry) => entry.active !== false);
    const price = selection.priceId
      ? activePrices.find((entry) => entry.id === selection.priceId) ?? null
      : activePrices[0] ?? null;
    if (selection.priceId && !price) {
      return null;
    }
    if (price && price.amountMinor >= 0) {
      return {
        source: "offer",
        amountMinor: price.amountMinor,
        currency: (price.currency || course.currency || "USD").toUpperCase(),
        paymentType: price.paymentType,
        offerId: preferred.id,
        priceId: price.id,
        stripePriceId: price.stripePriceId,
      };
    }
  }

  if (hasExplicitOffer || selection.priceId) {
    return null;
  }

  const amount = Number(course.priceAmountMinor ?? 0);
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  return {
    source: "legacy",
    amountMinor: amount,
    currency: String(course.currency || "USD").toUpperCase(),
    paymentType: course.paymentType ?? (amount === 0 ? "free" : "one_time"),
  };
}

/** True when checkout can sell without multi-offer tables. */
export function isLegacyOnlyPricing(offers: ProductOffer[]): boolean {
  return offers.length === 0;
}

/**
 * How the course charges, read ONCE.
 *
 * What the person suffered: the same screen read the price in two ways. The
 * price label treated "no price" as free, and the line next to it printed the
 * raw `course.paymentType` — so a draft with paymentType
 * "subscription_monthly" and a zero price said "Free" and "Monthly subscription"
 * at the same time. Here the price rules: with no price, the course is free and
 * the payment type simply DOES NOT APPLY (`null`, the screen shows "—") instead
 * of announcing a charge that will never happen.
 */
export type CoursePricingShape = {
  free: boolean;
  /** null = does not apply (free course). Never a charge type without a price. */
  paymentType: TeacherCoursePaymentType | null;
  amountMinor: number;
  currency: string;
  /** null = installments off or no charge; number = maximum installments. */
  installmentsMax: number | null;
};

export function getCoursePricingShape(
  course: Pick<
    TeacherCourse,
    | "priceAmountMinor"
    | "currency"
    | "paymentType"
    | "installmentsEnabled"
    | "installmentsMax"
  >,
): CoursePricingShape {
  const raw = Number(course.priceAmountMinor ?? 0);
  const amountMinor = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0;
  const free = course.paymentType === "free" || amountMinor === 0;

  return {
    free,
    paymentType: free ? null : course.paymentType ?? "one_time",
    amountMinor,
    currency: String(course.currency || "USD").toUpperCase(),
    installmentsMax:
      free || !course.installmentsEnabled
        ? null
        : Math.max(1, Math.round(Number(course.installmentsMax ?? 1))),
  };
}

/**
 * "How will people pay?": one question, three cards. The card is only a
 * reading of the stored `paymentType`; nothing changes in the database. Monthly
 * fee covers monthly and yearly: an old product that charges once a year stays
 * that way, inside the same card.
 */
export type PaymentChoice = "free" | "one_payment" | "membership";

const paymentChoiceOrder: readonly PaymentChoice[] = ["free", "one_payment", "membership"];

export function paymentChoiceOf(paymentType: TeacherCoursePaymentType): PaymentChoice {
  if (paymentType === "free") return "free";
  return paymentType === "one_time" ? "one_payment" : "membership";
}

/** What to store when the card is chosen. Monthly fee starts out monthly. */
export function paymentTypeOfChoice(choice: PaymentChoice): TeacherCoursePaymentType {
  if (choice === "free") return "free";
  return choice === "one_payment" ? "one_time" : "subscription_monthly";
}

/**
 * The cards for each type, in screen order. The stored card appears even
 * outside the list (product created before the rule): the screen shows what
 * the product is, and publishing asks to change it.
 */
export function paymentChoicesFor(
  format: TeacherCourseProductFormat,
  current?: PaymentChoice,
): PaymentChoice[] {
  return paymentChoiceOrder.filter(
    (choice) => choice === current || paymentTypeFitsFormat(format, paymentTypeOfChoice(choice)),
  );
}

/** How much the yearly plan saves compared with 12 monthly payments. Zero or less: it does not save. */
export function yearlySavingMinor(monthlyMinor: number, yearlyMinor: number): number {
  return monthlyMinor * 12 - yearlyMinor;
}
