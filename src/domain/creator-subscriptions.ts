import type { CourseSubscription } from "@/domain/course-subscription";
import type { Order } from "@/domain/order";
import type { PayoutLedgerStatus } from "@/domain/payout-ledger";
import type { PayoutLedgerEntry } from "@/domain/payout-ledger";
import type { TeacherCourse } from "@/domain/teacher-course";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = new Set(["active", "trialing"]);
const MRR_STATUSES = new Set(["active", "past_due"]);

export type CreatorSubscriptionMetrics = {
  activeCount: number;
  pastDueCount: number;
  cancelScheduledCount: number;
  canceledLast30Days: number;
  observedChurnRate: number;
  mrrByCurrency: Array<{ currency: string; amountMinor: number }>;
};

export type CreatorRenewalHistoryEntry = {
  id: string;
  subscriptionId: string | null;
  orderId: string;
  userId: string | null;
  courseId: string;
  courseTitle: string;
  grossAmountMinor: number;
  netAmountMinor: number;
  currency: string;
  status: PayoutLedgerStatus;
  createdAt?: unknown;
};

export function calculateCreatorSubscriptionMetrics(
  subscriptions: CourseSubscription[],
  courses: TeacherCourse[],
  now = new Date(),
): CreatorSubscriptionMetrics {
  const coursesById = new Map(courses.map((course) => [course.id, course]));
  const activeCount = subscriptions.filter((subscription) =>
    ACTIVE_STATUSES.has(subscription.status),
  ).length;
  const pastDueCount = subscriptions.filter(
    (subscription) => subscription.pastDue || subscription.status === "past_due",
  ).length;
  const cancelScheduledCount = subscriptions.filter(
    (subscription) =>
      subscription.cancelAtPeriodEnd
      && (ACTIVE_STATUSES.has(subscription.status) || subscription.status === "past_due"),
  ).length;
  const canceledLast30Days = subscriptions.filter((subscription) => {
    if (subscription.status !== "canceled") return false;
    const updatedAt = toMillis(subscription.updatedAt);
    return updatedAt !== null && now.getTime() - updatedAt <= THIRTY_DAYS_MS;
  }).length;
  const churnDenominator = activeCount + pastDueCount + canceledLast30Days;
  const observedChurnRate = churnDenominator
    ? Number(((canceledLast30Days / churnDenominator) * 100).toFixed(1))
    : 0;
  const mrr = new Map<string, number>();

  for (const subscription of subscriptions) {
    if (!MRR_STATUSES.has(subscription.status)) continue;
    const course = coursesById.get(subscription.courseId);
    const amountMinor = Number(course?.priceAmountMinor ?? 0);
    if (!course || amountMinor <= 0) continue;
    const currency = String(course.currency || "USD").toUpperCase();
    const interval =
      subscription.interval
      ?? (course.paymentType === "subscription_yearly" ? "year" : "month");
    const monthlyAmount = interval === "year" ? amountMinor / 12 : amountMinor;
    mrr.set(currency, (mrr.get(currency) ?? 0) + monthlyAmount);
  }

  return {
    activeCount,
    pastDueCount,
    cancelScheduledCount,
    canceledLast30Days,
    observedChurnRate,
    mrrByCurrency: Array.from(mrr, ([currency, amountMinor]) => ({
      currency,
      amountMinor: Math.round(amountMinor),
    })).sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}

export function buildCreatorRenewalHistory(
  ledgers: PayoutLedgerEntry[],
  orders: Order[],
): CreatorRenewalHistoryEntry[] {
  const ordersById = new Map(orders.map((order) => [order.id, order]));

  return ledgers
    .filter((entry) => entry.kind === "course_subscription")
    .map((entry) => {
      const order = ordersById.get(entry.orderId);
      return {
        id: entry.id,
        subscriptionId: entry.subscriptionId ?? null,
        orderId: entry.orderId,
        userId: order?.userId ?? null,
        courseId: entry.courseId,
        courseTitle: order?.courseTitle || entry.courseId,
        grossAmountMinor: entry.grossAmountMinor,
        netAmountMinor: entry.netAmountMinor,
        currency: entry.currency,
        status: entry.status,
        createdAt: entry.createdAt,
      };
    })
    .sort((a, b) => (toMillis(b.createdAt) ?? 0) - (toMillis(a.createdAt) ?? 0));
}

function toMillis(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}
