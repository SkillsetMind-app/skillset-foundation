"use client";

import { AlertTriangle, CalendarClock, Receipt, Search, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { StatusChip } from "@/components/shared/status-chip";
import { buttonClasses, Card, InlineAlert } from "@/components/ui";
import type { CourseSubscription } from "@/domain/course-subscription";
import {
  buildCreatorRenewalHistory,
  calculateCreatorSubscriptionMetrics,
} from "@/domain/creator-subscriptions";
import type { Order } from "@/domain/order";
import type { PayoutLedgerEntry } from "@/domain/payout-ledger";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToTeacherCourseSubscriptions } from "@/lib/data/course-subscriptions";
import { subscribeToTeacherOrders } from "@/lib/data/orders";
import { subscribeToTeacherPayoutLedger } from "@/lib/data/payout-ledger";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";
import {
  getMySubscriberProfiles,
  type SubscriberProfile,
} from "@/lib/data/user-profiles";
import { toDate } from "@/lib/format-date";
import type { Locale } from "@/lib/i18n/config";
import { countLabel, type Translate } from "@/lib/i18n/count-label";

type SubscriberFilter = "all" | "active" | "attention" | "canceling" | "ended";
type ReadState = "loading" | "ready" | "error";
const copy = "teach.subscriptions";

export function CreatorSubscriptionCenter() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [subscriptions, setSubscriptions] = useState<CourseSubscription[]>([]);
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [ledgers, setLedgers] = useState<PayoutLedgerEntry[]>([]);
  const [profiles, setProfiles] = useState<SubscriberProfile[]>([]);
  const [loaded, setLoaded] = useState({ subscriptions: false, courses: false });
  const [failed, setFailed] = useState({ subscriptions: false, courses: false });
  const [ordersState, setOrdersState] = useState<ReadState>("loading");
  const [ledgersState, setLedgersState] = useState<ReadState>("loading");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    return subscribeToTeacherCourseSubscriptions(
      user.uid,
      (next) => {
        setSubscriptions(next);
        setFailed((current) => ({ ...current, subscriptions: false }));
        setLoaded((current) => ({ ...current, subscriptions: true }));
      },
      () => {
        setErrorKey(`${copy}.subscribersError`);
        setFailed((current) => ({ ...current, subscriptions: true }));
        setLoaded((current) => ({ ...current, subscriptions: true }));
      },
    );
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return subscribeToTeacherCourses(
      user.uid,
      (next) => {
        setCourses(next);
        setFailed((current) => ({ ...current, courses: false }));
        setLoaded((current) => ({ ...current, courses: true }));
      },
      () => {
        setErrorKey(`${copy}.productsError`);
        setFailed((current) => ({ ...current, courses: true }));
        setLoaded((current) => ({ ...current, courses: true }));
      },
    );
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return subscribeToTeacherOrders(
      user.uid,
      (next) => {
        setOrders(next);
        setOrdersState("ready");
      },
      () => {
        setOrdersState("error");
        setErrorKey(`${copy}.ordersError`);
      },
    );
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return subscribeToTeacherPayoutLedger(
      user.uid,
      (next) => {
        setLedgers(next);
        setLedgersState("ready");
      },
      () => {
        setLedgersState("error");
        setErrorKey(`${copy}.ledgersError`);
      },
    );
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let current = true;
    // Refetched whenever the subscription list changes so a new subscriber
    // shows up by name, not as a masked id.
    void getMySubscriberProfiles()
      .then((next) => {
        if (current) setProfiles(next);
      })
      .catch(() => {
        if (current) setProfiles([]);
      });
    return () => {
      current = false;
    };
  }, [user, subscriptions]);

  if (!loaded.subscriptions || !loaded.courses) {
    return <SubscriptionCenterLoading />;
  }

  if (failed.subscriptions || failed.courses) {
    return (
      <InlineAlert tone="error">
        {t(errorKey || `${copy}.reportingError`)}
      </InlineAlert>
    );
  }

  const financialState: ReadState =
    ordersState === "error" || ledgersState === "error"
      ? "error"
      : ordersState === "ready" && ledgersState === "ready"
        ? "ready"
        : "loading";

  return (
    <>
      {errorKey ? (
        <InlineAlert tone="error" className="mb-5">
          {t(errorKey)}
        </InlineAlert>
      ) : null}
      <CreatorSubscriptionCenterView
        subscriptions={subscriptions}
        courses={courses}
        orders={orders}
        ledgers={ledgers}
        profiles={profiles}
        financialState={financialState}
      />
    </>
  );
}

export function CreatorSubscriptionCenterView({
  subscriptions,
  courses,
  orders,
  ledgers,
  profiles,
  financialState = "ready",
}: {
  subscriptions: CourseSubscription[];
  courses: TeacherCourse[];
  orders: Order[];
  ledgers: PayoutLedgerEntry[];
  profiles: SubscriberProfile[];
  financialState?: ReadState;
}) {
  const { locale, t } = useTranslation();
  const [tab, setTab] = useState<"subscribers" | "renewals">("subscribers");
  const [filter, setFilter] = useState<SubscriberFilter>("all");
  const [query, setQuery] = useState("");
  const metrics = useMemo(
    () => calculateCreatorSubscriptionMetrics(
      subscriptions,
      courses,
      undefined,
      { orders, ledgers },
    ),
    [subscriptions, courses, orders, ledgers],
  );
  const renewals = useMemo(
    () => buildCreatorRenewalHistory(ledgers, orders),
    [ledgers, orders],
  );
  const profilesById = useMemo(
    () => new Map(profiles.map((profile) => [profile.uid, profile])),
    [profiles],
  );
  const coursesById = useMemo(
    () => new Map(courses.map((course) => [course.id, course])),
    [courses],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSubscriptions = subscriptions
    .filter((subscription) => matchesFilter(subscription, filter))
    .filter((subscription) => {
      if (!normalizedQuery) return true;
      const profile = profilesById.get(subscription.userId);
      const course = coursesById.get(subscription.courseId);
      return [
        profile?.displayName,
        subscription.userId,
        course?.title,
      ].some((value) => value?.toLowerCase().includes(normalizedQuery));
    })
    .sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));

  if (subscriptions.length === 0 && courses.every((course) => !isRecurringCourse(course))) {
    return (
      <section className="border-y border-[var(--color-line)] py-12 text-center">
        <CalendarClock aria-hidden="true" size={30} className="mx-auto text-[var(--color-accent-fg)]" />
        <h2 className="mt-4 text-xl font-bold text-[var(--color-primary)]">
          {t(`${copy}.noProductsTitle`)}
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-7 text-[var(--color-ink-soft)]">
          {t(`${copy}.noProductsDetail`)}
        </p>
        <Link href="/teach/builder" className={buttonClasses({}, "mt-5")}>
          {t(`${copy}.createProduct`)}
        </Link>
      </section>
    );
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t(`${copy}.metricsLabel`)}>
        <MetricCard
          label={t(`${copy}.activeSubscribers`)}
          value={countLabel(t, `${copy}.activeOne`, `${copy}.activeMany`, metrics.activeCount)}
          detail={countLabel(t, `${copy}.scheduledOne`, `${copy}.scheduledMany`, metrics.cancelScheduledCount)}
          icon={Users}
        />
        <MetricCard
          label={t(`${copy}.mrr`)}
          value={financialState === "ready"
            ? formatMrr(metrics.mrrByCurrency, t(`${copy}.mrrEmpty`))
            : financialState === "error"
              ? t("teach.reports.unavailable")
              : "—"}
          detail={financialState === "ready"
            ? formatMrrDetail(metrics, t)
            : financialState === "error"
              ? t(`${copy}.mrrError`)
              : t(`${copy}.mrrLoading`)}
          icon={Receipt}
        />
        <MetricCard
          label={t(`${copy}.paymentAttention`)}
          value={String(metrics.pastDueCount)}
          detail={t(`${copy}.pastDueDetail`)}
          icon={AlertTriangle}
        />
        <MetricCard
          label={t(`${copy}.churn`)}
          value={`${metrics.observedChurnRate}%`}
          detail={countLabel(t, `${copy}.canceledOne`, `${copy}.canceledMany`, metrics.canceledLast30Days)}
          icon={CalendarClock}
        />
      </section>

      <section className="border-y border-[var(--color-line)] py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="inline-flex rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] p-1" role="tablist">
            <TabButton active={tab === "subscribers"} onClick={() => setTab("subscribers")}>
              {t(`${copy}.subscribers`)}
            </TabButton>
            <TabButton active={tab === "renewals"} onClick={() => setTab("renewals")}>
              {t(`${copy}.renewals`)}
            </TabButton>
          </div>
          <Link href="/teach/sales" className="text-sm font-semibold text-[var(--color-primary)] hover:underline">
            {t("teach.reports.linkSales")}
          </Link>
        </div>

        {tab === "subscribers" ? (
          <div className="mt-5 grid gap-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="relative flex-1">
                <span className="sr-only">{t(`${copy}.searchLabel`)}</span>
                <Search aria-hidden="true" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-muted)]" />
                <input
                  aria-label={t(`${copy}.searchLabel`)}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t(`${copy}.searchPlaceholder`)}
                  className="min-h-11 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-primary-light)]"
                />
              </label>
              <select
                aria-label={t(`${copy}.filterLabel`)}
                value={filter}
                onChange={(event) => setFilter(event.target.value as SubscriberFilter)}
                className="min-h-11 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm font-semibold text-[var(--color-primary)]"
              >
                <option value="all">{t("creatorPanel.sales.status.all")}</option>
                <option value="active">{t("statusChip.active")}</option>
                <option value="attention">{t("creatorPanel.filters.needsAttention")}</option>
                <option value="canceling">{t(`${copy}.canceling`)}</option>
                <option value="ended">{t(`${copy}.ended`)}</option>
              </select>
            </div>

            {filteredSubscriptions.length ? (
              <>
                <div className="grid md:hidden">
                  {filteredSubscriptions.map((subscription) => {
                    const profile = profilesById.get(subscription.userId);
                    const course = coursesById.get(subscription.courseId);
                    return (
                      <article
                        key={subscription.id}
                        className="grid gap-3 border-b border-[var(--color-line)] py-4 last:border-0"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-[var(--color-primary)]">
                              {profile?.displayName || maskLearner(subscription.userId, t("roles.learner"))}
                            </p>
                            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                              {maskLearner(subscription.userId, t("roles.learner"))}
                            </p>
                          </div>
                          <StatusChip
                            status={subscription.status}
                            label={formatStatus(subscription.status, t)}
                            className="shrink-0"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <p className="font-bold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
                              {t("creatorPanel.products.columns.product")}
                            </p>
                            <p className="mt-1 font-semibold text-[var(--color-ink)]">
                              {course?.title || subscription.courseId}
                            </p>
                          </div>
                          <div>
                            <p className="font-bold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
                              {t("account.billing")}
                            </p>
                            <p className="mt-1 text-[var(--color-ink-soft)]">
                              {t(subscription.interval === "year" ? "publicPages.pricing.yearly" : "publicPages.pricing.monthly")}
                            </p>
                          </div>
                        </div>
                        <p className="text-xs text-[var(--color-ink-soft)]">
                          {t(subscription.cancelAtPeriodEnd ? `${copy}.cancels` : `${copy}.renews`)} {formatDate(subscription.currentPeriodEnd, locale, t("creatorPanel.sales.datePending"))}
                        </p>
                      </article>
                    );
                  })}
                </div>

                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[760px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-[var(--color-line)] text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">
                      <th className="px-3 py-3">{t(`${copy}.subscriber`)}</th>
                      <th className="px-3 py-3">{t("creatorPanel.products.columns.product")}</th>
                      <th className="px-3 py-3">{t("creatorPanel.products.status")}</th>
                      <th className="px-3 py-3">{t(`${copy}.cadence`)}</th>
                      <th className="px-3 py-3">{t(`${copy}.nextEvent`)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSubscriptions.map((subscription) => {
                      const profile = profilesById.get(subscription.userId);
                      const course = coursesById.get(subscription.courseId);
                      return (
                        <tr key={subscription.id} className="border-b border-[var(--color-line)] last:border-0">
                          <td className="px-3 py-4">
                            <p className="text-sm font-bold text-[var(--color-primary)]">
                              {profile?.displayName || maskLearner(subscription.userId, t("roles.learner"))}
                            </p>
                            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{maskLearner(subscription.userId, t("roles.learner"))}</p>
                          </td>
                          <td className="px-3 py-4 text-sm font-semibold text-[var(--color-ink)]">
                            {course?.title || subscription.courseId}
                          </td>
                          <td className="px-3 py-4">
                            <StatusChip status={subscription.status} label={formatStatus(subscription.status, t)} />
                          </td>
                          <td className="px-3 py-4 text-sm text-[var(--color-ink-soft)]">
                            {t(subscription.interval === "year" ? "publicPages.pricing.yearly" : "publicPages.pricing.monthly")}
                          </td>
                          <td className="px-3 py-4 text-sm text-[var(--color-ink-soft)]">
                            {t(subscription.cancelAtPeriodEnd ? `${copy}.cancels` : `${copy}.renews`)} {formatDate(subscription.currentPeriodEnd, locale, t("creatorPanel.sales.datePending"))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="border-y border-[var(--color-line)] py-8 text-center text-sm text-[var(--color-ink-soft)]">
                {subscriptions.length === 0
                  ? t(`${copy}.noSubscribers`)
                  : t(`${copy}.noMatch`)}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-5 grid gap-0">
            {financialState === "loading" ? (
              <p className="border-y border-[var(--color-line)] py-8 text-center text-sm text-[var(--color-ink-soft)]">
                {t(`${copy}.renewalsLoading`)}
              </p>
            ) : financialState === "error" ? (
              <p className="border-y border-[var(--color-line)] py-8 text-center text-sm text-[var(--color-ink-soft)]">
                {t(`${copy}.renewalsError`)}
              </p>
            ) : renewals.length ? renewals.slice(0, 50).map((renewal) => {
              const profile = renewal.userId ? profilesById.get(renewal.userId) : null;
              return (
                <article key={renewal.id} className="flex flex-col justify-between gap-3 border-b border-[var(--color-line)] py-4 sm:flex-row sm:items-center">
                  <div>
                    <p className="text-sm font-bold text-[var(--color-primary)]">{t(`${copy}.renewalLabel`).replace("{id}", () => renewal.id)}</p>
                    <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                      {profile?.displayName || (renewal.userId ? maskLearner(renewal.userId, t("roles.learner")) : t(`${copy}.historicalSubscriber`))} / {renewal.courseTitle} / {formatDate(renewal.createdAt, locale, t("creatorPanel.sales.datePending"))}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusChip status={renewal.status} label={formatStatus(renewal.status, t)} />
                    <p className="text-sm font-bold text-[var(--color-primary)]">
                      {t("publicPages.pricing.gross")} {renewal.currency} {(renewal.grossAmountMinor / 100).toFixed(2)}
                    </p>
                  </div>
                </article>
              );
            }) : (
              <p className="border-y border-[var(--color-line)] py-8 text-center text-sm text-[var(--color-ink-soft)]">
                {t(`${copy}.renewalsEmpty`)}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof Users }) {
  return (
    <Card as="article" padding="sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">{label}</p>
        <Icon aria-hidden="true" size={16} className="shrink-0 text-[var(--color-accent-fg)]" />
      </div>
      <p className="mt-3 text-2xl font-bold text-[var(--color-primary)]">{value}</p>
      <p className="mt-2 text-xs leading-5 text-[var(--color-ink-soft)]">{detail}</p>
    </Card>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`min-h-11 rounded-[var(--radius-xs)] px-4 text-sm font-bold ${active ? "bg-[var(--color-primary)] text-white" : "text-[var(--color-ink-soft)] hover:text-[var(--color-primary)]"}`}
    >
      {children}
    </button>
  );
}

function SubscriptionCenterLoading() {
  const { t } = useTranslation();
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t(`${copy}.loading`)}>
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="h-32 animate-pulse rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)]" />
      ))}
    </section>
  );
}

function matchesFilter(subscription: CourseSubscription, filter: SubscriberFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return ["active", "trialing"].includes(subscription.status);
  if (filter === "attention") return subscription.pastDue === true || ["past_due", "unpaid"].includes(subscription.status);
  if (filter === "canceling") return subscription.cancelAtPeriodEnd === true;
  return ["canceled", "incomplete_expired", "paused"].includes(subscription.status);
}

function isRecurringCourse(course: TeacherCourse): boolean {
  return course.paymentType === "subscription_monthly" || course.paymentType === "subscription_yearly";
}

function formatMrr(values: Array<{ currency: string; amountMinor: number }>, emptyLabel: string): string {
  if (!values.length) return emptyLabel;
  return values.map((value) => `${value.currency} ${(value.amountMinor / 100).toFixed(2)}`).join(" + ");
}

function formatMrrDetail(metrics: ReturnType<typeof calculateCreatorSubscriptionMetrics>, t: Translate): string {
  const details = [t(`${copy}.mrrNormalized`)];
  if (metrics.mrrLegacyFallbackCount > 0) {
    details.push(
      countLabel(t, `${copy}.mrrLegacyOne`, `${copy}.mrrLegacyMany`, metrics.mrrLegacyFallbackCount),
    );
  }
  if (metrics.mrrSnapshotMissingCount > 0) {
    details.push(
      countLabel(t, `${copy}.mrrMissingOne`, `${copy}.mrrMissingMany`, metrics.mrrSnapshotMissingCount),
    );
  }
  return details.join(" · ");
}

function formatStatus(status: string, t: Translate): string | undefined {
  switch (status) {
    case "canceled": return t("statusChip.cancelled");
    case "trialing": return t(`${copy}.statusTrialing`);
    case "past_due": return t(`${copy}.statusPastDue`);
    case "unpaid": return t(`${copy}.statusUnpaid`);
    case "incomplete": return t(`${copy}.statusIncomplete`);
    case "incomplete_expired": return t(`${copy}.statusIncompleteExpired`);
    case "paused": return t(`${copy}.statusPaused`);
    case "settled":
    case "in_release":
    case "releasing":
    case "released":
    case "released_advance": return t("teach.earnings.statusRecorded");
    case "disputed": return t("teach.earnings.statusDisputed");
    default: return undefined;
  }
}

function formatDate(value: unknown, locale: Locale, fallback: string): string {
  const date = toDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

function maskLearner(userId: string, label: string): string {
  return `${label} ...${userId.slice(-6)}`;
}

function toMillis(value: unknown): number {
  return toDate(value)?.getTime() ?? 0;
}
