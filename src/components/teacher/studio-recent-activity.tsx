"use client";

import Link from "next/link";
import { MessageCircleQuestion, Star, UserPlus, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { formatNotificationTime } from "@/components/account/notification-row";
import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { EmptyState, Eyebrow } from "@/components/ui";
import type { CommunityPost } from "@/domain/community-post";
import type { CourseReview } from "@/domain/course-review";
import type { Order } from "@/domain/order";
import type { TeacherCourse } from "@/domain/teacher-course";
import { getRecentCommunityQuestions } from "@/lib/data/community-posts";
import { getRecentCourseReviews } from "@/lib/data/course-reviews";
import { getMyCourseStudents, type CourseStudent } from "@/lib/data/enrollments";
import { subscribeToTeacherOrders } from "@/lib/data/orders";
import { logSubscriptionError } from "@/lib/data/subscription-error";
import { toDate } from "@/lib/format-date";

// "O que aconteceu enquanto eu não olhava": matrículas, vendas, avaliações e
// perguntas da comunidade numa linha do tempo só. A Home tinha painel de
// próximos passos, painel de produtos e painel de métricas — nenhum respondia a
// pergunta que o professor faz primeiro ao abrir o estúdio.

type ActivityKind = "sale" | "enrollment" | "review" | "question";

type ActivityEvent = {
  id: string;
  kind: ActivityKind;
  at: number;
  text: string;
  href: string;
};

const kindIcon = {
  sale: Wallet,
  enrollment: UserPlus,
  review: Star,
  question: MessageCircleQuestion,
} as const;

export function StudioRecentActivity({ courses }: { courses: TeacherCourse[] }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [orders, setOrders] = useState<Order[]>([]);
  const [students, setStudents] = useState<CourseStudent[]>([]);
  const [reviews, setReviews] = useState<CourseReview[]>([]);
  const [questions, setQuestions] = useState<CommunityPost[]>([]);
  const [loaded, setLoaded] = useState(false);
  const courseIds = useMemo(() => courses.map((course) => course.id), [courses]);
  const courseIdsKey = courseIds.join(",");
  const courseTitles = useMemo(
    () => new Map(courses.map((course) => [course.id, course.title])),
    [courses],
  );

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherOrders(
      user.uid,
      setOrders,
      logSubscriptionError("StudioRecentActivity.orders"),
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
      .catch(logSubscriptionError("StudioRecentActivity.students"));

    return () => {
      alive = false;
    };
  }, [user]);

  useEffect(() => {
    const ids = courseIdsKey ? courseIdsKey.split(",") : [];
    let alive = true;

    // As duas leituras seguem o mesmo caminho e falham do mesmo jeito: sem os
    // dados, a lista mostra os tipos que carregaram, nunca um erro por cima da
    // Home. `loaded` só vira true depois das duas para o estado vazio não
    // piscar antes da resposta.
    void Promise.allSettled([
      getRecentCourseReviews(ids),
      getRecentCommunityQuestions(ids),
    ]).then(([reviewResult, questionResult]) => {
      if (!alive) return;
      if (reviewResult.status === "fulfilled") setReviews(reviewResult.value);
      else logSubscriptionError("StudioRecentActivity.reviews")(reviewResult.reason);
      if (questionResult.status === "fulfilled") setQuestions(questionResult.value);
      else logSubscriptionError("StudioRecentActivity.questions")(questionResult.reason);
      setLoaded(true);
    });

    return () => {
      alive = false;
    };
  }, [courseIdsKey]);

  const events = useMemo(() => {
    const items: ActivityEvent[] = [];

    for (const order of orders) {
      if (order.status !== "paid") continue;
      const at = toDate(order.paidAt ?? order.createdAt)?.getTime();
      if (!at) continue;
      items.push({
        id: `sale-${order.id}`,
        kind: "sale",
        at,
        text: t("teach.activity.sale").replace("{course}", order.courseTitle),
        href: `/teach/sales/${encodeURIComponent(order.id)}`,
      });
    }

    for (const student of students) {
      const at = toDate(student.enrolledAt)?.getTime();
      if (!at) continue;
      items.push({
        id: `enrollment-${student.enrollmentId}`,
        kind: "enrollment",
        at,
        text: t("teach.activity.enrollment")
          .replace("{name}", student.displayName || t("teach.activity.someone"))
          .replace("{course}", student.courseTitle),
        href: `/teach/courses/${encodeURIComponent(student.courseId)}/manage`,
      });
    }

    for (const review of reviews) {
      const at = toDate(review.createdAt)?.getTime();
      if (!at) continue;
      items.push({
        id: `review-${review.id}`,
        kind: "review",
        at,
        text: t("teach.activity.review")
          .replace("{rating}", String(review.rating))
          .replace("{course}", courseTitles.get(review.courseId) ?? ""),
        href: `/teach/courses/${encodeURIComponent(review.courseId)}/manage`,
      });
    }

    for (const question of questions) {
      const at = toDate(question.createdAt)?.getTime();
      if (!at) continue;
      items.push({
        id: `question-${question.id}`,
        kind: "question",
        at,
        text: t("teach.activity.question")
          .replace("{name}", question.authorName || t("teach.activity.someone"))
          .replace("{course}", courseTitles.get(question.courseSlug) ?? ""),
        href: `/teach/courses/${encodeURIComponent(question.courseSlug)}/community`,
      });
    }

    return items.sort((a, b) => b.at - a.at).slice(0, 6);
  }, [courseTitles, orders, questions, reviews, students, t]);

  return (
    <section aria-labelledby="studio-activity-title">
      <Eyebrow>{t("teach.activity.eyebrow")}</Eyebrow>
      <h2
        id="studio-activity-title"
        className="mt-1 text-xl font-semibold text-[var(--color-primary)]"
      >
        {t("teach.activity.title")}
      </h2>

      {!loaded ? (
        <div className="mt-4 h-24 animate-pulse rounded-[8px] bg-[var(--color-surface-strong)]" />
      ) : events.length === 0 ? (
        // Professor novo não vê uma grade de zeros fingindo ser um painel.
        <EmptyState
          className="mt-4"
          as="h3"
          title={t("teach.activity.emptyTitle")}
          description={t("teach.activity.emptyDescription")}
        />
      ) : (
        <ul className="mt-4 border-t border-[var(--color-line)]">
          {events.map((event) => {
            const Icon = kindIcon[event.kind];

            return (
              <li key={event.id} className="border-b border-[var(--color-line)]">
                <Link
                  href={event.href}
                  className="flex min-h-11 items-center gap-3 px-1 py-3 text-sm transition-colors hover:bg-[var(--color-surface-soft)]"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-[var(--color-line)] text-[var(--color-primary)]">
                    <Icon aria-hidden="true" size={15} strokeWidth={1.9} />
                  </span>
                  <span className="min-w-0 flex-1 text-[var(--color-ink)]">{event.text}</span>
                  <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">
                    {formatNotificationTime(new Date(event.at).toISOString())}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
