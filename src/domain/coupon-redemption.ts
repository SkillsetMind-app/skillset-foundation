/**
 * Pure coupon validation for checkout (Hotmart-parity: redeem at purchase).
 * Settlement/affiliate engines stay separate.
 */
import type { CourseCoupon } from "@/domain/course-commerce";
import { isCouponExpired, normalizeCouponCode } from "@/domain/course-commerce";

export type CouponRedemptionResult =
  | {
      ok: true;
      code: string;
      percentOff: number;
      amountMinorAfter: number;
      discountMinor: number;
    }
  | { ok: false; reason: string };

export function applyCouponPercentOff(
  amountMinor: number,
  percentOff: number,
): { amountMinorAfter: number; discountMinor: number } {
  const pct = Math.min(90, Math.max(0, Math.floor(percentOff)));
  const discountMinor = Math.floor((amountMinor * pct) / 100);
  return {
    discountMinor,
    amountMinorAfter: Math.max(0, amountMinor - discountMinor),
  };
}

export function redeemCourseCoupon(input: {
  amountMinor: number;
  coupon: CourseCoupon | null | undefined;
  now?: Date;
}): CouponRedemptionResult {
  const amount = Number(input.amountMinor);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "Invalid price for coupon redemption." };
  }
  const coupon = input.coupon;
  if (!coupon) {
    return { ok: false, reason: "Coupon not found." };
  }
  const code = normalizeCouponCode(coupon.code);
  if (!code) {
    return { ok: false, reason: "Invalid coupon code." };
  }
  if (!coupon.active) {
    return { ok: false, reason: "This coupon is not active." };
  }
  if (isCouponExpired(coupon, input.now)) {
    return { ok: false, reason: "This coupon has expired." };
  }
  if (
    typeof coupon.maxRedemptions === "number"
    && typeof coupon.redeemedCount === "number"
    && coupon.redeemedCount >= coupon.maxRedemptions
  ) {
    return { ok: false, reason: "This coupon has reached its redemption limit." };
  }
  const { amountMinorAfter, discountMinor } = applyCouponPercentOff(
    amount,
    coupon.percentOff,
  );
  if (amountMinorAfter <= 0) {
    return { ok: false, reason: "Coupon would zero out a paid checkout." };
  }
  return {
    ok: true,
    code,
    percentOff: coupon.percentOff,
    amountMinorAfter,
    discountMinor,
  };
}
