export const TAX_REGIONS = [
  "United States",
  "Brazil",
  "European Union",
  "United Kingdom",
  "Other",
] as const;

export type TaxRegion = (typeof TAX_REGIONS)[number];

export const COUPON_PERCENT_OPTIONS = [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 90] as const;

export type CourseCommerceSettings = {
  courseId: string;
  ownerId: string;
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
  /** null == unlimited redemptions (the marketplace default). */
  maxRedemptions: number | null;
  redeemedCount: number;
  expiresAt?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UpsertCourseCommerceSettingsInput = {
  courseId: string;
  taxCollection: boolean;
  taxRegions: TaxRegion[];
  taxRegistrationId?: string;
};

export type CreateCourseCouponInput = {
  courseId: string;
  code: string;
  percentOff: number;
  /** null for unlimited redemptions. */
  maxRedemptions: number | null;
  /** ISO timestamp; omit for a coupon that never expires. */
  expiresAt?: string;
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
