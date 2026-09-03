"use client";

import Link from "next/link";
import { AlertTriangle, ExternalLink, Eye } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { StudioRecentActivity } from "@/components/teacher/studio-recent-activity";
import { Card, EmptyState } from "@/components/ui";
import type { CourseAsset } from "@/domain/course-asset";
import type { CourseCoupon } from "@/domain/course-commerce";
import type { CourseReadinessAccount } from "@/domain/course-readiness";
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

// O que a pessoa sofria: a aba "Panel" do produto so tinha a lista de o-que-
// falta-para-publicar. Um produto ja publicado abria numa tela que nao dizia
// quantos alunos entraram, quanto entrou de dinheiro, quantos terminaram, nem
// o que esta quebrado — o professor tinha de sair para o painel de vendas, para
// a aba de alunos e para a de cupons, e juntar de cabeca.

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(
    amountMinor / 100,
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card padding="lg" tone="surface">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-ink-muted)]">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold tracking-[-0.04em] text-[var(--color-primary)]">
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
  children,
}: {
  course: Pick<TeacherCourse, "id" | "title" | "status">;
  stats: CourseOverviewStats;
  issues: CourseMaintenanceIssue[];
  loading: boolean;
  children?: React.ReactNode;
}) {
  const revenueValue = stats.revenue.length
    ? stats.revenue.map((total) => formatMoney(total.netMinor, total.currency)).join(" · ")
    : formatMoney(0, "USD");

  const cards = [
    {
      label: "Students enrolled",
      value: String(stats.studentCount),
      hint: stats.studentCount
        ? `${stats.newThisWeekCount} joined in the last 7 days`
        : "Buyers land here the moment a purchase clears.",
    },
    {
      label: "Revenue",
      value: revenueValue,
      hint: stats.paidOrderCount
        ? `${stats.paidOrderCount} paid ${stats.paidOrderCount === 1 ? "order" : "orders"}, net of refunds`
        : "No paid order on this product yet.",
    },
    {
      label: "Completion",
      value: stats.completionPercent === null ? "--" : `${stats.completionPercent}%`,
      hint:
        stats.completionPercent === null
          ? "Measured once someone is enrolled."
          : `${stats.completedCount} of ${stats.studentCount} finished the course`,
    },
    {
      label: "Average rating",
      value: stats.ratingAverage === null ? "--" : stats.ratingAverage.toFixed(1),
      hint: stats.ratingCount
        ? `${stats.ratingCount} ${stats.ratingCount === 1 ? "review" : "reviews"}`
        : "No review yet — students rate after they enroll.",
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
            How this product is doing
          </h2>
          <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
            Everything below counts only {course.title}, never your other products.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/courses/${encodeURIComponent(course.id)}`}
            className="button-outline inline-flex items-center gap-2 px-4 py-2 text-xs"
          >
            <ExternalLink aria-hidden="true" size={14} strokeWidth={1.9} />
            View public page
          </Link>
          <Link
            href={`/teach/builder/${encodeURIComponent(course.id)}/preview`}
            className="button-outline inline-flex items-center gap-2 px-4 py-2 text-xs"
          >
            <Eye aria-hidden="true" size={14} strokeWidth={1.9} />
            Preview as a student
          </Link>
        </div>
      </div>

      {loading ? (
        <div
          data-testid="course-overview-loading"
          className="h-28 animate-pulse rounded-[var(--radius-xl)] bg-[var(--color-surface-strong)]"
        />
      ) : stats.hasHistory ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <StatCard key={card.label} {...card} />
          ))}
        </div>
      ) : (
        // Produto sem venda nenhuma nao ganha uma grade de zeros fingindo ser
        // medicao: quatro "0" leem como resultado ruim, nao como "ainda nao
        // comecou".
        <EmptyState
          as="h3"
          title="No one has bought this product yet."
          description={
            course.status === "published"
              ? "Enrollments, revenue, completion and rating appear here after the first sale. Share the product page to get the first one."
              : "Publish the course first — the numbers start the moment the first buyer clears checkout."
          }
          action={
            course.status === "published" ? (
              <Link
                href={`/courses/${encodeURIComponent(course.id)}`}
                className="button-solid px-4 py-2 text-xs"
              >
                Open the product page
              </Link>
            ) : (
              <Link
                href={`/teach/builder?courseId=${encodeURIComponent(course.id)}&tab=review`}
                className="button-solid px-4 py-2 text-xs"
              >
                Review &amp; publish
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
            Needs your attention
          </h3>
          <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
            {issues.length === 1
              ? "One thing on this product is worth fixing."
              : `${issues.length} things on this product are worth fixing.`}
          </p>
          <ul className="mt-4 grid gap-3">
            {issues.map((issue) => (
              <li
                key={issue.id}
                className="rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-4 py-3"
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

export function CourseOverviewPanel({
  course,
  account,
}: {
  course: TeacherCourse;
  account?: CourseReadinessAccount;
}) {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [students, setStudents] = useState<CourseStudent[] | null>(null);
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

    void getMyCourseStudents()
      .then((next) => {
        if (alive) setStudents(next);
      })
      .catch(logSubscriptionError("CourseOverviewPanel.students"));

    return () => {
      alive = false;
    };
  }, [user]);

  useEffect(() => {
    let alive = true;

    // Leitura unica: os assets so mudam quando o professor edita a aula, e
    // essa edicao acontece noutra tela. Uma falha aqui deixa `assets` em null,
    // e a regra de "aula sem conteudo" simplesmente nao opina.
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
    () => getCourseMaintenanceIssues({ course, account, assets, coupons }),
    [account, assets, coupons, course],
  );

  return (
    <CourseOverviewPanelView
      course={course}
      stats={stats}
      issues={issues}
      loading={students === null}
    >
      <StudioRecentActivity courses={[course]} />
    </CourseOverviewPanelView>
  );
}
