/**
 * PostHog event taxonomy for SkillsetMind.
 *
 * Single source of truth for analytics event names + property shapes.
 * Import the constants instead of using magic strings so we can rename
 * an event in one place if needed.
 *
 * Design rules:
 *  - Event names are `snake_case` and describe a past action (`checkout_completed`).
 *  - Money is always sent as `_minor` integer + `currency` string.
 *  - Sensitive PII is never sent; we send IDs and references only.
 */

import { captureEvent } from "./client";

export const EVENTS = {
  USER_SIGNED_UP: "user_signed_up",
  TEACHER_KYC_SUBMITTED: "teacher_kyc_submitted",
  TEACHER_KYC_APPROVED: "teacher_kyc_approved",
  COURSE_DRAFT_CREATED: "course_draft_created",
  COURSE_PUBLISHED: "course_published",
  COURSE_VIEWED: "course_viewed",
  CHECKOUT_STARTED: "checkout_started",
  CHECKOUT_COMPLETED: "checkout_completed",
  CHECKOUT_FAILED: "checkout_failed",
  LESSON_STARTED: "lesson_started",
  LESSON_COMPLETED: "lesson_completed",
  COURSE_COMPLETED: "course_completed",
  CREDENTIAL_ISSUED: "credential_issued",
  REFUND_REQUESTED: "refund_requested",
  PAYOUT_RELEASED: "payout_released",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

export type UserSignedUpProps = {
  role: "student" | "teacher";
  source?: string;
};

export type TeacherKycSubmittedProps = {
  teacher_id: string;
};

export type CourseDraftCreatedProps = {
  course_id: string;
  teacher_id: string;
};

export type CoursePublishedProps = {
  course_id: string;
  teacher_id: string;
  modules_count: number;
  lessons_count: number;
};

export type CourseViewedProps = {
  course_id: string;
  slug?: string;
  source?: "search" | "category" | "featured" | "direct" | "instructor";
};

export type CheckoutStartedProps = {
  course_id: string;
  price_minor: number;
  currency: string;
  coupon_code?: string;
};

export type CheckoutCompletedProps = {
  order_id: string;
  course_id: string;
  teacher_id: string;
  gross_minor: number;
  platform_fee_bps: number;   // CRITICAL: detect C1 leak (any value === 0 is suspicious)
  platform_fee_minor: number;
  currency: string;
};

export type CheckoutFailedProps = {
  course_id: string;
  reason: string;
};

export type LessonStartedProps = {
  course_id: string;
  lesson_id: string;
  position: number;
};

export type LessonCompletedProps = {
  course_id: string;
  lesson_id: string;
  position: number;
  duration_seconds?: number;
};

export type CourseCompletedProps = {
  course_id: string;
  lessons_completed: number;
};

export type CredentialIssuedProps = {
  credential_id: string;
  course_id: string;
  user_id: string;
};

export type RefundRequestedProps = {
  order_id: string;
  course_id: string;
  reason?: string;
  progress_pct?: number;
};

export type PayoutReleasedProps = {
  ledger_id: string;
  teacher_id: string;
  amount_minor: number;
  currency: string;
};

/**
 * Typed event capture helpers. Use these instead of `posthog.capture()`
 * directly so TypeScript checks the property shape.
 */
export const track = {
  userSignedUp: (p: UserSignedUpProps) => captureEvent(EVENTS.USER_SIGNED_UP, p),
  teacherKycSubmitted: (p: TeacherKycSubmittedProps) =>
    captureEvent(EVENTS.TEACHER_KYC_SUBMITTED, p),
  teacherKycApproved: (p: TeacherKycSubmittedProps) =>
    captureEvent(EVENTS.TEACHER_KYC_APPROVED, p),
  courseDraftCreated: (p: CourseDraftCreatedProps) =>
    captureEvent(EVENTS.COURSE_DRAFT_CREATED, p),
  coursePublished: (p: CoursePublishedProps) =>
    captureEvent(EVENTS.COURSE_PUBLISHED, p),
  courseViewed: (p: CourseViewedProps) => captureEvent(EVENTS.COURSE_VIEWED, p),
  checkoutStarted: (p: CheckoutStartedProps) =>
    captureEvent(EVENTS.CHECKOUT_STARTED, p),
  checkoutCompleted: (p: CheckoutCompletedProps) =>
    captureEvent(EVENTS.CHECKOUT_COMPLETED, p),
  checkoutFailed: (p: CheckoutFailedProps) =>
    captureEvent(EVENTS.CHECKOUT_FAILED, p),
  lessonStarted: (p: LessonStartedProps) =>
    captureEvent(EVENTS.LESSON_STARTED, p),
  lessonCompleted: (p: LessonCompletedProps) =>
    captureEvent(EVENTS.LESSON_COMPLETED, p),
  courseCompleted: (p: CourseCompletedProps) =>
    captureEvent(EVENTS.COURSE_COMPLETED, p),
  credentialIssued: (p: CredentialIssuedProps) =>
    captureEvent(EVENTS.CREDENTIAL_ISSUED, p),
  refundRequested: (p: RefundRequestedProps) =>
    captureEvent(EVENTS.REFUND_REQUESTED, p),
  payoutReleased: (p: PayoutReleasedProps) =>
    captureEvent(EVENTS.PAYOUT_RELEASED, p),
};
