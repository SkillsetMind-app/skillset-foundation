import { describe, expect, it } from "vitest";

import {
  addMoney,
  measure,
  parseOverviewPeriod,
  resolveOverviewWindow,
  summarizeActivations,
  summarizeCourses,
  summarizeEnrollments,
  summarizeOrders,
  summarizePublications,
  summarizeUsers,
  type OverviewOrderRow,
} from "./ops-overview";

// Fixtures only: no real numbers, ids or people.
const NOW = new Date("2026-10-05T15:30:00.000Z");

describe("Overview period", () => {
  it("accepts only the three periods and falls back to 7 days for anything else", () => {
    expect(parseOverviewPeriod("today")).toBe("today");
    expect(parseOverviewPeriod("30d")).toBe("30d");
    for (const value of [null, undefined, "", "90d", "TODAY"]) {
      expect(parseOverviewPeriod(value)).toBe("7d");
    }
  });

  it("Today runs from midnight UTC until now and compares with the same hours of yesterday", () => {
    const window = resolveOverviewWindow("today", NOW);
    expect(window.days).toBe(1);
    expect(new Date(window.start).toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(new Date(window.end).toISOString()).toBe("2026-10-05T15:30:00.000Z");
    expect(new Date(window.previousStart).toISOString()).toBe("2026-10-04T00:00:00.000Z");
    expect(new Date(window.previousEnd).toISOString()).toBe("2026-10-04T15:30:00.000Z");
  });

  it("7 and 30 days include today and the previous period has the same length, shifted N days", () => {
    const week = resolveOverviewWindow("7d", NOW);
    expect(new Date(week.start).toISOString()).toBe("2026-09-29T00:00:00.000Z");
    expect(new Date(week.previousStart).toISOString()).toBe("2026-09-22T00:00:00.000Z");
    expect(new Date(week.previousEnd).toISOString()).toBe("2026-09-28T15:30:00.000Z");
    expect(week.end - week.start).toBe(week.previousEnd - week.previousStart);

    const month = resolveOverviewWindow("30d", NOW);
    expect(new Date(month.start).toISOString()).toBe("2026-09-06T00:00:00.000Z");
    expect(new Date(month.previousStart).toISOString()).toBe("2026-08-07T00:00:00.000Z");
    expect(month.end - month.start).toBe(month.previousEnd - month.previousStart);
  });

  it("cuts the day in UTC, not in the browser time zone", () => {
    // 02:00 UTC is still "yesterday" in UTC-3; the cut does not change because of it.
    const window = resolveOverviewWindow("today", new Date("2026-10-05T02:00:00.000Z"));
    expect(new Date(window.start).toISOString()).toBe("2026-10-05T00:00:00.000Z");
    const rows = [
      "2026-10-05T00:00:00.000Z", // first instant of today
      "2026-10-04T23:59:59.999Z", // yesterday, after 02:00: outside the comparison
      "2026-10-04T01:00:00.000Z", // yesterday, before 02:00
    ];
    expect(measure(rows, (row) => row, window)).toMatchObject({ current: 1, previous: 1 });
  });
});

describe("measure", () => {
  it("separates current and previous, ignores anything outside the window and invalid dates", () => {
    const window = resolveOverviewWindow("today", NOW);
    const rows = [
      "2026-10-05T01:00:00Z", // today
      "2026-10-05T15:30:00Z", // exactly now counts
      "2026-10-04T10:00:00Z", // yesterday, before the same time
      "2026-10-04T20:00:00Z", // yesterday, after the same time: outside the comparison
      "2026-10-03T10:00:00Z", // the day before yesterday
      "not-a-date",
      null,
    ];
    expect(measure(rows, (row) => row, window)).toEqual({ current: 2, previous: 1, series: [] });
  });

  it("builds the daily series only for 7 and 30 days, with optional weight", () => {
    const window = resolveOverviewWindow("7d", NOW);
    const rows = [
      { at: "2026-09-29T00:00:00Z", n: 2 },
      { at: "2026-09-29T23:59:59Z", n: 1 },
      { at: "2026-10-05T09:00:00Z", n: 5 },
      { at: "2026-09-25T09:00:00Z", n: 7 },
    ];
    expect(measure(rows, (row) => row.at, window, (row) => row.n)).toEqual({
      current: 8,
      previous: 7,
      series: [3, 0, 0, 0, 0, 0, 5],
    });
  });
});

describe("sign-ups", () => {
  it("counts sign-ups and, among them, who joined as a creator", () => {
    const window = resolveOverviewWindow("7d", NOW);
    const summary = summarizeUsers([
      { created_at: "2026-10-01T10:00:00Z", roles: ["student"] },
      { created_at: "2026-10-02T10:00:00Z", roles: ["student", "teacher"] },
      { created_at: "2026-09-23T10:00:00Z", roles: ["teacher"] },
      { created_at: "2026-10-03T10:00:00Z", roles: null },
    ], window);
    expect(summary.signups).toMatchObject({ current: 3, previous: 1 });
    expect(summary.creators).toMatchObject({ current: 1, previous: 1 });
  });
});

describe("real courses", () => {
  const window = resolveOverviewWindow("7d", NOW);

  it("ignores internal test courses (smoke- and [QA]) in created and in live creators", () => {
    const summary = summarizeCourses([
      { id: "course-a", title: "Real course", owner_id: "creator-1", status: "published", created_at: "2026-10-01T00:00:00Z" },
      { id: "course-b", title: "Another", owner_id: "creator-1", status: "published", created_at: "2026-01-01T00:00:00Z" },
      { id: "course-c", title: "Draft", owner_id: "creator-2", status: "draft", created_at: "2026-10-02T00:00:00Z" },
      { id: "smoke-checkout", title: "Smoke", owner_id: "creator-3", status: "published", created_at: "2026-10-02T00:00:00Z" },
      { id: "course-qa", title: "[QA] Access matrix", owner_id: "creator-4", status: "published", created_at: "2026-10-02T00:00:00Z" },
    ], window);
    expect(summary.created).toMatchObject({ current: 2, previous: 0 });
    expect(summary.liveCreators).toBe(1);
  });

  it("counts each published course once per period and removes the test ones by the stored title", () => {
    const published = summarizePublications([
      { target_id: "course-a", created_at: "2026-10-01T00:00:00Z", metadata: { title: "Real" } },
      { target_id: "course-a", created_at: "2026-10-02T00:00:00Z", metadata: { title: "Real" } },
      { target_id: "course-a", created_at: "2026-09-24T00:00:00Z", metadata: { title: "Real" } },
      { target_id: "course-qa", created_at: "2026-10-02T00:00:00Z", metadata: { title: "[QA] Matrix" } },
      { target_id: "smoke-1", created_at: "2026-10-02T00:00:00Z", metadata: null },
    ], window);
    expect(published).toMatchObject({ current: 1, previous: 1 });
    expect(published.series.reduce((sum, value) => sum + value, 0)).toBe(1);
  });
});

describe("enrollments", () => {
  it("separates paid from free and removes the test course", () => {
    const window = resolveOverviewWindow("7d", NOW);
    const summary = summarizeEnrollments([
      { course_id: "course-a", course_title: "Real", source: "payment", created_at: "2026-10-01T00:00:00Z" },
      { course_id: "course-a", course_title: "Real", source: "subscription", created_at: "2026-10-01T00:00:00Z" },
      { course_id: "course-b", course_title: "Free", source: "free_course", created_at: "2026-10-02T00:00:00Z" },
      { course_id: "course-b", course_title: "Free", source: "admin", created_at: "2026-10-02T00:00:00Z" },
      { course_id: "smoke-x", course_title: "Smoke", source: "payment", created_at: "2026-10-02T00:00:00Z" },
      { course_id: "course-b", course_title: "Free", source: "free_course", created_at: "2026-09-23T00:00:00Z" },
    ], window);
    expect(summary.total).toMatchObject({ current: 4, previous: 1 });
    expect(summary.paid).toMatchObject({ current: 2, previous: 0 });
    expect(summary.free).toMatchObject({ current: 1, previous: 1 });
  });
});

describe("money", () => {
  const window = resolveOverviewWindow("7d", NOW);
  const order = (overrides: Partial<OverviewOrderRow>): OverviewOrderRow => ({
    course_id: "course-a", course_title: "Real", status: "paid", amount_minor: 10_000,
    currency: "USD", platform_fee_bps: 1000, refunded_amount_minor: 0,
    paid_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...overrides,
  });

  it("adds up sales and platform fee per currency, without mixing currencies and without test orders", () => {
    const summary = summarizeOrders([
      order({}),
      order({ amount_minor: 5_000, platform_fee_bps: 500 }),
      order({ currency: "EUR", amount_minor: 2_000, platform_fee_bps: null }),
      order({ paid_at: "2026-09-24T00:00:00Z", updated_at: "2026-09-24T00:00:00Z" }),
      order({ course_id: "smoke-checkout", amount_minor: 99_999 }),
      order({ course_title: "[QA] Matrix", amount_minor: 99_999 }),
      order({ status: "pending", paid_at: null }),
      // A 100% coupon: paid, but nothing was charged. It is not a sale.
      order({ amount_minor: 0 }),
    ], window);
    expect(summary.paidOrders).toMatchObject({ current: 3, previous: 1 });
    // USD (the default currency) first, the rest in alphabetical order.
    expect(summary.gross).toEqual([
      { currency: "USD", current: 15_000, previous: 10_000 },
      { currency: "EUR", current: 2_000, previous: 0 },
    ]);
    // Same calculation the webhook writes to the ledger: floor(gross * bps / 10000),
    // and the default fee when the order did not freeze any.
    expect(summary.platformFees).toEqual([
      { currency: "USD", current: 1_250, previous: 1_000 },
      { currency: "EUR", current: 200, previous: 0 },
    ]);
  });

  it("an order that was paid and later refunded stays in gross sales and shows up in refunds", () => {
    const summary = summarizeOrders([
      order({ status: "refunded", refunded_amount_minor: 10_000, updated_at: "2026-10-03T00:00:00Z" }),
      order({ status: "partially_refunded", refunded_amount_minor: 2_500, paid_at: "2026-08-01T00:00:00Z", updated_at: "2026-10-04T00:00:00Z" }),
    ], window);
    expect(summary.paidOrders).toMatchObject({ current: 1, previous: 0 });
    expect(summary.gross).toEqual([{ currency: "USD", current: 10_000, previous: 0 }]);
    expect(summary.refunds).toMatchObject({ current: 2, previous: 0 });
    expect(summary.refundedAmount).toEqual([{ currency: "USD", current: 12_500, previous: 0 }]);
  });

  // The refund returns the fee (refund_application_fee: true); the creator's wallet
  // already removes the refunded amount. So does the platform revenue.
  it("the platform fee comes from the net amount: US$100 at 10% refunded in full gives US$0", () => {
    const refunded = summarizeOrders([
      order({ status: "refunded", amount_minor: 10_000, platform_fee_bps: 1000, refunded_amount_minor: 10_000 }),
    ], window);
    expect(refunded.platformFees).toEqual([{ currency: "USD", current: 0, previous: 0 }]);

    const partial = summarizeOrders([
      order({ status: "partially_refunded", amount_minor: 10_000, platform_fee_bps: 1000, refunded_amount_minor: 2_500 }),
    ], window);
    expect(partial.platformFees).toEqual([{ currency: "USD", current: 750, previous: 0 }]);
  });

  // An expired checkout rewrites "failed" to "cancelled": the count would be
  // always ~0. It comes back when the webhook leaves "failed" fixed.
  it("does not deliver a count of failed payments", () => {
    expect(summarizeOrders([], window)).not.toHaveProperty("failed");
  });

  it("platform revenue adds fee and activation currency by currency", () => {
    expect(addMoney(
      [{ currency: "USD", current: 1_000, previous: 500 }],
      [{ currency: "EUR", current: 300, previous: 0 }, { currency: "USD", current: 2_500, previous: 0 }],
    )).toEqual([
      { currency: "USD", current: 3_500, previous: 500 },
      { currency: "EUR", current: 300, previous: 0 },
    ]);
  });

  it("activation fee: counts all of them and adds up only those that stored a value, in the internal unit", () => {
    const summary = summarizeActivations([
      { target_id: "u1", created_at: "2026-10-01T00:00:00Z", metadata: { amountTotal: 2_500, currency: "usd" } },
      { target_id: "u2", created_at: "2026-10-02T00:00:00Z", metadata: {} },
      { target_id: "u3", created_at: "2026-10-02T00:00:00Z", metadata: { amountTotal: 1_000, currency: "jpy" } },
      { target_id: "u4", created_at: "2026-09-23T00:00:00Z", metadata: { amountTotal: 2_500, currency: "usd" } },
    ], window);
    expect(summary.count).toMatchObject({ current: 3, previous: 1 });
    expect(summary.amount).toEqual([
      { currency: "USD", current: 2_500, previous: 2_500 },
      { currency: "JPY", current: 100_000, previous: 0 },
    ]);
  });

  it("an activation fee stored twice for the same payment counts once", () => {
    const paid = { amountTotal: 2_500, currency: "usd", paymentIntentId: "pi_test_1" };
    const summary = summarizeActivations([
      { target_id: "u1", created_at: "2026-10-01T00:00:00Z", metadata: paid },
      { target_id: "u1", created_at: "2026-10-01T00:05:00Z", metadata: paid },
      { target_id: "u2", created_at: "2026-10-02T00:00:00Z", metadata: { ...paid, paymentIntentId: "pi_test_2" } },
    ], window);
    expect(summary.count).toMatchObject({ current: 2, previous: 0 });
    expect(summary.amount).toEqual([{ currency: "USD", current: 5_000, previous: 0 }]);
  });
});
