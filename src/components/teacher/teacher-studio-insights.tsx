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
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { PeriodTabs } from "@/components/shared/period-tabs";
import { StatusChip } from "@/components/shared/status-chip";
import { RevenueChart } from "@/components/teacher/revenue-chart";
import {
  buildRevenueSeries,
  resolveRevenueRangeWindow,
  type RevenueRange,
} from "@/domain/creator-reports";
import type { Order } from "@/domain/order";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToTeacherOrders } from "@/lib/data/orders";
import { logSubscriptionError } from "@/lib/data/subscription-error";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";

const revenueRanges: RevenueRange[] = ["3m", "6m", "12m", "all"];

const revenueRangeSubtitleKey: Record<RevenueRange, string> = {
  "3m": "teach.insights.range3m",
  "6m": "teach.insights.range6m",
  "12m": "teach.insights.range12m",
  all: "teach.insights.rangeAll",
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short" });

type ActivityItem = {
  title: string;
  detail: string;
  href: string;
  kind: "urgent" | "normal" | "success";
  icon: "alert" | "clock" | "flag" | "message" | "sparkle";
};

export function TeacherStudioInsights() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [payoutsReady, setPayoutsReady] = useState(false);
  const [revenueRange, setRevenueRange] = useState<RevenueRange>("12m");

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherCourses(
      user.uid,
      setCourses,
      logSubscriptionError("TeacherStudioInsights.courses"),
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherOrders(
      user.uid,
      setOrders,
      logSubscriptionError("TeacherStudioInsights.orders"),
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

  const paidOrders = orders.filter((order) => order.status === "paid");
  // Historico de venda = existe pedido pago, nao "entrou dinheiro": um pedido
  // pago de valor zero (produto gratis) ja e historico e merece o grafico.
  const hasSales = paidOrders.length > 0;
  const grossMinor = paidOrders.reduce((sum, order) => sum + order.amountMinor, 0);
  const monthlyRevenue = useMemo(
    () =>
      buildRevenueSeries(
        paidOrders,
        resolveRevenueRangeWindow(paidOrders, revenueRange),
        (date) => monthFormatter.format(date),
      ),
    [paidOrders, revenueRange],
  );
  const topCourses = useMemo(
    () => buildTopCourses(courses, paidOrders),
    [courses, paidOrders],
  );
  const activity = buildActivity(courses, payoutsReady, t);

  return (
    <div className="grid gap-8">
      {/* Grafico de receita e Top courses so depois da 1a venda. Sem
          nenhuma venda esse bloco era ~700px de nada: um grafico vazio
          dizendo "No revenue yet" e uma lista vazia. Os 4 tiles acima
          ficam sempre, com as dicas de vazio que ja tem. */}
      {hasSales ? (
        <section className="studio-dashboard-grid">
          <RevenueChart
            points={monthlyRevenue}
            totalMinor={grossMinor}
            totalLabel={money.format(grossMinor / 100)}
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
                <h3 className="display-title text-2xl text-[var(--color-primary)]">
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
                        <strong>{money.format(course.grossMinor / 100)}</strong>
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
        <div className="sec-head">
          <div>
            <span className="eyebrow brand">{t("teach.insights.activityEyebrow")}</span>
            <h2>{t("teach.insights.activityTitle")}</h2>
          </div>
        </div>
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
    <div className="rounded-[12px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-4">
      <p className="text-sm font-semibold text-[var(--color-ink)]">{title}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">{detail}</p>
    </div>
  );
}

function buildTopCourses(courses: TeacherCourse[], paidOrders: Order[]) {
  const byCourse = new Map<string, { orders: number; grossMinor: number }>();

  paidOrders.forEach((order) => {
    const current = byCourse.get(order.courseId) ?? { orders: 0, grossMinor: 0 };
    current.orders += 1;
    current.grossMinor += order.amountMinor;
    byCourse.set(order.courseId, current);
  });

  return courses
    .map((course) => {
      const sales = byCourse.get(course.id) ?? { orders: 0, grossMinor: 0 };

      return {
        id: course.id,
        title: course.title,
        status: course.status,
        lessonCount: course.lessonCount,
        code: buildCourseCode(course.title),
        ...sales,
      };
    })
    .sort((a, b) => b.grossMinor - a.grossMinor || b.lessonCount - a.lessonCount)
    .slice(0, 3);
}

function buildActivity(
  courses: TeacherCourse[],
  payoutsReady: boolean,
  t: (key: string) => string,
): ActivityItem[] {
  const items: ActivityItem[] = [];
  const emptyDraft = courses.find((course) => course.status === "draft" && course.lessonCount === 0);
  const reviewReadyDraft = courses.find((course) => course.status === "draft" && course.lessonCount > 0);
  const needsChanges = courses.find((course) => course.status === "needs_changes");
  const inReview = courses.find((course) => course.status === "in_review");

  if (!payoutsReady) {
    items.push({
      title: t("teach.insights.actPayoutTitle"),
      detail: t("teach.insights.actPayoutDetail"),
      href: "/account/payments#stripe-connect",
      kind: "urgent",
      icon: "alert",
    });
  }

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
