import { describe, expect, it } from "vitest";

import type { CourseSubscription } from "@/domain/course-subscription";
import {
  buildCreatorRenewalHistory,
  calculateCreatorSubscriptionMetrics,
} from "@/domain/creator-subscriptions";
import type { Order } from "@/domain/order";
import type { PayoutLedgerEntry } from "@/domain/payout-ledger";
import type { TeacherCourse } from "@/domain/teacher-course";

const now = new Date("2026-07-15T12:00:00.000Z");

function course(
  id: string,
  amountMinor: number,
  currency: string,
  paymentType: TeacherCourse["paymentType"],
): TeacherCourse {
  return {
    id,
    ownerId: "teacher-1",
    title: id,
    summary: "",
    category: "Psychology",
    status: "published",
    modules: [],
    lessonCount: 0,
    priceAmountMinor: amountMinor,
    currency,
    paymentType,
  };
}

function subscription(
  id: string,
  courseId: string,
  status: string,
  options: Partial<CourseSubscription> = {},
): CourseSubscription {
  return {
    id,
    userId: `learner-${id}`,
    courseId,
    stripeSubscriptionId: id,
    status,
    updatedAt: "2026-07-10T12:00:00.000Z",
    ...options,
  };
}

describe("calculateCreatorSubscriptionMetrics", () => {
  it("normalizes annual value to MRR and keeps currencies separate", () => {
    const subscriptions = [
      subscription("monthly", "monthly-brl", "active", { interval: "month" }),
      subscription("yearly", "yearly-brl", "active", {
        interval: "year",
        cancelAtPeriodEnd: true,
      }),
      subscription("past-due", "past-due-brl", "past_due", {
        interval: "month",
        pastDue: true,
      }),
      subscription("usd", "monthly-usd", "active", { interval: "month" }),
      subscription("recent-cancel", "monthly-brl", "canceled"),
      subscription("old-cancel", "monthly-brl", "canceled", {
        updatedAt: "2026-04-01T12:00:00.000Z",
      }),
    ];
    const courses = [
      course("monthly-brl", 10_000, "BRL", "subscription_monthly"),
      course("yearly-brl", 120_000, "BRL", "subscription_yearly"),
      course("past-due-brl", 10_000, "BRL", "subscription_monthly"),
      course("monthly-usd", 5_000, "USD", "subscription_monthly"),
    ];

    expect(calculateCreatorSubscriptionMetrics(subscriptions, courses, now)).toEqual({
      activeCount: 3,
      pastDueCount: 1,
      cancelScheduledCount: 1,
      canceledLast30Days: 1,
      observedChurnRate: 20,
      mrrByCurrency: [
        { currency: "BRL", amountMinor: 30_000 },
        { currency: "USD", amountMinor: 5_000 },
      ],
    });
  });

  it("returns honest zeroes when there is no recurring activity", () => {
    expect(calculateCreatorSubscriptionMetrics([], [], now)).toEqual({
      activeCount: 0,
      pastDueCount: 0,
      cancelScheduledCount: 0,
      canceledLast30Days: 0,
      observedChurnRate: 0,
      mrrByCurrency: [],
    });
  });
});

describe("buildCreatorRenewalHistory", () => {
  it("includes recurring ledger facts only and joins buyer/course details from orders", () => {
    const orders = [
      {
        id: "in_new",
        userId: "learner-1",
        teacherId: "teacher-1",
        courseId: "course-1",
        courseSlug: "course-1",
        courseTitle: "Clinical Focus",
        amountMinor: 9900,
        refundedAmountMinor: 0,
        currency: "BRL",
        platformFeeBps: 800,
        status: "paid",
        provider: "stripe",
        checkoutSessionId: null,
        paymentIntentId: "pi_new",
        createdAt: "2026-07-15T10:00:00.000Z",
      },
    ] as Order[];
    const ledgers = [
      {
        id: "in_old",
        orderId: "in_old",
        kind: "course_subscription",
        subscriptionId: "sub_1",
        teacherId: "teacher-1",
        courseId: "course-1",
        paymentId: "pi_old",
        grossAmountMinor: 9900,
        skillsetFeeMinor: 792,
        netAmountMinor: 8808,
        currency: "BRL",
        status: "released",
        createdAt: "2026-06-15T10:00:00.000Z",
      },
      {
        id: "in_new",
        orderId: "in_new",
        kind: "course_subscription",
        subscriptionId: "sub_1",
        teacherId: "teacher-1",
        courseId: "course-1",
        paymentId: "pi_new",
        grossAmountMinor: 9900,
        skillsetFeeMinor: 792,
        netAmountMinor: 8808,
        currency: "BRL",
        status: "in_release",
        createdAt: "2026-07-15T10:00:00.000Z",
      },
      {
        id: "order_once",
        orderId: "order_once",
        kind: "course_one_time",
        teacherId: "teacher-1",
        courseId: "course-1",
        paymentId: "pi_once",
        grossAmountMinor: 20_000,
        skillsetFeeMinor: 1600,
        netAmountMinor: 18_400,
        currency: "BRL",
        status: "released",
        createdAt: "2026-07-14T10:00:00.000Z",
      },
    ] as PayoutLedgerEntry[];

    expect(buildCreatorRenewalHistory(ledgers, orders)).toEqual([
      expect.objectContaining({
        id: "in_new",
        subscriptionId: "sub_1",
        userId: "learner-1",
        courseTitle: "Clinical Focus",
        status: "in_release",
      }),
      expect.objectContaining({
        id: "in_old",
        subscriptionId: "sub_1",
        userId: null,
        courseTitle: "course-1",
      }),
    ]);
  });
});
