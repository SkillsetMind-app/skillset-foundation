"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import type { Order } from "@/domain/order";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToTeacherOrders } from "@/lib/data/orders";
import { logSubscriptionError } from "@/lib/data/subscription-error";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";
import { toDate } from "@/lib/format-date";

const money = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

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

export function TeacherOverviewMetrics() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (!user) {
      return;
    }

    try {
      return subscribeToTeacherCourses(
        user.uid,
        (nextCourses) => {
          setCourses(nextCourses);
          setIsLoading(false);
        },
        () => setIsLoading(false),
      );
    } catch (error) {
      // Data layer unavailable (e.g. Supabase client not configured): degrade to an
      // empty state instead of crashing the teacher studio. Deliberate
      // one-shot recovery reset.
      console.warn(
        "TeacherOverviewMetrics: courses subscription unavailable",
        error,
      );
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    try {
      return subscribeToTeacherOrders(
        user.uid,
        setOrders,
        logSubscriptionError("TeacherOverviewMetrics.orders"),
      );
    } catch (error) {
      // Non-blocking metric: degrade silently in the UI but keep the failure
      // visible in logs.
      console.warn(
        "TeacherOverviewMetrics: orders subscription unavailable",
        error,
      );
    }
  }, [user]);

  const approvedCount = courses.filter(
    (course) => course.status === "published",
  ).length;
  const inReviewCount = courses.filter(
    (course) => course.status === "in_review",
  ).length;
  const paidOrders = orders.filter((order) => order.status === "paid");
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
  const gross30dMinor = paidOrders30d.reduce(
    (sum, order) => sum + order.amountMinor,
    0,
  );

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
  const grossPrev30dMinor = prevWindow.reduce(
    (sum, order) => sum + order.amountMinor,
    0,
  );
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
  }[] = [
    {
      label: t("teach.metrics.revenue30d"),
      value: money.format(gross30dMinor / 100),
      hint: paidOrders30d.length
        ? t("teach.metrics.revenueHintPaid")
        : t("teach.metrics.revenueHintEmpty"),
      delta: percentDelta(gross30dMinor, grossPrev30dMinor),
    },
    {
      label: t("teach.metrics.newStudents"),
      value: String(paidOrders30d.length),
      hint: paidOrders30d.length
        ? t("teach.metrics.newStudentsHintPaid")
        : t("teach.metrics.newStudentsHintEmpty"),
      delta: percentDelta(paidOrders30d.length, newStudentsPrev30d),
    },
    {
      // Completion is not measured yet: show an honest placeholder, never 0%
      // (which would read as a real measurement of zero progress).
      label: t("teach.metrics.completion"),
      value: "--",
      hint: t("teach.metrics.completionHint"),
      delta: null,
    },
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
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="studio-kpi-card dash-card dash-card--strong p-5"
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-ink-muted)]">
            {card.label}
          </p>
          {isLoading ? (
            <div className="mt-3 h-8 w-24 animate-pulse rounded bg-[var(--color-surface-strong)]" />
          ) : (
            <p className="mt-2 text-4xl font-bold tracking-[-0.04em] text-[var(--color-primary)]">
              {card.value}
            </p>
          )}
          {!isLoading && card.delta ? (
            <div
              className={`mt-2 inline-flex items-center gap-1 text-xs font-bold ${
                card.delta.up
                  ? "text-[var(--color-success-fg)]"
                  : "text-[var(--color-accent-fg)]"
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
            </div>
          ) : null}
          <p className="mt-2 max-w-[13rem] text-xs leading-5 text-[var(--color-ink-soft)]">
            {card.hint}
          </p>
        </div>
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
