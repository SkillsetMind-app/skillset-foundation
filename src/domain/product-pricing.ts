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

  if (hasExplicitOffer) {
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
