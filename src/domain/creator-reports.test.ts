import { describe, expect, it } from "vitest";

import {
  buildReportProductRows,
  buildRevenueSeries,
  groupPaidOrdersByCurrency,
  type ReportWindow,
} from "@/domain/creator-reports";
import type { Order } from "@/domain/order";

// What the person suffered: with R$100 and $20 sold, the chart and the table on
// Home added the two and wrote "$120". Revenue only exists PER CURRENCY.

function order(fields: Partial<Order>): Order {
  return {
    id: "o1",
    userId: "buyer-1",
    teacherId: "teacher-1",
    courseId: "c1",
    courseSlug: "curso",
    courseTitle: "Curso",
    amountMinor: 2_000,
    currency: "USD",
    platformFeeBps: 0,
    status: "paid",
    provider: "stripe",
    checkoutSessionId: null,
    paymentIntentId: null,
    createdAt: new Date(2026, 10, 10, 12).toISOString(),
    ...fields,
  } as Order;
}

const now = new Date(2026, 10, 20, 12);
const window: ReportWindow = { bucket: "month", count: 2, startMillis: null };

describe("revenue per currency", () => {
  const mixed = [
    order({ id: "brl", currency: "BRL", amountMinor: 10_000 }),
    order({ id: "usd-1", currency: "usd", amountMinor: 2_000 }),
    order({ id: "usd-2", currency: "USD", amountMinor: 500 }),
  ];

  it("groups by currency, without converting or adding different currencies", () => {
    expect(groupPaidOrdersByCurrency(mixed)).toEqual([
      // Most orders first: it is the currency the chart draws.
      { currency: "USD", orders: 2, earningOrders: 2, totalMinor: 2_500 },
      { currency: "BRL", orders: 1, earningOrders: 1, totalMinor: 10_000 },
    ]);
  });

  it("tie on orders: alphabetical order", () => {
    const tie = [order({ currency: "USD" }), order({ currency: "BRL" })];
    expect(groupPaidOrdersByCurrency(tie).map((group) => group.currency)).toEqual(["BRL", "USD"]);
  });

  it("with no stored currency it becomes UNSPECIFIED, in its own group", () => {
    expect(groupPaidOrdersByCurrency([order({ currency: "" })])).toEqual([
      { currency: "UNSPECIFIED", orders: 1, earningOrders: 1, totalMinor: 2_000 },
    ]);
  });

  // Five $0 orders and one R$100 one: the chart drew USD, said "no
  // revenue" and the R$100 only showed up in the note.
  it("only orders with money choose the chart currency", () => {
    const orders = [
      ...Array.from({ length: 5 }, (_, index) => order({ id: `free-${index}`, currency: "USD", amountMinor: 0 })),
      order({ id: "brl", currency: "BRL", amountMinor: 10_000 }),
    ];
    expect(groupPaidOrdersByCurrency(orders)).toEqual([
      { currency: "BRL", orders: 1, earningOrders: 1, totalMinor: 10_000 },
      { currency: "USD", orders: 5, earningOrders: 0, totalMinor: 0 },
    ]);
  });

  // The webhook changes the status to "partially_refunded" and stores the accumulated
  // refund: $100 with $30 returned vanished from revenue instead of counting $70.
  it("a partial refund counts what was kept, in the order's currency", () => {
    const partial = order({ status: "partially_refunded", amountMinor: 10_000, refundedAmountMinor: 3_000 });
    const full = order({ id: "full", status: "refunded", amountMinor: 5_000, refundedAmountMinor: 5_000 });

    expect(groupPaidOrdersByCurrency([partial, full])).toEqual([
      { currency: "USD", orders: 1, earningOrders: 1, totalMinor: 7_000 },
    ]);
    const series = buildRevenueSeries([partial, full], window, () => "m", "USD", now);
    expect(series.reduce((sum, point) => sum + point.grossMinor, 0)).toBe(7_000);
    expect(buildReportProductRows([partial, full])).toMatchObject([
      { currency: "USD", orders: 1, grossMinor: 7_000, refunds: 2 },
    ]);
  });

  it("no orders: no group", () => {
    expect(groupPaidOrdersByCurrency([])).toEqual([]);
  });

  it("the series of one currency leaves the others out (no R$100 + $20 in one bucket)", () => {
    const label = () => "m";
    const usd = buildRevenueSeries(mixed, window, label, "USD", now);
    const brl = buildRevenueSeries(mixed, window, label, "BRL", now);

    expect(usd.reduce((sum, point) => sum + point.grossMinor, 0)).toBe(2_500);
    expect(brl.reduce((sum, point) => sum + point.grossMinor, 0)).toBe(10_000);
  });

  it("the per-product table splits a product sold in two currencies", () => {
    const rows = buildReportProductRows([
      ...mixed,
      order({ id: "brl-refund", currency: "BRL", status: "refunded", amountMinor: 10_000 }),
    ]);

    expect(rows.map(({ currency, orders, grossMinor, refunds }) => ({ currency, orders, grossMinor, refunds }))).toEqual([
      // The refund stays on the row of its own currency and does not enter revenue.
      { currency: "BRL", orders: 1, grossMinor: 10_000, refunds: 1 },
      { currency: "USD", orders: 2, grossMinor: 2_500, refunds: 0 },
    ]);
  });
});
