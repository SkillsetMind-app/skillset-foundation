"use client";

import Link from "next/link";
import { BookOpen, ExternalLink, Image as ImageIcon, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/components/auth/auth-provider";
import { StatusChip } from "@/components/shared/status-chip";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";

export function TeacherMembersAreaHub() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") === "communities" ? "communities" : "members";
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherCourses(
      user.uid,
      (nextCourses) => {
        setCourses(nextCourses);
        setIsLoading(false);
      },
      () => {
        setError("We could not load your members areas. Please try again.");
        setIsLoading(false);
      }
    );
  }, [user]);

  const visibleCourses =
    view === "communities" ? courses.filter((course) => course.communityEnabled) : courses;
  const createHref =
    view === "communities"
      ? "/teach/builder?newCourse=1&format=community"
      : "/teach/builder?newCourse=1&format=course";

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-line)] pb-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-accent-fg)]">
            Products
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight text-[var(--color-primary)]">
            Members & communities
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            Customize product delivery, manage learner spaces, and open the community attached to
            each product.
          </p>
        </div>
        <Link href={createHref} className="button-solid min-h-10 px-4 text-sm">
          <Plus aria-hidden="true" size={16} strokeWidth={2} />
          {view === "communities" ? "New community" : "New product"}
        </Link>
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-[8px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]"
        >
          {error}
        </p>
      ) : null}

      <section aria-labelledby="members-products-title">
        <div
          className="mb-5 inline-grid grid-cols-2 rounded-[7px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-1"
          role="radiogroup"
          aria-label="Members content type"
        >
          {(["members", "communities"] as const).map((nextView) => (
            <button
              key={nextView}
              type="button"
              role="radio"
              aria-checked={view === nextView}
              onClick={() =>
                router.push(
                  nextView === "communities" ? "/teach/members?view=communities" : "/teach/members"
                )
              }
              className={`min-h-9 rounded-[5px] px-4 text-sm font-semibold transition-colors ${
                view === nextView
                  ? "bg-[var(--color-primary)] text-white"
                  : "text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
              }`}
            >
              {nextView === "members" ? "Product spaces" : "Communities"}
            </button>
          ))}
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <h2 id="members-products-title" className="text-lg font-semibold text-[var(--color-ink)]">
            {view === "communities" ? "Communities" : "Product spaces"}
          </h2>
          {!isLoading ? (
            <span className="text-sm tabular-nums text-[var(--color-ink-muted)]">
              {visibleCourses.length}
            </span>
          ) : null}
        </div>

        <div className="mt-4 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
          {isLoading ? (
            [1, 2, 3].map((item) => (
              <div key={item} className="h-28 animate-pulse bg-[var(--color-surface-soft)]" />
            ))
          ) : visibleCourses.length === 0 ? (
            <div className="grid place-items-center px-5 py-14 text-center">
              <span className="grid size-11 place-items-center rounded-[8px] border border-[var(--color-line)] bg-white text-[var(--color-primary)]">
                <BookOpen aria-hidden="true" size={20} strokeWidth={1.8} />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-[var(--color-ink)]">
                {view === "communities" ? "No community yet" : "No product space yet"}
              </h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-[var(--color-ink-soft)]">
                {view === "communities"
                  ? "Create a recurring community product or enable community in an existing product's members settings."
                  : "Every product gets its own members area as soon as the private draft is created."}
              </p>
            </div>
          ) : (
            visibleCourses.map((course) => (
              <article
                key={course.id}
                className="grid gap-4 bg-white px-3 py-4 transition-colors hover:bg-[var(--color-surface-soft)] sm:px-4 lg:grid-cols-[minmax(0,1fr)_minmax(180px,0.45fr)_auto] lg:items-center"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid aspect-video w-24 shrink-0 place-items-center overflow-hidden rounded-[6px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
                    {course.coverImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={course.coverImageUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ImageIcon aria-hidden="true" size={19} strokeWidth={1.7} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--color-ink)]">
                      {course.title || "Untitled product"}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                      {course.modules.length} modules · {course.lessonCount} lessons
                    </p>
                    <div className="mt-2">
                      <StatusChip status={course.status} />
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                    Presentation
                  </p>
                  <p className="mt-1 text-sm font-semibold capitalize text-[var(--color-ink-soft)]">
                    {course.membersTheme ?? "light"} theme
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                    {course.membersTitle ? "Custom welcome" : "Default welcome"}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-[var(--color-ink-soft)]">
                    Community {course.communityEnabled ? "enabled" : "disabled"}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <Link
                    href={`/teach/builder/${encodeURIComponent(course.id)}/preview`}
                    className="button-solid min-h-9 px-3 text-xs"
                  >
                    <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
                    Preview
                  </Link>
                  <Link
                    href={`/teach/builder?courseId=${encodeURIComponent(course.id)}&tab=members`}
                    className="button-outline min-h-9 px-3 text-xs"
                  >
                    Customize
                  </Link>
                  <Link
                    href={`/teach/builder?courseId=${encodeURIComponent(course.id)}&tab=content`}
                    className="button-outline min-h-9 px-3 text-xs"
                  >
                    Content
                  </Link>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="border-t border-[var(--color-line)] pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-ink)]">Creator storefront</h2>
            <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
              Manage the public profile that groups all published products.
            </p>
          </div>
          <Link href="/teach/storefront" className="button-outline min-h-10 px-4 text-sm">
            Open storefront settings
          </Link>
        </div>
      </section>
    </div>
  );
}
