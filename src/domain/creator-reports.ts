/**
 * Period cut of the teacher's reports page.
 * Pure: does not read the network, does not format money, does not know React.
 *
 * The window (`resolveReportWindow`) is the single source of truth: the chart and the
 * KPIs come from the same `startMillis`, so the line and the number never count
 * different periods.
 */
import { normalizeCurrency } from "@/domain/creator-ops";
import { isPaidOrder, orderRevenueMinor, type Order, type OrderStatus } from "@/domain/order";
import { toDate } from "@/lib/format-date";

export type ReportPeriod = "7d" | "30d" | "90d" | "12m" | "all";

/** The Home selector already existed with these four; we do not touch them. */
export type RevenueRange = "3m" | "6m" | "12m" | "all";

export type RevenueBucket = "day" | "month";

export type ReportWindow = {
  bucket: RevenueBucket;
  count: number;
  /** null = no lower bound ("All"). */
  startMillis: number | null;
};

export type RevenuePoint = {
  key: string;
  label: string;
  grossMinor: number;
};

/** Paid orders of ONE currency: how many and how much, converting nothing. */
export type CurrencyOrderGroup = {
  currency: string;
  orders: number;
  /** Orders with money (> 0): they are the ones that choose the chart currency. */
  earningOrders: number;
  totalMinor: number;
};

export type ReportProductRow = {
  courseId: string;
  courseTitle: string;
  currency: string;
  orders: number;
  grossMinor: number;
  refunds: number;
};

export type RefundRate = {
  refundedCount: number;
  /** Paid + refunded: everything that was ever charged. */
  collectedCount: number;
  /** In percentage points, one decimal place. 0 when nobody has paid anything yet. */
  rate: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// A refunded order was paid before: it enters the denominator of the rate,
// otherwise a month with 1 sale and 1 refund would show a 100% refund over
// zero remaining sales.
const REFUNDED_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  "refunded",
  "partially_refunded",
]);

export function isRefundedOrder(status: OrderStatus): boolean {
  return REFUNDED_STATUSES.has(status);
}

export function getTimestampMillis(value: unknown): number | null {
  return toDate(value)?.getTime() ?? null;
}

/**
 * "All" looks from the oldest paid order until now, with the number of buckets
 * clamped to [1, 24] so the monthly chart stays readable.
 */
export function getRevenueMonthsBack(
  paidOrders: Order[],
  range: RevenueRange,
  now: Date,
): number {
  if (range === "3m") return 3;
  if (range === "6m") return 6;
  if (range === "12m") return 12;

  const earliest = paidOrders
    .map((order) => getTimestampMillis(order.createdAt))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right)[0];

  if (!earliest) return 12;

  const earliestDate = new Date(earliest);
  const monthSpan =
    (now.getFullYear() - earliestDate.getFullYear()) * 12 +
    (now.getMonth() - earliestDate.getMonth()) +
    1;

  return Math.min(24, Math.max(1, monthSpan));
}

function startOfMonthsBack(now: Date, monthsBack: number): number {
  return new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1).getTime();
}

function startOfDaysBack(now: Date, daysBack: number): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return midnight.getTime() - (daysBack - 1) * DAY_MS;
}

/** Home window: always monthly, with the same buckets as before. */
export function resolveRevenueRangeWindow(
  paidOrders: Order[],
  range: RevenueRange,
  now = new Date(),
): ReportWindow {
  const count = getRevenueMonthsBack(paidOrders, range, now);

  return {
    bucket: "month",
    count,
    startMillis: range === "all" ? null : startOfMonthsBack(now, count),
  };
}

/** Reports window: day up to 90d, month from 12M up. */
export function resolveReportWindow(
  paidOrders: Order[],
  period: ReportPeriod,
  now = new Date(),
): ReportWindow {
  if (period === "7d" || period === "30d" || period === "90d") {
    const count = Number.parseInt(period, 10);
    return { bucket: "day", count, startMillis: startOfDaysBack(now, count) };
  }

  return resolveRevenueRangeWindow(paidOrders, period, now);
}

export function isWithinWindow(value: unknown, window: ReportWindow): boolean {
  if (window.startMillis === null) return true;
  const millis = getTimestampMillis(value);
  // Without a trustworthy date the record counts as from now, like the chart.
  return millis === null || millis >= window.startMillis;
}

function bucketKey(date: Date, bucket: RevenueBucket): string {
  return bucket === "month"
    ? `${date.getFullYear()}-${date.getMonth()}`
    : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * The orders with revenue grouped by currency: nothing converts, nothing adds different
 * currencies (the chart added R$100 to $20 and wrote "$120"). Each order
 * counts what was kept of it (`orderRevenueMinor`); what is not revenue stays out.
 * First comes the currency with the most orders WITH money (tie: alphabetical
 * order), the one the chart draws: five $0 orders cannot
 * hide one R$100 order.
 */
export function groupPaidOrdersByCurrency(paidOrders: Order[]): CurrencyOrderGroup[] {
  const groups = new Map<string, CurrencyOrderGroup>();
  for (const order of paidOrders) {
    const revenue = orderRevenueMinor(order);
    if (revenue === null) continue;
    const currency = normalizeCurrency(order.currency);
    const group = groups.get(currency) ?? { currency, orders: 0, earningOrders: 0, totalMinor: 0 };
    group.orders += 1;
    if (revenue > 0) group.earningOrders += 1;
    group.totalMinor += revenue;
    groups.set(currency, group);
  }
  return [...groups.values()].sort(
    (left, right) =>
      right.earningOrders - left.earningOrders ||
      left.currency.localeCompare(right.currency),
  );
}

/**
 * Revenue series of ONE currency (`currency`): orders in another currency stay
 * out, so a bucket never adds different currencies.
 */
export function buildRevenueSeries(
  paidOrders: Order[],
  window: ReportWindow,
  formatLabel: (date: Date, bucket: RevenueBucket) => string,
  currency: string,
  now = new Date(),
): RevenuePoint[] {
  const points = Array.from({ length: window.count }, (_, index) => {
    const date =
      window.bucket === "month"
        ? new Date(now.getFullYear(), now.getMonth() - (window.count - 1) + index, 1)
        : new Date(startOfDaysBack(now, window.count) + index * DAY_MS);

    return {
      key: bucketKey(date, window.bucket),
      label: formatLabel(date, window.bucket),
      grossMinor: 0,
    };
  });

  const byKey = new Map(points.map((point) => [point.key, point]));

  for (const order of paidOrders) {
    const revenue = orderRevenueMinor(order);
    if (revenue === null || normalizeCurrency(order.currency) !== currency) continue;
    const millis = getTimestampMillis(order.createdAt);
    const date = millis === null ? now : new Date(millis);
    const point = byKey.get(bucketKey(date, window.bucket));
    if (point) point.grossMinor += revenue;
  }

  return points;
}

export function calculateRefundRate(orders: Order[]): RefundRate {
  const paidCount = orders.filter((order) => isPaidOrder(order.status)).length;
  const refundedCount = orders.filter((order) =>
    isRefundedOrder(order.status),
  ).length;
  const collectedCount = paidCount + refundedCount;

  return {
    refundedCount,
    collectedCount,
    rate: collectedCount
      ? Number(((refundedCount / collectedCount) * 100).toFixed(1))
      : 0,
  };
}

/**
 * Same count as the Home "Top courses", but with every row, the
 * period's refunds and sorted by revenue. One row per product AND
 * currency: a product sold in two currencies has two rows, never a sum.
 */
export function buildReportProductRows(orders: Order[]): ReportProductRow[] {
  const byCourse = new Map<string, ReportProductRow>();

  for (const order of orders) {
    const isPaid = isPaidOrder(order.status);
    const isRefund = isRefundedOrder(order.status);
    if (!isPaid && !isRefund) continue;

    // With no stored currency the order counted as USD here, without knowing whether it was.
    // Now it comes out as "UNSPECIFIED", the same name as the chart and Earnings.
    const currency = normalizeCurrency(order.currency);
    const key = `${order.courseId}:${currency}`;
    const row = byCourse.get(key) ?? {
      courseId: order.courseId,
      courseTitle: order.courseTitle,
      currency,
      orders: 0,
      grossMinor: 0,
      refunds: 0,
    };

    // Partial refund: the sale counts (with what was kept) AND the refund counts.
    const revenue = orderRevenueMinor(order);
    if (revenue !== null) {
      row.orders += 1;
      row.grossMinor += revenue;
    }
    if (isRefund) {
      row.refunds += 1;
    }

    byCourse.set(key, row);
  }

  return [...byCourse.values()].sort(
    (left, right) =>
      right.grossMinor - left.grossMinor ||
      left.courseTitle.localeCompare(right.courseTitle),
  );
}
