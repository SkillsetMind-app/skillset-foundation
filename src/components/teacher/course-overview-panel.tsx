"use client";

import Link from "next/link";
import { AlertTriangle, ExternalLink, Eye } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { RetryAlert } from "@/components/teacher/save-status-line";
import { StudioRecentActivity } from "@/components/teacher/studio-recent-activity";
import { Card, EmptyState } from "@/components/ui";
import type { CourseAsset } from "@/domain/course-asset";
import type { CourseCoupon } from "@/domain/course-commerce";
import {
  getCourseMaintenanceIssues,
  getCourseOverviewStats,
  type CourseMaintenanceIssue,
  type CourseOverviewStats,
} from "@/domain/course-overview";
import type { Order } from "@/domain/order";
import type { TeacherCourse } from "@/domain/teacher-course";
import { fetchCourseAssets } from "@/lib/data/course-assets";
import { subscribeToCourseCoupons } from "@/lib/data/course-commerce";
import { getMyCourseStudents, type CourseStudent } from "@/lib/data/enrollments";
import { subscribeToTeacherOrders } from "@/lib/data/orders";
import { logSubscriptionError } from "@/lib/data/subscription-error";

// What the person went through: the product's "Panel" tab only had the what's-
// left-to-publish list. An already published product opened on a screen that did not say
// how many learners came in, how much money came in, how many finished, nor
// what is broken — the teacher had to leave for the sales panel, for
// the learners tab and for the coupons one, and put it together in their head.

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(
    amountMinor / 100,
  );
}

// The same tile as the Panel serves the hub's price summary: one big number per
// card instead of four identical rows.
export function StatCard({
  label,
  value,
  hint,
  compact = false,
}: {
  label: string;
  value: string;
  hint: string;
  compact?: boolean;
}) {
  return (
    <Card padding={compact ? "sm" : "lg"} tone="surface" shadow={!compact} className={compact ? "min-w-0 rounded-lg border-0" : undefined}>
      <p className={compact ? "text-xs font-medium text-[var(--color-ink-soft)]" : "text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-ink-muted)]"}>
        {label}
      </p>
      <p className={compact ? "mt-2 break-words text-xl font-semibold text-[var(--color-ink)]" : "mt-2 text-3xl font-bold tracking-[-0.04em] text-[var(--color-primary)]"}>
        {value}
      </p>
      <p className="mt-2 text-xs leading-5 text-[var(--color-ink-soft)]">{hint}</p>
    </Card>
  );
}

export function CourseOverviewPanelView({
  course,
  stats,
  issues,
  loading,
  onRetryStudents,
  children,
}: {
  course: Pick<TeacherCourse, "id" | "title" | "status">;
  stats: CourseOverviewStats;
  issues: CourseMaintenanceIssue[];
  loading: boolean;
    /** Reading the learners failed: error with "Try again" in place of the numbers. */
  onRetryStudents?: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const count = (oneKey: string, manyKey: string, value: number) =>
    t(value === 1 ? oneKey : manyKey).replace("{count}", () => String(value));
  const revenueValue = stats.revenue.length
    ? stats.revenue.map((total) => formatMoney(total.netMinor, total.currency)).join(" · ")
    : formatMoney(0, "USD");

  const cards = [
    {
      label: t("creatorPanel.overview.students"),
      value: String(stats.studentCount),
      hint: stats.studentCount
        ? t("creatorPanel.overview.studentsHintJoined").replace("{count}", () =>
            String(stats.newThisWeekCount),
          )
        : t("creatorPanel.overview.studentsHintEmpty"),
    },
    {
      label: t("teach.insights.revenue"),
      value: revenueValue,
      hint: stats.paidOrderCount
        ? count(
            "creatorPanel.overview.revenueHintOne",
            "creatorPanel.overview.revenueHintMany",
            stats.paidOrderCount,
          )
        : t("creatorPanel.overview.revenueHintEmpty"),
    },
    {
      label: t("teach.metrics.completion"),
      value: stats.completionPercent === null ? "--" : `${stats.completionPercent}%`,
      hint:
        stats.completionPercent === null
          ? t("creatorPanel.overview.completionHintEmpty")
          : t("creatorPanel.overview.completionHint")
              .replace("{done}", () => String(stats.completedCount))
              .replace("{total}", () => String(stats.studentCount)),
    },
    {
      label: t("creatorPanel.overview.rating"),
      value: stats.ratingAverage === null ? "--" : stats.ratingAverage.toFixed(1),
      hint: stats.ratingCount
        ? count(
            "creatorPanel.overview.reviewsOne",
            "creatorPanel.overview.reviewsMany",
            stats.ratingCount,
          )
        : t("creatorPanel.overview.ratingHintEmpty"),
    },
  ];

  return (
    <section className="grid gap-5" aria-labelledby="course-overview-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="course-overview-title"
            className="text-base font-semibold text-[var(--color-ink)]"
          >
            {t("creatorPanel.overview.title")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("creatorPanel.overview.scope").replace("{title}", () => course.title)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/courses/${encodeURIComponent(course.id)}`}
            className="button-outline inline-flex items-center gap-2 px-4 py-2 text-xs"
          >
            <ExternalLink aria-hidden="true" size={14} strokeWidth={1.9} />
            {t("creatorPanel.overview.viewPublic")}
          </Link>
          <Link
            href={`/teach/builder/${encodeURIComponent(course.id)}/preview`}
            className="button-outline inline-flex items-center gap-2 px-4 py-2 text-xs"
          >
            <Eye aria-hidden="true" size={14} strokeWidth={1.9} />
            {t("creatorPanel.overview.previewStudent")}
          </Link>
        </div>
      </div>

      {onRetryStudents ? (
                // Without the learner list the four numbers would be made up (zero).
        <RetryAlert text={t("creatorPanel.overview.studentsError")} onRetry={onRetryStudents} />
      ) : loading ? (
        <div
          data-testid="course-overview-loading"
          className="h-28 animate-pulse rounded-lg bg-[var(--color-surface-strong)]"
        />
      ) : stats.hasHistory ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <StatCard key={card.label} {...card} />
          ))}
        </div>
      ) : (
                // A product with no sale at all does not get a grid of zeros pretending to be
                // a measurement: four "0" read as a bad result, not as "it has not
                // started yet".
        <EmptyState
          as="h3"
          title={t("creatorPanel.overview.emptyTitle")}
          description={
            course.status === "published"
              ? t("creatorPanel.overview.emptyLive")
              : t("creatorPanel.overview.emptyDraft")
          }
          action={
            course.status === "published" ? (
              <Link
                href={`/courses/${encodeURIComponent(course.id)}`}
                className="button-solid px-4 py-2 text-xs"
              >
                {t("creatorPanel.overview.openPage")}
              </Link>
            ) : (
              <Link
                href={`/teach/builder?courseId=${encodeURIComponent(course.id)}&tab=review`}
                className="button-solid px-4 py-2 text-xs"
              >
                {t("creatorPanel.hub.checklist.reviewPublish")}
              </Link>
            )
          }
        />
      )}

      {issues.length ? (
        <Card padding="lg" tone="surface">
          <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--color-ink)]">
            <AlertTriangle
              aria-hidden="true"
              size={16}
              strokeWidth={1.9}
              className="text-[var(--color-warning-fg)]"
            />
            {t("creatorPanel.overview.attentionTitle")}
          </h3>
          <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
            {count(
              "creatorPanel.overview.attentionOne",
              "creatorPanel.overview.attentionMany",
              issues.length,
            )}
          </p>
          <ul className="mt-4 grid gap-3">
            {issues.map((issue) => (
              <li
                key={issue.id}
                className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-4 py-3"
              >
                <p className="text-sm font-semibold text-[var(--color-ink)]">{issue.title}</p>
                <p className="mt-0.5 text-xs leading-5 text-[var(--color-ink-soft)]">
                  {issue.hint}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {children}
    </section>
  );
}

export function CourseOverviewPanel({ course }: { course: TeacherCourse }) {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [students, setStudents] = useState<CourseStudent[] | null>(null);
    // The failure only went to the log: `students` stayed null and the skeleton pulsed
    // forever. Now it becomes an error with "Try again", which reads again.
  const [studentsFailed, setStudentsFailed] = useState(false);
  const [studentsAttempt, setStudentsAttempt] = useState(0);
  const [assets, setAssets] = useState<CourseAsset[] | null>(null);
  const [coupons, setCoupons] = useState<CourseCoupon[] | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherOrders(
      user.uid,
      setOrders,
      logSubscriptionError("CourseOverviewPanel.orders"),
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    let alive = true;

    const logError = logSubscriptionError("CourseOverviewPanel.students");
    void getMyCourseStudents()
      .then((next) => {
        if (!alive) return;
        setStudents(next);
        setStudentsFailed(false);
      })
      .catch((error: unknown) => {
        logError(error);
        if (alive) setStudentsFailed(true);
      });

    return () => {
      alive = false;
    };
  }, [user, studentsAttempt]);

  useEffect(() => {
    let alive = true;

        // Single read: the assets only change when the teacher edits the lesson, and
        // that edit happens on another screen. A failure here leaves `assets` as null,
        // and the "lesson without content" rule simply gives no opinion.
    void fetchCourseAssets(course.id)
      .then((next) => {
        if (alive) setAssets(next);
      })
      .catch(logSubscriptionError("CourseOverviewPanel.assets"));

    return () => {
      alive = false;
    };
  }, [course.id]);

  useEffect(() => {
    return subscribeToCourseCoupons(
      course.id,
      setCoupons,
      logSubscriptionError("CourseOverviewPanel.coupons"),
    );
  }, [course.id]);

  const stats = useMemo(
    () => getCourseOverviewStats({ course, students: students ?? [], orders }),
    [course, orders, students],
  );

  const issues = useMemo(
    () => getCourseMaintenanceIssues({ course, assets, coupons }),
    [assets, coupons, course],
  );

  return (
    <CourseOverviewPanelView
      course={course}
      stats={stats}
      issues={issues}
      loading={students === null}
            // Only with no numbers on the screen: a reread that fails does not erase the ones already
            // there (they stay valid until the next good read).
      onRetryStudents={
        studentsFailed && students === null
          ? () => {
              setStudentsFailed(false);
              setStudentsAttempt((current) => current + 1);
            }
          : undefined
      }
    >
      <StudioRecentActivity courses={[course]} />
    </CourseOverviewPanelView>
  );
}
