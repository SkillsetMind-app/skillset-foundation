"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { TeacherOverviewMetrics } from "@/components/teacher/teacher-overview-metrics";
import { TeacherStudioInsights } from "@/components/teacher/teacher-studio-insights";
import type { Order } from "@/domain/order";
import type { TeacherCourse } from "@/domain/teacher-course";
import type { PayoutLedgerEntry } from "@/domain/payout-ledger";
import { subscribeToTeacherOrders } from "@/lib/data/orders";
import { subscribeToTeacherPayoutLedger } from "@/lib/data/payout-ledger";
import { logSubscriptionError } from "@/lib/data/subscription-error";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";

// Whole-dollar formatter for the compact hero payout chip (mirrors the
// formatter in teacher-studio-insights.tsx so the figure reads identically).
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function TeacherStudioDashboard() {
  const { user } = useAuth();
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [ledger, setLedger] = useState<PayoutLedgerEntry[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [payoutsReady, setPayoutsReady] = useState(false);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const firstName = user?.displayName?.trim().split(/\s+/)[0] ?? "there";
  const publishedCourses = courses.filter((course) => course.status === "published");
  const draftCourses = courses.filter((course) => course.status === "draft");
  const nextPayout = useMemo(() => getNextPayoutLabel(ledger), [ledger]);

  // Compact hero payout chip figure. Mirror of the net-payout computation in
  // teacher-studio-insights.tsx / teacher-wallet-panel.tsx: gross paid orders
  // minus the per-order platform commission, floored at zero. Kept local so the
  // hero stays self-contained instead of coupling to the insights component.
  const paidOrders = orders.filter((order) => order.status === "paid");
  const grossMinor = paidOrders.reduce((sum, order) => sum + order.amountMinor, 0);
  const platformFeeMinor = paidOrders.reduce(
    (sum, order) => sum + Math.floor((order.amountMinor * order.platformFeeBps) / 10000),
    0,
  );
  const netMinor = Math.max(0, grossMinor - platformFeeMinor);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherCourses(
      user.uid,
      (nextCourses) => {
        setCourses(nextCourses);
        setCoursesLoaded(true);
      },
      (error) => {
        logSubscriptionError("TeacherStudioDashboard.courses")(error);
        setCoursesLoaded(true);
      },
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherPayoutLedger(
      user.uid,
      setLedger,
      logSubscriptionError("TeacherStudioDashboard.payoutLedger"),
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherOrders(
      user.uid,
      setOrders,
      logSubscriptionError("TeacherStudioDashboard.orders"),
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToUserProfile(
      user.uid,
      (profile) => {
        setPayoutsReady(Boolean(
          profile?.stripeConnectChargesEnabled
          && profile?.stripeConnectPayoutsEnabled,
        ));
      },
      () => setPayoutsReady(false),
    );
  }, [user]);

  return (
    <div className="grid gap-6">
      <section className="studio-welcome-card dash-card dash-card--strong p-5 sm:p-6">
        <div className="relative z-[1] flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--color-accent-fg)]">
              Teacher Studio
            </p>
            <h1 className="display-title mt-2 text-3xl leading-[1.05] text-[var(--color-primary)] sm:text-4xl lg:text-5xl">
              Welcome back, {firstName}.
            </h1>
            {coursesLoaded ? (
              <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--color-ink-soft)]">
                You have{" "}
                <strong className="text-[var(--color-ink)]">
                  {publishedCourses.length} published{" "}
                  {publishedCourses.length === 1 ? "course" : "courses"}
                </strong>{" "}
                and{" "}
                <strong className="text-[var(--color-ink)]">
                  {draftCourses.length} draft{draftCourses.length === 1 ? "" : "s"}
                </strong>
                . Your next payout is{" "}
                <strong className="text-[var(--color-ink)]">{nextPayout}</strong>.
              </p>
            ) : (
              <div className="mt-3 h-6 w-3/4 max-w-2xl animate-pulse rounded bg-[var(--color-surface-strong)]" />
            )}
          </div>

          <div className="flex flex-col gap-3 lg:items-end">
            <Link
              href="/account/payments#stripe-connect"
              className="studio-payout-chip"
              aria-label={
                payoutsReady
                  ? `Next payout ${money.format(netMinor / 100)} — open payout settings`
                  : "Connect Stripe to enable payouts"
              }
            >
              <span className="studio-payout-chip__label">Next payout</span>
              <span className="studio-payout-chip__value">{money.format(netMinor / 100)}</span>
              <span className="studio-payout-chip__hint">
                {payoutsReady ? "Net after platform fee" : "Connect Stripe to enable"}
              </span>
            </Link>

            <div className="flex flex-wrap items-center gap-3 lg:justify-end">
              <Link
                href="/account?tab=profile"
                className="button-outline bg-white px-4 py-2.5 text-sm"
              >
                Public profile
              </Link>
              <Link
                href="/teach/builder?newCourse=1"
                className="button-solid px-5 py-2.5 text-sm"
              >
                New course
              </Link>
            </div>
          </div>
        </div>
      </section>

      <TeacherOverviewMetrics />
      <TeacherStudioInsights />
    </div>
  );
}

function getNextPayoutLabel(entries: PayoutLedgerEntry[]) {
  const nextRelease = entries
    .filter((entry) => entry.status === "in_release" || entry.status === "releasing")
    .map((entry) => getTimestampMillis(entry.releaseAt))
    .filter((value): value is number => Boolean(value))
    .sort((left, right) => left - right)[0];

  if (!nextRelease) {
    return "scheduled after your first paid order";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(nextRelease);
}

function getTimestampMillis(value: unknown): number | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "object" && "toMillis" in value) {
    const maybeTimestamp = value as { toMillis?: () => number };

    return typeof maybeTimestamp.toMillis === "function"
      ? maybeTimestamp.toMillis()
      : null;
  }

  if (typeof value === "object" && "seconds" in value) {
    const maybeTimestamp = value as { seconds?: number };

    return typeof maybeTimestamp.seconds === "number"
      ? maybeTimestamp.seconds * 1000
      : null;
  }

  return null;
}
