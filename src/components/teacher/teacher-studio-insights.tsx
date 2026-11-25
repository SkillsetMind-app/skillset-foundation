"use client";

import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  Clock3,
  Flag,
  MessageSquareText,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { PeriodTabs } from "@/components/shared/period-tabs";
import { StatusChip } from "@/components/shared/status-chip";
import { RevenueChart } from "@/components/teacher/revenue-chart";
import {
  buildRevenueSeries,
  groupPaidOrdersByCurrency,
  isWithinWindow,
  resolveRevenueRangeWindow,
  type RevenueRange,
} from "@/domain/creator-reports";
import { isRevenueOrder, type Order } from "@/domain/order";
import type { TeacherCourse } from "@/domain/teacher-course";
import { formatMoney, formatMoneyBreakdown } from "@/lib/format-money";

const revenueRanges: RevenueRange[] = ["3m", "6m", "12m", "all"];

const revenueRangeSubtitleKey: Record<RevenueRange, string> = {
  "3m": "teach.insights.range3m",
  "6m": "teach.insights.range6m",
  "12m": "teach.insights.range12m",
  all: "teach.insights.rangeAll",
};

// Whole numbers and in en-US, as the chart has always written them; the currency is that
// of each value (it was fixed USD: R$100 + $20 came out "$120").
const WHOLE = { minimumFractionDigits: 0, maximumFractionDigits: 0 };

type ActivityItem = {
  title: string;
  detail: string;
  href: string;
  kind: "urgent" | "normal" | "success";
  icon: "alert" | "clock" | "flag" | "message" | "sparkle";
};

// The Home loads courses, orders and the profile once and passes them down;
// this block used to open its own three subscriptions on top of the Home's.
// The pending Stripe left here: it was the 4th time the same pending item showed up on the
// Home. The "Connect Stripe" step of the steps list is its owner.
export function TeacherStudioInsights({
  courses,
  orders,
}: {
  courses: TeacherCourse[];
  orders: Order[];
}) {
  const { locale, t } = useTranslation();
  const [revenueRange, setRevenueRange] = useState<RevenueRange>("12m");

  // Paid or partially refunded (counts what was left): the partial refund
  // vanished from revenue.
  const paidOrders = orders.filter(isRevenueOrder);
  // Sale history = a paid order exists, not "money came in": a paid order
  // of zero value (free product) is already history and deserves the chart.
  const hasSales = paidOrders.length > 0;
  // Nothing adds different currencies. The chart draws ONE: the one with the most orders in
  // the period (tie: alphabetical order); the others go on a line below.
  const revenue = useMemo(
    () => {
      const monthFormatter = new Intl.DateTimeFormat(locale, { month: "short" });
      const window = resolveRevenueRangeWindow(paidOrders, revenueRange);
      const allTime = groupPaidOrdersByCurrency(paidOrders);
      const charted =
        groupPaidOrdersByCurrency(
          paidOrders.filter((order) => isWithinWindow(order.createdAt, window)),
        )[0]?.currency ??
        allTime[0]?.currency ??
        "USD";
      return {
        currency: charted,
        points: buildRevenueSeries(paidOrders, window, (date) => monthFormatter.format(date), charted),
        // The total is still the usual one (all history), only in the currency
        // being drawn.
        totalMinor: allTime.find((group) => group.currency === charted)?.totalMinor ?? 0,
        // Only currencies with money: a "$0" on the other-currencies line says nothing.
        others: allTime
          .filter((group) => group.currency !== charted && group.totalMinor !== 0)
          .map((group) => ({ currency: group.currency, amountMinor: group.totalMinor }))
          .sort((left, right) => right.amountMinor - left.amountMinor),
      };
    },
    [paidOrders, revenueRange, locale],
  );
  const topCourses = useMemo(
    () => buildTopCourses(courses, paidOrders, revenue.currency),
    [courses, paidOrders, revenue.currency],
  );
  const activity = buildActivity(courses, t);

  return (
    <div className="grid gap-8">
      {/* Revenue chart and Top courses only after the 1st sale. With no
          sale this block was ~700px of nothing: an empty chart
          saying "No revenue yet" and an empty list. The 4 tiles above
          always stay, with the empty-state hints they already have. */}
      {hasSales ? (
        <section className="studio-dashboard-grid">
          <RevenueChart
            points={revenue.points}
            currency={revenue.currency}
            note={
              revenue.others.length
                ? t("teach.insights.otherCurrencies").replace("{totals}", () =>
                    formatMoneyBreakdown(revenue.others, "en-US", null, WHOLE),
                  )
                : undefined
            }
            totalMinor={revenue.totalMinor}
            totalLabel={formatMoney(revenue.totalMinor, revenue.currency, "en-US", WHOLE)}
            title={t("teach.insights.revenue")}
            subtitle={t(revenueRangeSubtitleKey[revenueRange])}
            ariaLabel={t("teach.insights.chartAria")}
            emptyTitle={t("teach.insights.noRevenue")}
            emptyDetail={t("teach.insights.noRevenueDetail")}
            headerAction={
              <PeriodTabs
                options={revenueRanges}
                value={revenueRange}
                onChange={setRevenueRange}
                label={t("teach.insights.rangeGroupLabel")}
                renderLabel={(range) =>
                  range === "all" ? t("teach.insights.rangeAllTab") : range
                }
              />
            }
          />

          <aside className="grid gap-5">
            <div className="dash-card p-5">
              <div className="flex items-center justify-between gap-3">
                {/* Card title in the house text: the serif is only for the h1. */}
                <h3 className="text-lg font-semibold text-[var(--color-primary)]">
                  {t("teach.insights.topCourses")}
                </h3>
                <Link href="/teach/builder" className="button-outline px-3.5 py-2 text-xs">
                  {t("teach.insights.allCourses")}
                </Link>
              </div>
              <div className="mt-4 grid gap-3">
                {topCourses.length ? (
                  topCourses.map((course) => (
                    <Link
                      key={course.id}
                      href={`/teach/builder?courseId=${course.id}`}
                      className="studio-course-row"
                    >
                      <span className="studio-course-row__thumb">{course.code}</span>
                      <span className="min-w-0">
                        <strong>{course.title}</strong>
                        <small>
                          {t("teach.insights.courseMeta")
                            .replace("{lessons}", String(course.lessonCount))
                            .replace("{orders}", String(course.orders))}
                        </small>
                      </span>
                      <span className="studio-course-row__value">
                        <strong>
                          {formatMoneyBreakdown(course.revenue, "en-US", revenue.currency, WHOLE)}
                        </strong>
                        <StatusChip status={course.status} />
                      </span>
                    </Link>
                  ))
                ) : (
                  <RichEmptyLine
                    title={t("teach.insights.noCoursesTitle")}
                    detail={t("teach.insights.noCoursesDetail")}
                  />
                )}
              </div>
            </div>
          </aside>
        </section>
      ) : null}

      <section>
        {/* .sec-head and .eyebrow.brand had no CSS: the h2 came out unstyled. */}
        <h2 className="text-xl font-semibold text-[var(--color-primary)]">
          {t("teach.insights.activityTitle")}
        </h2>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {activity.map((item) => (
            <Link key={item.title} href={item.href} className="studio-activity-card">
              <span className={`studio-activity-card__icon is-${item.kind}`}>
                {renderActivityIcon(item.icon)}
              </span>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
              <span className="studio-activity-card__open">
                {t("teach.insights.open")} <ArrowUpRight aria-hidden="true" size={13} />
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function RichEmptyLine({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-4">
      <p className="text-sm font-semibold text-[var(--color-ink)]">{title}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">{detail}</p>
    </div>
  );
}

// Revenue of each product by currency, each in its own value. The order uses the
// chart's currency, so as not to compare reais with dollars.
function buildTopCourses(courses: TeacherCourse[], paidOrders: Order[], chartedCurrency: string) {
  const byCourse = new Map<string, Order[]>();

  paidOrders.forEach((order) => {
    byCourse.set(order.courseId, [...(byCourse.get(order.courseId) ?? []), order]);
  });

  return courses
    .map((course) => {
      const groups = groupPaidOrdersByCurrency(byCourse.get(course.id) ?? []);

      return {
        id: course.id,
        title: course.title,
        status: course.status,
        lessonCount: course.lessonCount,
        code: buildCourseCode(course.title),
        orders: groups.reduce((sum, group) => sum + group.orders, 0),
        revenue: groups
          .map((group) => ({ currency: group.currency, amountMinor: group.totalMinor }))
          .sort((left, right) => right.amountMinor - left.amountMinor),
        chartedMinor: groups.find((group) => group.currency === chartedCurrency)?.totalMinor ?? 0,
      };
    })
    // Orders before lessons: a product that only sold in another currency does not fall
    // below one that never sold.
    .sort(
      (a, b) =>
        b.chartedMinor - a.chartedMinor || b.orders - a.orders || b.lessonCount - a.lessonCount,
    )
    .slice(0, 3);
}

function buildActivity(
  courses: TeacherCourse[],
  t: (key: string) => string,
): ActivityItem[] {
  const items: ActivityItem[] = [];
  const emptyDraft = courses.find((course) => course.status === "draft" && course.lessonCount === 0);
  const reviewReadyDraft = courses.find((course) => course.status === "draft" && course.lessonCount > 0);
  const needsChanges = courses.find((course) => course.status === "needs_changes");
  const inReview = courses.find((course) => course.status === "in_review");

  if (needsChanges) {
    items.push({
      title: t("teach.insights.actChangesTitle"),
      detail: t("teach.insights.actChangesDetail").replace("{title}", () => needsChanges.title),
      href: `/teach/builder?courseId=${encodeURIComponent(needsChanges.id)}&tab=review`,
      kind: "urgent",
      icon: "flag",
    });
  }

  if (emptyDraft) {
    items.push({
      title: t("teach.insights.actEmptyDraftTitle"),
      detail: t("teach.insights.actEmptyDraftDetail").replace("{title}", () => emptyDraft.title),
      href: `/teach/builder?courseId=${emptyDraft.id}`,
      kind: "normal",
      icon: "clock",
    });
  }

  if (!courses.length) {
    items.push({
      title: t("teach.insights.actFirstCourseTitle"),
      detail: t("teach.insights.actFirstCourseDetail"),
      href: "/teach/builder?newCourse=1",
      kind: "normal",
      icon: "sparkle",
    });
  }

  if (reviewReadyDraft) {
    items.push({
      title: t("teach.insights.actSubmitTitle"),
      detail: t("teach.insights.actSubmitDetail").replace("{title}", () => reviewReadyDraft.title),
      href: `/teach/builder?courseId=${encodeURIComponent(reviewReadyDraft.id)}&tab=review`,
      kind: "success",
      icon: "sparkle",
    });
  }

  if (inReview) {
    items.push({
      title: t("teach.insights.actInReviewTitle"),
      detail: t("teach.insights.actInReviewDetail").replace("{title}", () => inReview.title),
      href: `/teach/builder?courseId=${encodeURIComponent(inReview.id)}&tab=review`,
      kind: "normal",
      icon: "clock",
    });
  }

  items.push({
    title: t("teach.insights.actQuestionsTitle"),
    detail: t("teach.insights.actQuestionsDetail"),
    // Was /learn/community/creator, which needs a courseId and, without one,
    // told the course OWNER to "open a creator course community from your
    // enrolled community list". Worse, /learn swaps to the learner shell, so
    // the Studio nav disappeared with no way back. The Studio inbox is the
    // surface that actually answers student questions.
    href: "/teach/messages",
    kind: "normal",
    icon: "message",
  });

  items.push({
    title: t("teach.insights.actScheduleTitle"),
    detail: t("teach.insights.actScheduleDetail"),
    href: "/teach/events",
    kind: "normal",
    icon: "clock",
  });

  return items.slice(0, 3);
}

function buildCourseCode(title: string) {
  const letters = title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  return letters || "Co";
}

function renderActivityIcon(icon: ActivityItem["icon"]) {
  if (icon === "alert") {
    return <AlertCircle aria-hidden="true" size={18} />;
  }

  if (icon === "flag") {
    return <Flag aria-hidden="true" size={18} />;
  }

  if (icon === "message") {
    return <MessageSquareText aria-hidden="true" size={18} />;
  }

  if (icon === "sparkle") {
    return <Sparkles aria-hidden="true" size={18} />;
  }

  return <Clock3 aria-hidden="true" size={18} />;
}
