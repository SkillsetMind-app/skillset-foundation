"use client";

import { AlertTriangle, CalendarClock, Receipt, Search, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { StatusChip } from "@/components/shared/status-chip";
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

type SubscriberFilter = "all" | "active" | "attention" | "canceling" | "ended";
type ReadState = "loading" | "ready" | "error";

export function CreatorSubscriptionCenter() {
  const { user } = useAuth();
  const [subscriptions, setSubscriptions] = useState<CourseSubscription[]>([]);
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [ledgers, setLedgers] = useState<PayoutLedgerEntry[]>([]);
  const [profiles, setProfiles] = useState<SubscriberProfile[]>([]);
  const [loaded, setLoaded] = useState({ subscriptions: false, courses: false });
  const [failed, setFailed] = useState({ subscriptions: false, courses: false });
  const [ordersState, setOrdersState] = useState<ReadState>("loading");
  const [ledgersState, setLedgersState] = useState<ReadState>("loading");
  const [error, setError] = useState("");

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
        setError("We could not load your subscribers.");
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
        setError("We could not load subscription products.");
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
        setError("Renewal order details are temporarily unavailable.");
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
        setError("Renewal payout details are temporarily unavailable.");
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
      <p className="rounded-[8px] border border-[rgba(178,34,52,0.22)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
        {error || "Subscription reporting is temporarily unavailable."}
      </p>
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
      {error ? (
        <p className="mb-5 rounded-[8px] border border-[rgba(178,34,52,0.22)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          {error}
        </p>
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
          No subscription products yet.
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-7 text-[var(--color-ink-soft)]">
          Create a monthly or yearly product to start recurring billing and subscriber reporting.
        </p>
        <Link href="/teach/builder" className="button-solid mt-5 inline-flex px-4 py-2.5 text-sm">
          Create subscription product
        </Link>
      </section>
    );
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Subscription metrics">
        <MetricCard
          label="Active subscribers"
          value={`${metrics.activeCount} active`}
          detail={`${metrics.cancelScheduledCount} scheduled to cancel`}
          icon={Users}
        />
        <MetricCard
          label="Monthly recurring revenue"
          value={financialState === "ready"
            ? formatMrr(metrics.mrrByCurrency)
            : financialState === "error"
              ? "Unavailable"
              : "—"}
          detail={financialState === "ready"
            ? formatMrrDetail(metrics)
            : financialState === "error"
              ? "Contract pricing snapshots could not be loaded"
              : "Loading contract pricing snapshots"}
          icon={Receipt}
        />
        <MetricCard
          label="Payment attention"
          value={String(metrics.pastDueCount)}
          detail="Past-due subscribers needing recovery"
          icon={AlertTriangle}
        />
        <MetricCard
          label="Observed 30-day churn"
          value={`${metrics.observedChurnRate}%`}
          detail={`${metrics.canceledLast30Days} cancellations in the current mirror`}
          icon={CalendarClock}
        />
      </section>

      <section className="border-y border-[var(--color-line)] py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="inline-flex rounded-[8px] border border-[var(--color-line)] bg-white p-1" role="tablist">
            <TabButton active={tab === "subscribers"} onClick={() => setTab("subscribers")}>
              Subscribers
            </TabButton>
            <TabButton active={tab === "renewals"} onClick={() => setTab("renewals")}>
              Renewals
            </TabButton>
          </div>
          <Link href="/teach/sales" className="text-sm font-semibold text-[var(--color-primary)] hover:underline">
            All sales
          </Link>
        </div>

        {tab === "subscribers" ? (
          <div className="mt-5 grid gap-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="relative flex-1">
                <span className="sr-only">Search subscribers</span>
                <Search aria-hidden="true" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-muted)]" />
                <input
                  aria-label="Search subscribers"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search subscriber or product"
                  className="min-h-10 w-full rounded-[8px] border border-[var(--color-line)] bg-white py-2 pl-9 pr-3 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-primary-light)]"
                />
              </label>
              <select
                aria-label="Filter subscriber status"
                value={filter}
                onChange={(event) => setFilter(event.target.value as SubscriberFilter)}
                className="min-h-10 rounded-[8px] border border-[var(--color-line)] bg-white px-3 text-sm font-semibold text-[var(--color-primary)]"
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="attention">Needs attention</option>
                <option value="canceling">Canceling</option>
                <option value="ended">Ended</option>
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
                              {profile?.displayName || maskLearner(subscription.userId)}
                            </p>
                            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                              {maskLearner(subscription.userId)}
                            </p>
                          </div>
                          <StatusChip
                            status={subscription.status}
                            label={formatStatus(subscription.status)}
                            className="shrink-0"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <p className="font-bold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
                              Product
                            </p>
                            <p className="mt-1 font-semibold text-[var(--color-ink)]">
                              {course?.title || subscription.courseId}
                            </p>
                          </div>
                          <div>
                            <p className="font-bold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
                              Billing
                            </p>
                            <p className="mt-1 text-[var(--color-ink-soft)]">
                              {subscription.interval === "year" ? "Yearly" : "Monthly"}
                            </p>
                          </div>
                        </div>
                        <p className="text-xs text-[var(--color-ink-soft)]">
                          {subscription.cancelAtPeriodEnd ? "Cancels" : "Renews"} {formatDate(subscription.currentPeriodEnd)}
                        </p>
                      </article>
                    );
                  })}
                </div>

                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[760px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-[var(--color-line)] text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">
                      <th className="px-3 py-3">Subscriber</th>
                      <th className="px-3 py-3">Product</th>
                      <th className="px-3 py-3">Status</th>
                      <th className="px-3 py-3">Cadence</th>
                      <th className="px-3 py-3">Next event</th>
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
                              {profile?.displayName || maskLearner(subscription.userId)}
                            </p>
                            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{maskLearner(subscription.userId)}</p>
                          </td>
                          <td className="px-3 py-4 text-sm font-semibold text-[var(--color-ink)]">
                            {course?.title || subscription.courseId}
                          </td>
                          <td className="px-3 py-4">
                            <StatusChip status={subscription.status} label={formatStatus(subscription.status)} />
                          </td>
                          <td className="px-3 py-4 text-sm text-[var(--color-ink-soft)]">
                            {subscription.interval === "year" ? "Yearly" : "Monthly"}
                          </td>
                          <td className="px-3 py-4 text-sm text-[var(--color-ink-soft)]">
                            {subscription.cancelAtPeriodEnd ? "Cancels" : "Renews"} {formatDate(subscription.currentPeriodEnd)}
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
                  ? "No subscribers yet. Recurring checkout activity will appear here."
                  : "No subscribers match these filters."}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-5 grid gap-0">
            {financialState === "loading" ? (
              <p className="border-y border-[var(--color-line)] py-8 text-center text-sm text-[var(--color-ink-soft)]">
                Loading renewal history...
              </p>
            ) : financialState === "error" ? (
              <p className="border-y border-[var(--color-line)] py-8 text-center text-sm text-[var(--color-ink-soft)]">
                Renewal history is unavailable.
              </p>
            ) : renewals.length ? renewals.slice(0, 50).map((renewal) => {
              const profile = renewal.userId ? profilesById.get(renewal.userId) : null;
              return (
                <article key={renewal.id} className="flex flex-col justify-between gap-3 border-b border-[var(--color-line)] py-4 sm:flex-row sm:items-center">
                  <div>
                    <p className="text-sm font-bold text-[var(--color-primary)]">Renewal {renewal.id}</p>
                    <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                      {profile?.displayName || (renewal.userId ? maskLearner(renewal.userId) : "Historical subscriber")} / {renewal.courseTitle} / {formatDate(renewal.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusChip status={renewal.status} />
                    <p className="text-sm font-bold text-[var(--color-primary)]">
                      Gross {renewal.currency} {(renewal.grossAmountMinor / 100).toFixed(2)}
                    </p>
                  </div>
                </article>
              );
            }) : (
              <p className="border-y border-[var(--color-line)] py-8 text-center text-sm text-[var(--color-ink-soft)]">
                Renewal history appears after the first recurring invoice is paid.
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
    <article className="rounded-[8px] border border-[var(--color-line)] bg-white p-4 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">{label}</p>
        <Icon aria-hidden="true" size={16} className="shrink-0 text-[var(--color-accent-fg)]" />
      </div>
      <p className="mt-3 text-2xl font-bold text-[var(--color-primary)]">{value}</p>
      <p className="mt-2 text-xs leading-5 text-[var(--color-ink-soft)]">{detail}</p>
    </article>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`min-h-9 rounded-[6px] px-4 text-sm font-bold ${active ? "bg-[var(--color-primary)] text-white" : "text-[var(--color-ink-soft)] hover:text-[var(--color-primary)]"}`}
    >
      {children}
    </button>
  );
}

function SubscriptionCenterLoading() {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loading subscriptions">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="h-32 animate-pulse rounded-[8px] border border-[var(--color-line)] bg-white" />
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

function formatMrr(values: Array<{ currency: string; amountMinor: number }>): string {
  if (!values.length) return "No MRR yet";
  return values.map((value) => `${value.currency} ${(value.amountMinor / 100).toFixed(2)}`).join(" + ");
}

function formatMrrDetail(metrics: ReturnType<typeof calculateCreatorSubscriptionMetrics>): string {
  const details = ["Annual contracts normalized to one month"];
  if (metrics.mrrLegacyFallbackCount > 0) {
    details.push(
      `${metrics.mrrLegacyFallbackCount} legacy contract priced from invoice history`,
    );
  }
  if (metrics.mrrSnapshotMissingCount > 0) {
    details.push(
      `${metrics.mrrSnapshotMissingCount} contract pricing snapshot missing`,
    );
  }
  return details.join(" · ");
}

function formatStatus(status: string): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: unknown): string {
  const date = toDate(value);
  if (!date) return "date pending";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

function maskLearner(userId: string): string {
  return `Learner ...${userId.slice(-6)}`;
}

function toMillis(value: unknown): number {
  return toDate(value)?.getTime() ?? 0;
}
