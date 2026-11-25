/**
 * Overview of /ops: "how are we doing?" in Today / 7 days / 30 days, each number
 * against the previous period of the same length. Pure: does not read the network, does not format,
 * does not know React. The rows arrive raw from Supabase (read by the admin
 * under the policies they already have) and leave as counts and sums per currency.
 *
 * Days in UTC: the window comes from epoch ms, so the time zone of the browser of whoever
 * is looking does not change the number.
 */
import { isInternalSmokeCourse } from "@/domain/teacher-course";
import { DEFAULT_PLATFORM_FEE_BPS, isRefundableEnrollmentSource, platformFeeForSale } from "@/lib/payments/rules";
import { defaultSkillsetCurrency, fromStripeAmount } from "@/lib/payments/currencies";

export const overviewPeriods = ["today", "7d", "30d"] as const;
export type OverviewPeriod = (typeof overviewPeriods)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS: Record<OverviewPeriod, number> = { today: 1, "7d": 7, "30d": 30 };

export function parseOverviewPeriod(value: string | null | undefined): OverviewPeriod {
  return overviewPeriods.find((period) => period === value) ?? "7d";
}

/** Instants in epoch ms; both ends of each period are inclusive. */
export type OverviewWindow = {
  period: OverviewPeriod;
  days: number;
  start: number;
  end: number;
  previousStart: number;
  previousEnd: number;
};

// "7 days" = today (until now) + the 6 previous UTC days. The previous one is the same
// window shifted N days: Today compares with yesterday until the same hour, not with
// the whole day of yesterday (which would always beat half a day).
export function resolveOverviewWindow(period: OverviewPeriod, now = new Date()): OverviewWindow {
  const days = PERIOD_DAYS[period];
  const end = now.getTime();
  const start = Math.floor(end / DAY_MS) * DAY_MS - (days - 1) * DAY_MS;
  const shift = days * DAY_MS;
  return { period, days, start, end, previousStart: start - shift, previousEnd: end - shift };
}

export type Measure = {
  current: number;
  previous: number;
  /** One value per UTC day of the current period; empty in Today. */
  series: number[];
};

function millis(value: unknown): number | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

type Slot = { current: true; day: number } | { current: false };

function slotOf(value: unknown, window: OverviewWindow): Slot | null {
  const time = millis(value);
  if (time === null) return null;
  if (time >= window.start && time <= window.end) {
    return { current: true, day: Math.floor((time - window.start) / DAY_MS) };
  }
  if (time >= window.previousStart && time <= window.previousEnd) return { current: false };
  return null;
}

export function measure<T>(
  rows: readonly T[],
  at: (row: T) => unknown,
  window: OverviewWindow,
  weight: (row: T) => number = () => 1,
): Measure {
  const result: Measure = {
    current: 0,
    previous: 0,
    series: window.days > 1 ? Array.from({ length: window.days }, () => 0) : [],
  };
  for (const row of rows) {
    const slot = slotOf(at(row), window);
    if (!slot) continue;
    const value = weight(row);
    if (!slot.current) {
      result.previous += value;
      continue;
    }
    result.current += value;
    if (result.series.length) result.series[slot.day] += value;
  }
  return result;
}

/** Values in the internal unit (x100 in every currency); never added across currencies. */
export type MoneyLine = { currency: string; current: number; previous: number };

// USD (the platform default) first, the rest alphabetical.
function byCurrency(left: MoneyLine, right: MoneyLine): number {
  return Number(right.currency === defaultSkillsetCurrency) - Number(left.currency === defaultSkillsetCurrency)
    || left.currency.localeCompare(right.currency);
}

function measureMoney<T>(
  rows: readonly T[],
  at: (row: T) => unknown,
  currencyOf: (row: T) => string,
  amountOf: (row: T) => number,
  window: OverviewWindow,
): MoneyLine[] {
  const lines = new Map<string, MoneyLine>();
  for (const row of rows) {
    const slot = slotOf(at(row), window);
    if (!slot) continue;
    const currency = currencyOf(row).toUpperCase();
    const line = lines.get(currency) ?? { currency, current: 0, previous: 0 };
    line[slot.current ? "current" : "previous"] += amountOf(row);
    lines.set(currency, line);
  }
  return [...lines.values()].sort(byCurrency);
}

export function addMoney(left: readonly MoneyLine[], right: readonly MoneyLine[]): MoneyLine[] {
  const lines = new Map<string, MoneyLine>();
  for (const line of [...left, ...right]) {
    const merged = lines.get(line.currency) ?? { currency: line.currency, current: 0, previous: 0 };
    merged.current += line.current;
    merged.previous += line.previous;
    lines.set(line.currency, merged);
  }
  return [...lines.values()].sort(byCurrency);
}

// Same predicate as the store and the sitemap: `smoke-` in the id, "[QA]" in the title.
function isRealCourse(id: string | null | undefined, title: string | null | undefined): boolean {
  return !isInternalSmokeCourse({ id: id ?? "", title: title ?? "" });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

// --- Raw rows, only the columns the Overview reads --------------------------

export type OverviewUserRow = { created_at: string; roles: unknown };
export type OverviewCourseRow = {
  id: string;
  title: string;
  owner_id: string;
  status: string;
  created_at: string | null;
};
export type OverviewAuditRow = { target_id: string; created_at: string | null; metadata: unknown };
export type OverviewEnrollmentRow = {
  course_id: string;
  course_title: string;
  source: string;
  created_at: string;
};
export type OverviewOrderRow = {
  course_id: string | null;
  course_title: string | null;
  status: string;
  amount_minor: number;
  currency: string;
  platform_fee_bps: number | null;
  /** Absent on rows read before the column existed: treat as 0. */
  platform_fee_fixed_minor?: number | null;
  refunded_amount_minor: number;
  paid_at: string | null;
  updated_at: string;
};

// --- Summaries, one per read ------------------------------------------------

/** New creator = sign-up of the period that already has the teacher role. */
export function summarizeUsers(rows: readonly OverviewUserRow[], window: OverviewWindow) {
  const creators = rows.filter((row) => Array.isArray(row.roles) && row.roles.includes("teacher"));
  return {
    signups: measure(rows, (row) => row.created_at, window),
    creators: measure(creators, (row) => row.created_at, window),
  };
}

export function summarizeCourses(rows: readonly OverviewCourseRow[], window: OverviewWindow) {
  const real = rows.filter((row) => isRealCourse(row.id, row.title));
  // State of now, not of the period: there is no publication date on the course.
  const liveCreators = new Set(real.filter((row) => row.status === "published").map((row) => row.owner_id)).size;
  return { created: measure(real, (row) => row.created_at, window), liveCreators };
}

/**
 * COURSE_PUBLISHED_BY_CREATOR events from the audit_log: the course does not store when
 * it was published. Unpublishing and publishing again in the same period counts once.
 */
export function summarizePublications(rows: readonly OverviewAuditRow[], window: OverviewWindow): Measure {
  const real = rows
    .filter((row) => isRealCourse(row.target_id, String(record(row.metadata).title ?? "")))
    .map((row) => ({ row, slot: slotOf(row.created_at, window) }))
    .sort((left, right) => (millis(left.row.created_at) ?? 0) - (millis(right.row.created_at) ?? 0));
  const seen = new Set<string>();
  const firstPerPeriod = real.filter(({ row, slot }) => {
    if (!slot) return false;
    const key = `${slot.current}:${row.target_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return measure(firstPerPeriod.map(({ row }) => row), (row) => row.created_at, window);
}

/** Paid = sources that generate a charge (payment, subscription); free = free_course. Grants only in the total. */
export function summarizeEnrollments(rows: readonly OverviewEnrollmentRow[], window: OverviewWindow) {
  const real = rows.filter((row) => isRealCourse(row.course_id, row.course_title));
  const at = (row: OverviewEnrollmentRow) => row.created_at;
  return {
    total: measure(real, at, window),
    paid: measure(real.filter((row) => isRefundableEnrollmentSource(row.source)), at, window),
    free: measure(real.filter((row) => row.source === "free_course"), at, window),
  };
}

const REFUND_STATUSES = new Set(["refunded", "partially_refunded"]);

/**
 * Order = sale (a subscription renewal also becomes an order). A sale counts
 * by paid_at and only when it charged something (a 100% coupon stays out); a refund
 * by updated_at, the moment the webhook stored the outcome (the order does not
 * have refunded_at). A failed payment stays out: an expired checkout rewrites
 * "failed" to "cancelled", so the count would almost always be 0.
 */
export function summarizeOrders(rows: readonly OverviewOrderRow[], window: OverviewWindow) {
  const real = rows.filter((row) => isRealCourse(row.course_id, row.course_title));
  const paid = real.filter((row) => row.paid_at && row.amount_minor > 0);
  const refunded = real.filter((row) => REFUND_STATUSES.has(row.status));
  const paidAt = (row: OverviewOrderRow) => row.paid_at;
  const updatedAt = (row: OverviewOrderRow) => row.updated_at;
  const currency = (row: OverviewOrderRow) => row.currency;
  return {
    paidOrders: measure(paid, paidAt, window),
    gross: measureMoney(paid, paidAt, currency, (row) => row.amount_minor, window),
    // The webhook's calculation (percentage + fixed part, platformFeeForSale) on the
    // proportion of what was not refunded: the refund returns the fee in the same
    // proportion (refund_application_fee: true), as the creator's wallet already
    // deducts.
    platformFees: measureMoney(paid, paidAt, currency, (row) => {
      if (row.amount_minor <= 0) return 0;
      const fee = platformFeeForSale(
        row.amount_minor,
        row.platform_fee_bps ?? DEFAULT_PLATFORM_FEE_BPS,
        row.platform_fee_fixed_minor ?? 0,
      );
      return Math.floor((fee * Math.max(0, row.amount_minor - row.refunded_amount_minor)) / row.amount_minor);
    }, window),
    refunds: measure(refunded, updatedAt, window),
    refundedAmount: measureMoney(refunded, updatedAt, currency, (row) => row.refunded_amount_minor, window),
  };
}

/**
 * STOREFRONT_ACTIVATION_FEE_PAID events: it is the only readable place that stores the
 * value (the charge belongs to the platform, with no row in orders). An event without a stored
 * value enters the count, not the sum. A webhook redelivery stores the
 * event again: one payment (paymentIntentId) counts once.
 */
export function summarizeActivations(allRows: readonly OverviewAuditRow[], window: OverviewWindow) {
  const seen = new Set<string>();
  const rows = allRows.filter((row) => {
    const paymentIntentId = record(row.metadata).paymentIntentId;
    if (typeof paymentIntentId !== "string" || !paymentIntentId) return true;
    if (seen.has(paymentIntentId)) return false;
    seen.add(paymentIntentId);
    return true;
  });
  const priced = rows.filter((row) => {
    const metadata = record(row.metadata);
    return typeof metadata.amountTotal === "number" && typeof metadata.currency === "string";
  });
  return {
    count: measure(rows, (row) => row.created_at, window),
    amount: measureMoney(
      priced,
      (row) => row.created_at,
      (row) => String(record(row.metadata).currency),
      (row) => {
        const metadata = record(row.metadata);
        return fromStripeAmount(Number(metadata.amountTotal), String(metadata.currency));
      },
      window,
    ),
  };
}
