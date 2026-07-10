export const TAX_REGIONS = [
  "United States",
  "Brazil",
  "European Union",
  "United Kingdom",
  "Other",
] as const;

export type TaxRegion = (typeof TAX_REGIONS)[number];

export const COUPON_PERCENT_OPTIONS = [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 90] as const;
export const AFFILIATE_COMMISSION_MIN = 5;
export const AFFILIATE_COMMISSION_MAX = 60;
export const COPRODUCER_SHARE_MIN = 5;
export const COPRODUCER_SHARE_MAX = 90;
/** The primary creator always keeps at least 10% — shares cap at 90 combined. */
export const COPRODUCER_TOTAL_SHARE_CAP = 90;

export type CourseCommerceSettings = {
  courseId: string;
  ownerId: string;
  affiliateEnabled: boolean;
  affiliateCommissionPct: number;
  affiliateApproval: "manual" | "automatic";
  taxCollection: boolean;
  taxRegions: TaxRegion[];
  taxRegistrationId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CourseCoupon = {
  id: string;
  courseId: string;
  ownerId: string;
  code: string;
  percentOff: number;
  maxRedemptions: number;
  redeemedCount: number;
  expiresAt?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CourseCoproducer = {
  id: string;
  courseId: string;
  ownerId: string;
  inviteeEmail: string;
  revenueSharePct: number;
  status: "invited" | "accepted" | "revoked";
  createdAt: string;
  updatedAt: string;
};

export type UpsertCourseCommerceSettingsInput = {
  courseId: string;
  affiliateEnabled: boolean;
  affiliateCommissionPct: number;
  affiliateApproval: "manual" | "automatic";
  taxCollection: boolean;
  taxRegions: TaxRegion[];
  taxRegistrationId?: string;
};

export type CreateCourseCouponInput = {
  courseId: string;
  code: string;
  percentOff: number;
  maxRedemptions: number;
  /** ISO timestamp; omit for a coupon that never expires. */
  expiresAt?: string;
};

export type InviteCourseCoproducerInput = {
  courseId: string;
  email: string;
  sharePct: number;
};

/** Mirrors the server rule: 3-24 chars, A-Z 0-9 dash, starts alphanumeric. */
export const COUPON_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,23}$/;

/** Uppercases and strips anything the server would reject mid-typing. */
export function normalizeCouponCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24);
}

export function isValidCouponCode(code: string): boolean {
  return COUPON_CODE_PATTERN.test(code);
}

export function isCouponExpired(
  coupon: Pick<CourseCoupon, "expiresAt">,
  now: Date = new Date(),
): boolean {
  return Boolean(coupon.expiresAt && new Date(coupon.expiresAt) <= now);
}

/** Share already allocated to live (non-revoked) co-producers. */
export function allocatedCoproducerShare(
  coproducers: Array<Pick<CourseCoproducer, "revenueSharePct" | "status">>,
): number {
  return coproducers
    .filter((coproducer) => coproducer.status !== "revoked")
    .reduce((total, coproducer) => total + coproducer.revenueSharePct, 0);
}

/** Share still available to offer a new co-producer (never below zero). */
export function remainingCoproducerShare(
  coproducers: Array<Pick<CourseCoproducer, "revenueSharePct" | "status">>,
): number {
  return Math.max(
    0,
    COPRODUCER_TOTAL_SHARE_CAP - allocatedCoproducerShare(coproducers),
  );
}
