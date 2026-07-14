"use client";

import Link from "next/link";
import { BookOpenCheck, Layers3, PlayCircle, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ListingSearchBar } from "@/components/shared/listing-search-bar";
import { StatusChip } from "@/components/shared/status-chip";
import { StatusFilterDropdown } from "@/components/shared/status-filter-dropdown";
import { CreateCourseStart } from "@/components/teacher/create-course-start";
import type { TeacherCourse } from "@/domain/teacher-course";
import {
  teacherCanDeleteCourse,
  teacherCanSubmitCourse,
} from "@/domain/teacher-course";
import {
  deleteTeacherCourse,
  subscribeToTeacherCourses,
  submitTeacherCourseForReview,
} from "@/lib/data/teacher-courses";

const statusFilterMatches: Record<string, (course: TeacherCourse) => boolean> = {
  active: (course) => course.status === "published",
  all: () => true,
  draft: (course) => course.status === "draft",
  in_review: (course) => course.status === "in_review",
  inactive: (course) => course.status === "inactive",
  needs_changes: (course) => course.status === "needs_changes",
};

export function TeacherCourseStudio({
  autoOpenCreate = false,
}: {
  autoOpenCreate?: boolean;
}) {
  const { user } = useAuth();
  const [courseQuery, setCourseQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [error, setError] = useState("");
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);
  const [reviewingCourseId, setReviewingCourseId] = useState<string | null>(null);
  const [deletingCourseId, setDeletingCourseId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const normalizedCourseQuery = courseQuery.toLowerCase().trim();
  const visibleCourses = normalizedCourseQuery
    ? courses.filter((course) =>
        `${course.title} ${course.summary} ${course.category} ${course.status}`
          .toLowerCase()
          .includes(normalizedCourseQuery),
      )
    : courses;
  const statusFilteredCourses = visibleCourses.filter(
    statusFilterMatches[statusFilter] ?? statusFilterMatches.all,
  );

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherCourses(
      user.uid,
      (nextCourses) => {
        setCourses(nextCourses);
        setIsLoadingCourses(false);
      },
      () => {
        setError("We could not load your courses. Please refresh or contact SkillsetMind support.");
        setIsLoadingCourses(false);
      },
    );
  }, [user]);

  async function handleSubmitForReview(courseId: string) {
    setError("");
    setReviewingCourseId(courseId);

    try {
      await submitTeacherCourseForReview(courseId);
    } catch {
      setError("We could not submit this course for review. Please try again or contact SkillsetMind support.");
    } finally {
      setReviewingCourseId(null);
    }
  }

  async function handleDeleteCourse(courseId: string) {
    setError("");
    setDeletingCourseId(courseId);

    try {
      await deleteTeacherCourse(courseId);
      // The live subscription removes the course from the list automatically.
    } catch {
      setError("We could not delete this course. Please try again or contact SkillsetMind support.");
    } finally {
      setDeletingCourseId(null);
      setConfirmingDeleteId(null);
    }
  }

  if (autoOpenCreate) {
    return user ? (
      <CreateCourseStart ownerId={user.uid} />
    ) : (
      <p className="rounded-[10px] border border-[var(--color-line)] bg-white p-4 text-sm text-[var(--color-ink-soft)]">
        Sign in as a creator to start a course.
      </p>
    );
  }

  return (
    <div className="grid gap-5">
      {error ? (
        <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          {error}
        </p>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <section className="dash-card dash-card--strong p-5 sm:p-6">
          <div className="flex items-baseline gap-2 border-b border-[var(--color-line)] pb-5">
            <h3 className="text-base font-bold text-[var(--color-ink)]">
              Start a course submission
            </h3>
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">
              Course submissions
            </span>
          </div>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
            Create a draft, shape the learner path in Course Builder, and
            submit when the structure is ready for SkillsetMind review.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/teach/builder?newCourse=1" className="button-solid px-4 py-2.5 text-sm">
              New course
            </Link>
          </div>

          <div className="mt-7 grid gap-3">
            {[
              {
                icon: Layers3,
                title: "Step 1",
                detail: "Choose a title, category, one-time payment or free course.",
              },
              {
                icon: PlayCircle,
                title: "Step 2",
                detail: "Add modules, lessons, videos, embeds, and lesson materials.",
              },
              {
                icon: Sparkles,
                title: "Step 3",
                detail: "Set pricing, select a free preview, and submit for review.",
              },
            ].map((item) => {
              const Icon = item.icon;

              return (
                <div
                  key={item.title}
                  className="course-submission-step rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4"
                >
                  <span className="grid size-9 place-items-center rounded-[10px] bg-white text-[var(--color-primary)] shadow-[var(--shadow-avatar)]">
                    <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
                  </span>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-primary-light)]">
                      {item.title}
                    </p>
                    <p className="mt-1 text-sm font-semibold leading-6 text-[var(--color-ink)]">
                      {item.detail}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="dash-card dash-card--strong p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--color-line)] pb-5">
            <div>
              <div className="flex items-baseline gap-2">
                <h3 className="text-base font-bold text-[var(--color-ink)]">
                  Courses in progress
                </h3>
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">
                  Your submissions
                </span>
              </div>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
                Drafts stay private. Approved courses can keep receiving new
                lessons and materials while SkillsetMind controls marketplace visibility.
              </p>
            </div>
            {courses.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <ListingSearchBar
                  value={courseQuery}
                  onChange={setCourseQuery}
                  placeholder="Search your courses..."
                />
                <StatusFilterDropdown
                  value={statusFilter}
                  onChange={setStatusFilter}
                />
              </div>
            ) : null}
          </div>

          <div className="mt-6 grid gap-3">
            {isLoadingCourses ? (
              <p className="rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4 text-sm text-[var(--color-ink-soft)]">
                Loading your courses...
              </p>
            ) : courses.length === 0 ? (
              <div className="course-empty-showcase rounded-[18px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-6 sm:p-8">
                <span className="grid size-12 place-items-center rounded-[14px] bg-white text-[var(--color-primary)] shadow-[var(--shadow-avatar)]">
                  <BookOpenCheck aria-hidden="true" size={21} strokeWidth={1.8} />
                </span>
                <p className="mt-5 text-xs font-bold uppercase tracking-[0.24em] text-[var(--color-accent-fg)]">
                  First course
                </p>
                <h4 className="mt-3 max-w-sm text-xl font-bold leading-tight text-[var(--color-ink)]">
                  No courses yet.
                </h4>
                <p className="mt-3 max-w-md text-sm leading-7 text-[var(--color-ink-soft)]">
                  Use{" "}
                  <span className="font-semibold text-[var(--color-ink)]">New course</span>{" "}
                  to create your first draft. It opens the builder for modules, lessons,
                  pricing, uploads, preview, and review — and your draft will appear here.
                </p>
              </div>
            ) : statusFilteredCourses.length === 0 ? (
              <p className="rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
                No courses match these filters.
              </p>
            ) : (
              statusFilteredCourses.map((course) => (
                <article
                  key={course.id}
                  className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 transition hover:-translate-y-0.5 hover:bg-[var(--color-surface-hover)] hover:shadow-[var(--shadow-soft)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                        {course.category}
                      </p>
                      <h4 className="mt-2 text-base font-semibold text-[var(--color-ink)]">
                        {course.title}
                      </h4>
                      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                        {course.modules.length} modules - {course.lessonCount} lessons
                      </p>
                    </div>
                    <StatusChip status={course.status} />
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
                    {course.summary}
                  </p>
                  {course.reviewNote ? (
                    <div className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.18)] bg-white px-4 py-3">
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-accent-fg)]">
                        SkillsetMind review note
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
                        {course.reviewNote}
                      </p>
                    </div>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href={`/teach/courses/${course.id}/manage`}
                      className="button-outline px-4 py-2 text-xs"
                    >
                      Manage
                    </Link>
                    <Link
                      href={`/teach/builder?courseId=${course.id}`}
                      className="button-outline px-4 py-2 text-xs"
                    >
                      Continue course
                    </Link>
                    {teacherCanSubmitCourse(course.status) ? (
                      <button
                        type="button"
                        onClick={() => handleSubmitForReview(course.id)}
                        disabled={reviewingCourseId === course.id}
                        className="button-solid px-4 py-2 text-xs disabled:opacity-60"
                      >
                        {reviewingCourseId === course.id
                          ? "Submitting..."
                          : "Send for review"}
                      </button>
                    ) : null}
                    {teacherCanDeleteCourse(course.status) ? (
                      confirmingDeleteId === course.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleDeleteCourse(course.id)}
                            disabled={deletingCourseId === course.id}
                            className="button-accent px-4 py-2 text-xs disabled:opacity-60"
                          >
                            {deletingCourseId === course.id
                              ? "Deleting..."
                              : "Confirm delete"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingDeleteId(null)}
                            disabled={deletingCourseId === course.id}
                            className="button-outline px-4 py-2 text-xs disabled:opacity-60"
                          >
                            Keep draft
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(course.id)}
                          className="button-outline px-4 py-2 text-xs text-[var(--color-accent-fg)]"
                        >
                          Delete draft
                        </button>
                      )
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
