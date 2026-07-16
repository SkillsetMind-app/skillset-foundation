import { describe, expect, it } from "vitest";

import type { CourseSubscription } from "@/domain/course-subscription";
import {
  buildCreatorRenewalHistory,
  calculateCreatorSubscriptionMetrics,
} from "@/domain/creator-subscriptions";
import type { Order } from "@/domain/order";
import type { PayoutLedgerEntry } from "@/domain/payout-ledger";
import type { TeacherCourse } from "@/domain/teacher-course";
import { rowToCourseSubscription } from "@/lib/data/course-subscriptions";

const now = new Date("2026-07-15T12:00:00.000Z");

type ContractSnapshotFields = {
  priceAmountMinor?: number | null;
  currency?: string | null;
  offerId?: string | null;
  priceId?: string | null;
};

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
  options: Partial<CourseSubscription & ContractSnapshotFields> = {},
): CourseSubscription & ContractSnapshotFields {
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
  it("uses invoice snapshots and contracted cadence after a course price changes", () => {
    const subscriptions = [
      subscription("monthly", "monthly-brl", "active", {
        interval: "month",
        latestInvoiceId: "in-monthly",
        priceAmountMinor: 10_000,
        currency: "BRL",
        offerId: "offer-monthly",
        priceId: "price-monthly",
      }),
      subscription("yearly", "yearly-brl", "active", {
        interval: "year",
        cancelAtPeriodEnd: true,
        latestInvoiceId: "in-yearly",
        priceAmountMinor: 120_000,
        currency: "BRL",
      }),
      subscription("past-due", "past-due-brl", "past_due", {
        interval: "month",
        pastDue: true,
        latestInvoiceId: "in-past-due",
        priceAmountMinor: 10_000,
        currency: "BRL",
      }),
      subscription("usd", "monthly-usd", "active", {
        interval: "month",
        latestInvoiceId: "in-usd",
        priceAmountMinor: 5_000,
        currency: "USD",
      }),
      subscription("recent-cancel", "monthly-brl", "canceled"),
      subscription("old-cancel", "monthly-brl", "canceled", {
        updatedAt: "2026-04-01T12:00:00.000Z",
      }),
    ];
    const courses = [
      course("monthly-brl", 99_000, "BRL", "subscription_monthly"),
      course("yearly-brl", 999_000, "BRL", "subscription_yearly"),
      course("past-due-brl", 99_000, "BRL", "subscription_monthly"),
      course("monthly-usd", 99_000, "USD", "subscription_monthly"),
    ];
    const orders = [
      { id: "in-monthly", amountMinor: 10_000, currency: "BRL" },
      { id: "in-yearly", amountMinor: 120_000, currency: "BRL" },
      { id: "in-past-due", amountMinor: 10_000, currency: "BRL" },
      { id: "in-usd", amountMinor: 5_000, currency: "USD" },
    ] as Order[];

    expect(calculateCreatorSubscriptionMetrics(
      subscriptions,
      courses,
      now,
      { orders, ledgers: [] },
    )).toEqual({
      activeCount: 3,
      pastDueCount: 1,
      cancelScheduledCount: 1,
      canceledLast30Days: 1,
      observedChurnRate: 20,
      mrrByCurrency: [
        { currency: "BRL", amountMinor: 30_000 },
        { currency: "USD", amountMinor: 5_000 },
      ],
      mrrSnapshotMissingCount: 0,
      mrrLegacyFallbackCount: 0,
    });
  });

  it("uses the latest recurring ledger snapshot as a fallback and reports gaps", () => {
    const subscriptions = [
      subscription("ledger-backed", "course-1", "active", {
        interval: "year",
        priceAmountMinor: null,
        currency: "BRL",
      }),
      subscription("missing-price", "course-2", "active", { interval: "month" }),
      subscription("missing-cadence", "course-3", "past_due", {
        latestInvoiceId: "in-no-cadence",
      }),
    ];
    const ledgers = [
      {
        id: "in-old",
        subscriptionId: "ledger-backed",
        kind: "course_subscription",
        grossAmountMinor: 120_000,
        currency: "BRL",
        createdAt: "2026-06-01T00:00:00.000Z",
      },
      {
        id: "in-new",
        subscriptionId: "ledger-backed",
        kind: "course_subscription",
        grossAmountMinor: 240_000,
        currency: "BRL",
        createdAt: "2026-07-01T00:00:00.000Z",
      },
    ] as PayoutLedgerEntry[];
    const orders = [
      { id: "in-no-cadence", amountMinor: 5_000, currency: "USD" },
    ] as Order[];

    const metrics = calculateCreatorSubscriptionMetrics(
      subscriptions,
      [],
      now,
      { orders, ledgers },
    );

    expect(metrics.mrrByCurrency).toEqual([
      { currency: "BRL", amountMinor: 20_000 },
    ]);
    expect(metrics.mrrSnapshotMissingCount).toBe(2);
    expect(metrics.mrrLegacyFallbackCount).toBe(1);
  });

  it("returns honest zeroes when there is no recurring activity", () => {
    expect(calculateCreatorSubscriptionMetrics([], [], now, {
      orders: [],
      ledgers: [],
    })).toEqual({
      activeCount: 0,
      pastDueCount: 0,
      cancelScheduledCount: 0,
      canceledLast30Days: 0,
      observedChurnRate: 0,
      mrrByCurrency: [],
      mrrSnapshotMissingCount: 0,
      mrrLegacyFallbackCount: 0,
    });
  });
});

describe("rowToCourseSubscription", () => {
  it("maps the immutable contract pricing identity", () => {
    const row = {
      cancel_at_period_end: false,
      course_id: "course-1",
      course_slug: "course-1",
      created_at: "2026-07-15T10:00:00.000Z",
      current_period_end: "2026-08-15T10:00:00.000Z",
      currency: "BRL",
      id: "sub-1",
      interval: "month",
      latest_invoice_id: "in-1",
      offer_id: "offer-1",
      past_due: false,
      price_amount_minor: 9900,
      price_id: "price-1",
      status: "active",
      stripe_customer_id: "cus-1",
      stripe_subscription_id: "sub-1",
      teacher_id: "teacher-1",
      updated_at: "2026-07-15T10:00:00.000Z",
      user_id: "learner-1",
    } as Parameters<typeof rowToCourseSubscription>[0];

    expect(rowToCourseSubscription(row)).toMatchObject({
      priceAmountMinor: 9900,
      currency: "BRL",
      offerId: "offer-1",
      priceId: "price-1",
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
