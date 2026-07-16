import type { CourseSubscription } from "@/domain/course-subscription";
import type { Order } from "@/domain/order";
import type {
  PayoutLedgerEntry,
  PayoutLedgerStatus,
} from "@/domain/payout-ledger";
import type { TeacherCourse } from "@/domain/teacher-course";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = new Set(["active", "trialing"]);
const MRR_STATUSES = new Set(["active", "past_due"]);

export type CreatorCourseSubscription = CourseSubscription & {
  priceAmountMinor?: number | null;
  currency?: string | null;
  offerId?: string | null;
  priceId?: string | null;
};

export type CreatorSubscriptionFinancialSnapshots = {
  orders: Order[];
  ledgers: PayoutLedgerEntry[];
};

export type CreatorSubscriptionMetrics = {
  activeCount: number;
  pastDueCount: number;
  cancelScheduledCount: number;
  canceledLast30Days: number;
  observedChurnRate: number;
  mrrByCurrency: Array<{ currency: string; amountMinor: number }>;
  mrrSnapshotMissingCount: number;
  mrrLegacyFallbackCount: number;
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
  subscriptions: CreatorCourseSubscription[],
  courses: TeacherCourse[],
  now = new Date(),
  financialSnapshots: CreatorSubscriptionFinancialSnapshots = {
    orders: [],
    ledgers: [],
  },
): CreatorSubscriptionMetrics {
  // Kept in the signature for callers that also render course details. MRR must
  // never read mutable course pricing.
  void courses;
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
  const ordersById = new Map(
    financialSnapshots.orders.map((order) => [order.id, order]),
  );
  const latestLedgerBySubscription = buildLatestLedgerBySubscription(
    financialSnapshots.ledgers,
  );
  const ledgersByInvoice = new Map(
    financialSnapshots.ledgers
      .filter((entry) => entry.kind === "course_subscription")
      .flatMap((entry) => {
        const ids = [entry.id, entry.invoiceId, entry.orderId].filter(
          (id): id is string => Boolean(id),
        );
        return ids.map((id) => [id, entry] as const);
      }),
  );
  let mrrSnapshotMissingCount = 0;
  let mrrLegacyFallbackCount = 0;

  for (const subscription of subscriptions) {
    if (!MRR_STATUSES.has(subscription.status)) continue;
    const interval = subscription.interval;
    let pricing = toPricingSnapshot(
      subscription.priceAmountMinor,
      subscription.currency,
    );
    let usedLegacyFallback = false;

    if (!pricing) {
      const latestInvoiceId = subscription.latestInvoiceId ?? null;
      const order = latestInvoiceId ? ordersById.get(latestInvoiceId) : null;
      pricing = order
        ? toPricingSnapshot(order.amountMinor, order.currency)
        : null;

      if (!pricing && latestInvoiceId) {
        const invoiceLedger = ledgersByInvoice.get(latestInvoiceId);
        pricing = invoiceLedger
          ? toPricingSnapshot(
              invoiceLedger.grossAmountMinor,
              invoiceLedger.currency,
            )
          : null;
      }

      if (!pricing) {
        const latestLedger = latestLedgerBySubscription.get(subscription.id);
        pricing = latestLedger
          ? toPricingSnapshot(
              latestLedger.grossAmountMinor,
              latestLedger.currency,
            )
          : null;
      }
      usedLegacyFallback = Boolean(pricing);
    }

    if (!pricing || (interval !== "month" && interval !== "year")) {
      mrrSnapshotMissingCount += 1;
      continue;
    }

    if (usedLegacyFallback) mrrLegacyFallbackCount += 1;
    const monthlyAmount =
      interval === "year" ? pricing.amountMinor / 12 : pricing.amountMinor;
    mrr.set(
      pricing.currency,
      (mrr.get(pricing.currency) ?? 0) + monthlyAmount,
    );
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
    mrrSnapshotMissingCount,
    mrrLegacyFallbackCount,
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

function toPricingSnapshot(
  amountValue: unknown,
  currencyValue: unknown,
): { amountMinor: number; currency: string } | null {
  if (typeof amountValue !== "number") return null;
  const amountMinor = amountValue;
  const currency = String(currencyValue ?? "").trim().toUpperCase();
  if (!Number.isFinite(amountMinor) || amountMinor < 0 || !currency) return null;
  return { amountMinor, currency };
}

function buildLatestLedgerBySubscription(
  ledgers: PayoutLedgerEntry[],
): Map<string, PayoutLedgerEntry> {
  const latest = new Map<string, PayoutLedgerEntry>();

  for (const entry of ledgers) {
    if (entry.kind !== "course_subscription" || !entry.subscriptionId) continue;
    const current = latest.get(entry.subscriptionId);
    if (!current || compareLedgerSnapshot(entry, current) > 0) {
      latest.set(entry.subscriptionId, entry);
    }
  }

  return latest;
}

function compareLedgerSnapshot(
  left: PayoutLedgerEntry,
  right: PayoutLedgerEntry,
): number {
  const timeDifference =
    (toMillis(left.createdAt) ?? 0) - (toMillis(right.createdAt) ?? 0);
  return timeDifference || left.id.localeCompare(right.id);
}
