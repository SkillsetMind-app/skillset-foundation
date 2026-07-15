/**
 * Dual-read pricing: legacy course columns OR future offer/price rows.
 * ponytail: no DB tables required yet — pure resolution for checkout/UI.
 */
import type { TeacherCourse, TeacherCoursePaymentType } from "@/domain/teacher-course";

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
  isDefault?: boolean;
  active?: boolean;
  prices: ProductPrice[];
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
): ResolvedCoursePrice | null {
  const activeOffers = offers.filter(
    (offer) => offer.active !== false && offer.courseId === course.id,
  );
  const preferred =
    activeOffers.find((offer) => offer.isDefault)
    ?? activeOffers[0]
    ?? null;

  if (preferred) {
    const price =
      preferred.prices.find((entry) => entry.active !== false)
      ?? preferred.prices[0]
      ?? null;
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
