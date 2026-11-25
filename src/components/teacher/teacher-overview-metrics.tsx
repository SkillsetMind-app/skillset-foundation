"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { MetricCard } from "@/components/teacher/metric-card";
import { groupPaidOrdersByCurrency } from "@/domain/creator-reports";
import { isRevenueOrder, type Order } from "@/domain/order";
import type { TeacherCourse } from "@/domain/teacher-course";
import { toDate } from "@/lib/format-date";
import { formatMoneyBreakdown } from "@/lib/format-money";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// A delta is shown ONLY when there is a real prior-period baseline to compare
// against. With no baseline we return null and render no trend at all, rather
// than a fabricated "+0.0% vs prev period".
function percentDelta(
  current: number,
  prior: number,
): { label: string; up: boolean } | null {
  if (prior <= 0) {
    return null;
  }

  const pct = ((current - prior) / prior) * 100;
  const up = pct >= 0;

  return { label: `${up ? "+" : ""}${pct.toFixed(1)}%`, up };
}

// The Home loads courses and orders once and passes them down; this block used
// to open its own two subscriptions on top of the Home's.
export function TeacherOverviewMetrics({
  courses,
  orders,
  isLoading,
  ordersFailed = false,
}: {
  courses: TeacherCourse[];
  orders: Order[];
  isLoading: boolean;
  /** The orders read failed: revenue and learners say "Unavailable", never 0. */
  ordersFailed?: boolean;
}) {
  const { locale, t } = useTranslation();
  const [now] = useState(() => Date.now());

  const approvedCount = courses.filter(
    (course) => course.status === "published",
  ).length;
  const inReviewCount = courses.filter(
    (course) => course.status === "in_review",
  ).length;
  // Paid or partially refunded (counts what was left).
  const paidOrders = orders.filter(isRevenueOrder);

  // Before the 1st sale the four tiles were $0 / 0 / -- / --: only a negative
  // phrase on the first visit. They show up with the first paid order OR the
  // first enrollment: a free enrollment does not record an order, and whoever only sells
  // for free has real numbers (average rating, enrollments) to look at.
  const hasEnrollment = courses.some((course) => (course.enrollmentCount ?? 0) > 0);
  if (paidOrders.length === 0 && !hasEnrollment) {
    return null;
  }

  const paidOrders30d = paidOrders.filter((order) => {
    const createdAt = getTimestampMillis(order.createdAt);

    // Exclude orders with an unresolvable createdAt (symmetric with the prior
    // window below, which requires a real timestamp). Counting them in the
    // current window only skewed the 30d total + vs-prev delta upward.
    if (!createdAt) {
      return false;
    }

    return now - createdAt <= 30 * 24 * 60 * 60 * 1000;
  });
  // Revenue PER CURRENCY: R$100 and $20 were added up and written "$120". One currency
  // comes out in it; several come out side by side, the largest first; none, zero in the
  // only currency the teacher has ever sold in (or a plain "0").
  const revenue30d = groupPaidOrdersByCurrency(paidOrders30d)
    .map((group) => ({ currency: group.currency, amountMinor: group.totalMinor }))
    .sort((left, right) => right.amountMinor - left.amountMinor);
  const knownCurrencies = groupPaidOrdersByCurrency(paidOrders);
  const zeroCurrency = knownCurrencies.length === 1 ? knownCurrencies[0].currency : null;

  // Prior 30-day window (days 31-60), real timestamps only, so the deltas
  // below compare against an actual baseline rather than a fabricated one.
  const prevWindow = paidOrders.filter((order) => {
    const createdAt = getTimestampMillis(order.createdAt);

    return (
      createdAt !== null &&
      now - createdAt > THIRTY_DAYS_MS &&
      now - createdAt <= 2 * THIRTY_DAYS_MS
    );
  });
  // The change only compares currency with currency: with more than one currency in both
  // windows there is no honest number, and the arrow goes away.
  const comparable = groupPaidOrdersByCurrency([...paidOrders30d, ...prevWindow]);
  const revenueDelta =
    comparable.length === 1
      ? percentDelta(
          revenue30d[0]?.amountMinor ?? 0,
          groupPaidOrdersByCurrency(prevWindow)[0]?.totalMinor ?? 0,
        )
      : null;
  const newStudentsPrev30d = prevWindow.length;

  const ratingCount = courses.reduce(
    (sum, course) => sum + (course.ratingCount ?? 0),
    0,
  );
  const ratingSum = courses.reduce(
    (sum, course) =>
      sum + (course.ratingAverage ?? 0) * (course.ratingCount ?? 0),
    0,
  );
  const averageRating = ratingCount ? ratingSum / ratingCount : null;

  const cards: {
    label: string;
    value: string;
    hint: string;
    delta: { label: string; up: boolean } | null;
    unavailable?: boolean;
  }[] = [
    {
      label: t("teach.metrics.revenue30d"),
      value: ordersFailed
        ? t("teach.reports.unavailable")
        : formatMoneyBreakdown(revenue30d, locale, zeroCurrency, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          }),
      hint: paidOrders30d.length
        ? t("teach.metrics.revenueHintPaid")
        : t("teach.metrics.revenueHintEmpty"),
      delta: ordersFailed ? null : revenueDelta,
      unavailable: ordersFailed,
    },
    {
      label: t("teach.metrics.newStudents"),
      value: ordersFailed ? t("teach.reports.unavailable") : String(paidOrders30d.length),
      hint: paidOrders30d.length
        ? t("teach.metrics.newStudentsHintPaid")
        : t("teach.metrics.newStudentsHintEmpty"),
      delta: ordersFailed ? null : percentDelta(paidOrders30d.length, newStudentsPrev30d),
      unavailable: ordersFailed,
    },
    // The "Completion" tile is gone: the value was fixed at "--", with the hint
    // "Appears once learners finish lessons", which never came true. It comes back
    // when the Home has measured completion.
    {
      label: t("teach.metrics.avgRating"),
      value: averageRating ? averageRating.toFixed(1) : "--",
      hint: ratingCount
        ? t(
            ratingCount === 1
              ? "teach.metrics.reviewsSingular"
              : "teach.metrics.reviewsPlural",
          ).replace("{count}", String(ratingCount))
        : t("teach.metrics.ratingHintEmpty"),
      delta: null,
    },
  ];

  return (
    <section className="grid gap-4 md:grid-cols-3">
      {cards.map((card) => (
        <MetricCard
          key={card.label}
          label={card.label}
          value={card.value}
          loading={isLoading}
          unavailable={card.unavailable}
          hint={card.hint}
          trend={
            card.delta ? (
              <span
                className={`inline-flex items-center gap-1 text-xs font-bold ${
                  card.delta.up
                    ? "text-[var(--color-success-fg)]"
                    : "text-[var(--color-danger-fg)]"
                }`}
              >
                {card.delta.up ? (
                  <TrendingUp aria-hidden="true" size={13} />
                ) : (
                  <TrendingDown aria-hidden="true" size={13} />
                )}
                {card.delta.label}
                <span className="font-semibold text-[var(--color-ink-soft)]">
                  {t("teach.metrics.vsPrev30d")}
                </span>
              </span>
            ) : null
          }
        />
      ))}
      <span className="sr-only">
        {t("teach.metrics.srSummary")
          .replace("{published}", String(approvedCount))
          .replace("{inReview}", String(inReviewCount))}
      </span>
    </section>
  );
}

function getTimestampMillis(value: unknown): number | null {
  return toDate(value)?.getTime() ?? null;
}
