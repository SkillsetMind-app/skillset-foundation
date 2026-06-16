"use client";

import Image from "next/image";
import Link from "next/link";
import { Award, BookOpenCheck, PlayCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { LearnerOverviewMetrics } from "@/components/learn/learner-overview-metrics";
import { RefundButton } from "@/components/learn/refund-button";
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
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [enrollmentQuery, setEnrollmentQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const firstName = user?.displayName?.trim().split(/\s+/)[0] ?? "there";
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
        setError("We could not load your enrolled courses.");
        setIsLoading(false);
      },
    );
  }, [user]);

  if (isLoading) {
    return (
      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
          <p className="text-sm text-[var(--color-ink-soft)]">Loading your learning workspace...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[4px] border border-[rgba(178,34,52,0.2)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
          <p className="rounded-[10px] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
            {error}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/courses" className="button-solid px-4 py-2.5 text-sm">
              Explore courses
            </Link>
            <Link href="/support" className="button-outline px-4 py-2.5 text-sm">
              Contact support
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (enrollments.length === 0) {
    return (
      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-brand)]">
            My learning
          </p>
          <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
            Your learning dashboard is ready.
          </h3>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
            Enroll in your first course to get started. When you enroll from the
            marketplace, the course appears here with its private learning workspace.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/courses" className="button-solid px-4 py-2.5 text-sm">
              Explore programs
            </Link>
            <Link href="/platform" className="button-outline px-4 py-2.5 text-sm">
              View platform overview
            </Link>
          </div>
        </div>
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
      <section className="learner-home-hero dash-card dash-card--strong p-5 sm:p-7">
        <div className="relative z-[1] grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--color-accent-fg)]">
              Learning workspace
            </p>
            <h2 className="display-title mt-3 max-w-3xl text-4xl leading-[1.03] text-[var(--color-primary)] sm:text-5xl">
              Welcome back, {firstName}.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-8 text-[var(--color-ink-soft)]">
              You have{" "}
              <strong className="text-[var(--color-ink)]">
                {activeEnrollments.length} active{" "}
                {activeEnrollments.length === 1 ? "course" : "courses"}
              </strong>{" "}
              and{" "}
              <strong className="text-[var(--color-ink)]">
                {completedEnrollments.length} completed
              </strong>
              . Continue the next lesson or explore a reviewed Skillset course.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href={continueHref} className="button-solid px-4 py-2.5 text-sm">
                {continueEnrollment ? "Continue learning" : "Explore courses"}
              </Link>
              <Link href="/courses" className="button-outline bg-white px-4 py-2.5 text-sm">
                Explore courses
              </Link>
            </div>
          </div>

          <div className="learner-continue-card">
            <span className="learner-continue-card__icon">
              <PlayCircle aria-hidden="true" size={20} strokeWidth={1.9} />
            </span>
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--color-accent-fg)]">
              Continue
            </p>
            <h3 className="display-title mt-3 text-3xl leading-tight text-[var(--color-primary)]">
              {continueEnrollment?.courseTitle ?? "No active course right now."}
            </h3>
            <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
              {continueCourse?.summary ??
                "Your next enrolled course opens here with lessons, progress, materials, and community context."}
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
                ? `${continueEnrollment.progressPercent}% complete`
                : "Completed courses stay in your library"}
            </p>
          </div>
        </div>
      </section>

      <LearnerOverviewMetrics />

      <section className="dash-card dash-card--strong p-4 shadow-[var(--shadow-soft)] sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              My courses
            </p>
            <h3 className="display-title mt-2 text-3xl text-[var(--color-primary)]">
              Your enrolled learning paths.
            </h3>
          </div>
          <ListingSearchBar
            value={enrollmentQuery}
            onChange={setEnrollmentQuery}
            placeholder="Search your enrollments..."
          />
        </div>
        <div className="mt-5 grid gap-4">
          {visibleEnrollments.length === 0 ? (
            <p className="rounded-[4px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
              No enrollments match this search.
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
                <div className="relative aspect-[16/10] overflow-hidden rounded-[4px]">
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
                      {course?.summary ??
                        "This enrollment is connected. The private course workspace is ready for the next lesson and progress tools."}
                    </p>
                  </div>
                  <div className="grid gap-2 rounded-[12px] border border-[var(--color-line)] bg-white p-3 text-xs font-semibold text-[var(--color-ink-soft)] sm:grid-cols-3">
                    <span className="inline-flex items-center gap-2">
                      <BookOpenCheck aria-hidden="true" size={14} />
                      {course?.modules.length ?? "Private"} modules
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <PlayCircle aria-hidden="true" size={14} />
                      {course?.modules.flatMap((module) => module.lessons).length
                        ?? "Course"} lessons
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <Award aria-hidden="true" size={14} />
                      Credential path
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
                      {canOpenWorkspace
                        ? `${enrollment.progressPercent}% complete`
                        : `Access ${enrollment.status}`}
                      {nextLesson ? ` - Next: ${nextLesson.title}` : ""}
                    </p>
                    {canOpenWorkspace ? (
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={workspaceHref}
                          className="button-solid px-4 py-2.5 text-sm"
                        >
                          Open workspace
                        </Link>
                        <RefundButton enrollment={enrollment} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled
                        className="button-outline px-4 py-2.5 text-sm opacity-70"
                      >
                        Access inactive
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
