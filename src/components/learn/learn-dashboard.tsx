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
import { getCourseBySlug } from "@/lib/data/catalog";
import { subscribeToUserEnrollments } from "@/lib/data/enrollments";

export function LearnDashboard() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [enrollmentQuery, setEnrollmentQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const firstName = user?.displayName?.trim().split(/\s+/)[0] ?? "";
  const normalizedEnrollmentQuery = enrollmentQuery.toLowerCase().trim();
  const visibleEnrollments = normalizedEnrollmentQuery
    ? enrollments.filter((enrollment) =>
        `${enrollment.courseTitle} ${enrollment.courseCategory} ${enrollment.status}`
          .toLowerCase()
          .includes(normalizedEnrollmentQuery),
      )
    : enrollments;

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
    return (
      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
          <p className="text-sm text-[var(--color-ink-soft)]">{t("learn.dashboard.loading")}</p>
        </div>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[14px] border border-[rgba(178,34,52,0.2)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
          <p className="rounded-[10px] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
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
          <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
            {t("learn.dashboard.emptyTitle")}
          </h3>
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
    ? getCourseBySlug(continueEnrollment.courseSlug)
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
            <h2 className="display-title mt-3 max-w-3xl text-4xl leading-[1.03] text-[var(--color-primary)] sm:text-5xl">
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
            <h3 className="display-title mt-2 text-3xl text-[var(--color-primary)]">
              {t("learn.dashboard.enrolledPathsTitle")}
            </h3>
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
            const course = getCourseBySlug(enrollment.courseSlug);
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
                    src={enrollment.courseImage}
                    alt={enrollment.courseTitle}
                    fill
                    sizes="220px"
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
                            enrollment.status,
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
