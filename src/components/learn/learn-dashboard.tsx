"use client";

import Image from "next/image";
import Link from "next/link";
import { Award, BookOpenCheck, PlayCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { LearnerOverviewMetrics } from "@/components/learn/learner-overview-metrics";
import { LearningPathsRows } from "@/components/learn/learning-paths-rows";
import { RefundButton } from "@/components/learn/refund-button";
import { WelcomeTour } from "@/components/learn/welcome-tour";
import { ListingSearchBar } from "@/components/shared/listing-search-bar";
import { StatusChip } from "@/components/shared/status-chip";
import {
  canContinueEnrollment,
  canOpenEnrollment,
  type Enrollment,
} from "@/domain/enrollment";
import { getNextCourseLessonAfter } from "@/domain/lesson-progress";
import type { TeacherCourse } from "@/domain/teacher-course";
import { getCourseBySlug } from "@/lib/data/catalog";
import { subscribeToUserEnrollments } from "@/lib/data/enrollments";
import {
  subscribeToPublishedTeacherCourses,
  teacherCourseToLearningCourse,
} from "@/lib/data/published-courses";

export function LearnDashboard() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [enrollmentQuery, setEnrollmentQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  // Cursos REAIS publicados. Sem isto o painel só enxergava os 6 cursos de
  // demonstração de `catalog.ts`, e uma matrícula real nunca carrega slug de
  // demonstração — `enrollments.ts:115` e o webhook do Stripe gravam o id do
  // curso em `course_slug`. Resultado: `getCourseBySlug` devolvia undefined para
  // 100% das compras reais e o cartão caía no texto de espaço reservado
  // ("Private modules"), justamente na primeira tela depois de pagar.
  const [realCourses, setRealCourses] = useState<TeacherCourse[]>([]);
  const firstName = user?.displayName?.trim().split(/\s+/)[0] ?? "";
  const normalizedEnrollmentQuery = enrollmentQuery.toLowerCase().trim();
  const visibleEnrollments = normalizedEnrollmentQuery
    ? enrollments.filter((enrollment) =>
        `${enrollment.courseTitle} ${enrollment.courseCategory} ${enrollment.status}`
          .toLowerCase()
          .includes(normalizedEnrollmentQuery),
      )
    : enrollments;

  // Casa a matrícula com o curso, seja de demonstração ou real.
  //
  // `course_slug` guarda ora o id ora o slug, dependendo do caminho de escrita
  // (`enrollments.ts:69` grava slug, `:115` e o webhook gravam id) — por isso
  // testa as duas formas em vez de assumir uma. Uma migration de hoje já tolera
  // essa ambiguidade no banco; aqui o cliente precisa tolerar igual, senão a
  // metade que resolve o acesso funciona e a que mostra o curso não.
  const resolveCourse = (enrollment: Enrollment) => {
    const demo = getCourseBySlug(enrollment.courseSlug);
    if (demo) return demo;

    const real = realCourses.find(
      (course) =>
        course.id === enrollment.courseId
        || course.id === enrollment.courseSlug,
    );
    return real ? teacherCourseToLearningCourse(real) : undefined;
  };

  useEffect(() => {
    // Falha aqui não pode derrubar o painel: sem os cursos reais o cartão volta
    // ao texto genérico, que é ruim, mas melhor que uma tela de erro sobre uma
    // compra que existe.
    return subscribeToPublishedTeacherCourses(setRealCourses, () => undefined);
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToUserEnrollments(
      user.uid,
      (nextEnrollments) => {
        setEnrollments(nextEnrollments);
        setIsLoading(false);
      },
      () => {
        setHasError(true);
        setIsLoading(false);
      },
    );
  }, [user]);

  if (isLoading) {
    // Skeleton mirrors the loaded shape (hero band + course row) so the layout
    // does not jump when the enrollments arrive. Same animate-pulse blocks the
    // rest of the app already uses; the sr-only status keeps the old copy.
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-8">
        <p className="sr-only" role="status">
          {t("learn.dashboard.loading")}
        </p>
        <div className="dash-card dash-card--strong grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-4">
            <div className="h-3 w-32 animate-pulse rounded bg-[var(--color-surface-strong)]" />
            <div className="h-10 w-3/4 animate-pulse rounded bg-[var(--color-surface-strong)]" />
            <div className="h-3 w-full max-w-xl animate-pulse rounded bg-[var(--color-surface-soft)]" />
            <div className="flex gap-3">
              <div className="h-11 w-40 animate-pulse rounded-[10px] bg-[var(--color-surface-strong)]" />
              <div className="h-11 w-40 animate-pulse rounded-[10px] bg-[var(--color-surface-soft)]" />
            </div>
          </div>
          <div className="h-44 animate-pulse rounded-[14px] bg-[var(--color-surface-soft)]" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="h-56 animate-pulse rounded-[14px] border border-[var(--color-line)] bg-white shadow-[var(--shadow-soft)]"
            />
          ))}
        </div>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[14px] border border-[rgba(178,34,52,0.2)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
          <p className="rounded-[10px] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
            {t("learn.dashboard.loadError")}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/courses" className="button-solid px-4 py-2.5 text-sm">
              {t("learn.dashboard.exploreCourses")}
            </Link>
            <Link href="/support" className="button-outline px-4 py-2.5 text-sm">
              {t("learn.dashboard.contactSupport")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (enrollments.length === 0) {
    return (
      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        {user ? <WelcomeTour userId={user.uid} firstName={firstName} /> : null}
        <div className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {t("learn.dashboard.myLearning")}
          </p>
          {/* h2, não h3: é a primeira seção sob o h1 da página. Como h3 a
              árvore de headings do /learn vazio pulava do nível 1 para o 3,
              e quem navega por cabeçalho perdia o degrau. */}
          <h2 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
            {t("learn.dashboard.emptyTitle")}
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
            {t("learn.dashboard.emptyBody")}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/courses" className="button-solid px-4 py-2.5 text-sm">
              {t("learn.dashboard.explorePrograms")}
            </Link>
            <Link href="/platform" className="button-outline px-4 py-2.5 text-sm">
              {t("learn.dashboard.viewPlatformOverview")}
            </Link>
          </div>
        </div>
        <LearningPathsRows enrollments={enrollments} />
      </div>
    );
  }

  const activeEnrollments = enrollments.filter((enrollment) =>
    canContinueEnrollment(enrollment.status),
  );
  const completedEnrollments = enrollments.filter(
    (enrollment) => enrollment.status === "completed",
  );
  const continueEnrollment =
    activeEnrollments
      .sort((left, right) => right.progressPercent - left.progressPercent)[0]
    ?? null;
  const continueCourse = continueEnrollment
    ? resolveCourse(continueEnrollment)
    : undefined;
  const continueHref = continueEnrollment
    ? continueCourse
      ? `/learn/courses/${continueEnrollment.courseSlug}`
      : `/learn/courses/${continueEnrollment.courseId}`
    : "/courses";

  return (
    <div className="grid gap-8">
      {user ? <WelcomeTour userId={user.uid} firstName={firstName} /> : null}
      <section className="learner-home-hero dash-card dash-card--strong p-5 sm:p-7">
        <div className="relative z-[1] grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--color-accent-fg)]">
              {t("learn.dashboard.workspaceEyebrow")}
            </p>
            {/* Um passo ABAIXO do h1 da página em todo breakpoint. Era
                `text-4xl sm:text-5xl` contra o `text-3xl sm:text-4xl lg:text-5xl`
                do PlatformShell: entre 640px e 1023px o título da página ficava
                em 36px e este subtítulo em 48px — o segundo nível maior que o
                primeiro, e acima de 1024px os dois empatados em 48px. Em nenhuma
                largura havia hierarquia. */}
            <h2 className="display-title mt-3 max-w-3xl text-3xl leading-[1.03] text-[var(--color-primary)] sm:text-4xl">
              {firstName
                ? t("learn.dashboard.welcomeBackNamed").replace("{name}", firstName)
                : t("learn.dashboard.welcomeBack")}
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-8 text-[var(--color-ink-soft)]">
              {t("learn.dashboard.summaryPrefix")}{" "}
              <strong className="text-[var(--color-ink)]">
                {t(
                  activeEnrollments.length === 1
                    ? "learn.dashboard.summaryActiveSingular"
                    : "learn.dashboard.summaryActivePlural",
                ).replace("{count}", String(activeEnrollments.length))}
              </strong>{" "}
              {t("learn.dashboard.summaryJoin")}{" "}
              <strong className="text-[var(--color-ink)]">
                {t(
                  completedEnrollments.length === 1
                    ? "learn.dashboard.summaryCompletedSingular"
                    : "learn.dashboard.summaryCompletedPlural",
                ).replace("{count}", String(completedEnrollments.length))}
              </strong>
              {t("learn.dashboard.summarySuffix")}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href={continueHref} className="button-solid px-4 py-2.5 text-sm">
                {continueEnrollment
                  ? t("learn.dashboard.continueLearning")
                  : t("learn.dashboard.exploreCourses")}
              </Link>
              <Link href="/courses" className="button-outline bg-white px-4 py-2.5 text-sm">
                {t("learn.dashboard.exploreCourses")}
              </Link>
            </div>
          </div>

          <div className="learner-continue-card">
            <span className="learner-continue-card__icon">
              <PlayCircle aria-hidden="true" size={20} strokeWidth={1.9} />
            </span>
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--color-accent-fg)]">
              {t("learn.dashboard.continueEyebrow")}
            </p>
            <h3 className="display-title mt-3 text-3xl leading-tight text-[var(--color-primary)]">
              {continueEnrollment?.courseTitle ?? t("learn.dashboard.noActiveCourse")}
            </h3>
            <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
              {continueCourse?.summary ?? t("learn.dashboard.continueFallbackSummary")}
            </p>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-[rgba(26,54,93,0.12)]">
              <div
                className="h-full rounded-full bg-[var(--color-accent)]"
                style={{
                  width: `${Math.max(0, Math.min(100, continueEnrollment?.progressPercent ?? 0))}%`,
                }}
              />
            </div>
            <p className="mt-3 text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-primary)]">
              {continueEnrollment
                ? t("learn.dashboard.percentComplete").replace(
                    "{percent}",
                    String(continueEnrollment.progressPercent),
                  )
                : t("learn.dashboard.completedStay")}
            </p>
          </div>
        </div>
      </section>

      <LearnerOverviewMetrics />

      <LearningPathsRows enrollments={enrollments} />

      <section className="dash-card dash-card--strong p-4 shadow-[var(--shadow-soft)] sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              {t("learn.dashboard.myCourses")}
            </p>
            {/* h2: esta é uma `section` IRMÃ do hero, não filha dele. Como h3
                ela se anunciava como subseção do hero, e a lista de cursos do
                aluno — o conteúdo principal da página — aparecia enterrada um
                nível abaixo do que é. */}
            <h2 className="display-title mt-2 text-3xl text-[var(--color-primary)]">
              {t("learn.dashboard.enrolledPathsTitle")}
            </h2>
          </div>
          <ListingSearchBar
            value={enrollmentQuery}
            onChange={setEnrollmentQuery}
            placeholder={t("learn.dashboard.searchEnrollments")}
          />
        </div>
        <div className="mt-5 grid gap-4">
          {visibleEnrollments.length === 0 ? (
            <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
              {t("learn.dashboard.noEnrollmentsMatch")}
            </p>
          ) : visibleEnrollments.map((enrollment) => {
            const course = resolveCourse(enrollment);
            // Next lesson after the learner's last *completed* lesson — not a
            // hardcoded first lesson, which mislabeled progress on the card.
            const nextLesson = course
              ? getNextCourseLessonAfter(course, enrollment.lastLessonId)?.lesson
              : undefined;
            const workspaceHref = course
              ? `/learn/courses/${enrollment.courseSlug}`
              : `/learn/courses/${enrollment.courseId}`;
            const canOpenWorkspace = canOpenEnrollment(enrollment.status);

            return (
              <article
                key={enrollment.id}
                className="grid gap-4 rounded-[16px] border fine-rule bg-[var(--color-surface-soft)] p-4 transition hover:-translate-y-0.5 hover:bg-[var(--color-surface-hover)] hover:shadow-[var(--shadow-soft)] md:grid-cols-[220px_1fr]"
              >
                <div className="relative aspect-[16/10] overflow-hidden rounded-[14px]">
                  <Image
                    // Same fallback the write path uses (lib/data/enrollments.ts).
                    // Legacy rows predate it, and an empty src throws in next/image,
                    // which would blank the whole dashboard over one bad row.
                    src={enrollment.courseImage || "/brand/logo-mark.png"}
                    alt={enrollment.courseTitle}
                    fill
                    // Card is a single full-width column until md, 220px after.
                    sizes="(min-width: 768px) 220px, 100vw"
                    className="object-cover"
                  />
                </div>
                <div className="flex flex-col justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                      {enrollment.courseCategory}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <h3 className="text-2xl font-semibold text-[var(--color-primary)]">
                        {enrollment.courseTitle}
                      </h3>
                      <StatusChip status={enrollment.status} />
                    </div>
                    <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
                      {course?.summary ?? t("learn.dashboard.enrollmentFallbackSummary")}
                    </p>
                  </div>
                  <div className="grid gap-2 rounded-[12px] border border-[var(--color-line)] bg-white p-3 text-xs font-semibold text-[var(--color-ink-soft)] sm:grid-cols-3">
                    <span className="inline-flex items-center gap-2">
                      <BookOpenCheck aria-hidden="true" size={14} />
                      {course
                        ? t("learn.dashboard.modulesCount").replace(
                            "{count}",
                            String(course.modules.length),
                          )
                        : t("learn.dashboard.modulesPrivate")}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <PlayCircle aria-hidden="true" size={14} />
                      {course
                        ? t("learn.dashboard.lessonsCount").replace(
                            "{count}",
                            String(
                              course.modules.flatMap((module) => module.lessons).length,
                            ),
                          )
                        : t("learn.dashboard.lessonsPrivate")}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <Award aria-hidden="true" size={14} />
                      {t("learn.dashboard.credentialPath")}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
                      {canOpenWorkspace
                        ? t("learn.dashboard.percentComplete").replace(
                            "{percent}",
                            String(enrollment.progressPercent),
                          )
                        : t("learn.dashboard.accessStatus").replace(
                            "{status}",
                            t(`statusChip.${enrollment.status}`),
                          )}
                      {nextLesson
                        ? ` - ${t("learn.dashboard.nextLesson").replace("{title}", nextLesson.title)}`
                        : ""}
                    </p>
                    {canOpenWorkspace ? (
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={workspaceHref}
                          className="button-solid px-4 py-2.5 text-sm"
                        >
                          {t("learn.dashboard.openWorkspace")}
                        </Link>
                        <RefundButton enrollment={enrollment} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled
                        className="button-outline px-4 py-2.5 text-sm opacity-70"
                      >
                        {t("learn.dashboard.accessInactive")}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
