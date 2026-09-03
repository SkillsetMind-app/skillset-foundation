"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bookmark, BookmarkCheck, LayoutGrid, List, Search } from "lucide-react";
import { startTransition, useDeferredValue, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { CourseTile, courseCardBadge } from "@/components/courses/course-tile";
import { useInstructorNames } from "@/components/courses/use-instructor-names";
import type { CourseCard } from "@/lib/data/catalog";
import { canContinueEnrollment, type Enrollment } from "@/domain/enrollment";
import { subscribeToUserEnrollments } from "@/lib/data/enrollments";
import {
  courseSortOptions,
  sortCourseCards,
  type CourseSortKey,
} from "@/lib/data/course-sort";
import {
  isInternalSmokeCourse,
  subscribeToPublishedTeacherCourses,
  teacherCourseToCourseCard,
} from "@/lib/data/published-courses";
import {
  subscribeToUserWishlistCourseIds,
  toggleWishlistCourse,
} from "@/lib/data/wishlist";
import { getSupabaseClientConfig } from "@/lib/supabase/config";

type CourseMarketplaceProps = {
  courses?: CourseCard[];
};

const allCategoriesLabel = "All courses";

export function CourseMarketplace({ courses = [] }: CourseMarketplaceProps) {
  const { status, user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const [activeCategory, setActiveCategory] = useState(
    () => searchParams.get("cat") ?? allCategoriesLabel,
  );
  // Seed from the platform header search (`/courses?q=...`) so the term is
  // honored and the input is pre-filled; the user can refine from there.
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  // View preference only (not URL-synced like cat/q): default "featured" leads
  // with ops-curated picks, then A->Z. While nothing is featured it is identical
  // to the catalog's long-standing A->Z order, so untouched = no behavior change.
  const [sortKey, setSortKey] = useState<CourseSortKey>("featured");
  // Layout preference only (not URL-synced): grid is the long-standing default.
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [activeEnrollments, setActiveEnrollments] = useState<Enrollment[]>([]);
  const [publishedCourses, setPublishedCourses] = useState<CourseCard[]>([]);
  const [publishedCoursesError, setPublishedCoursesError] = useState("");
  const [wishlistError, setWishlistError] = useState("");
  const [wishlistCourseIds, setWishlistCourseIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [pendingWishlistCourseIds, setPendingWishlistCourseIds] = useState<
    Set<string>
  >(() => new Set());
  const [isLoadingPublishedCourses, setIsLoadingPublishedCourses] = useState(
    Boolean(getSupabaseClientConfig()),
  );
  const deferredQuery = useDeferredValue(query.toLowerCase().trim());

  // Keep category + search in the URL so a filtered view is shareable and
  // survives refresh / back-forward — consistent with the rest of the app.
  useEffect(() => {
    const desiredCat =
      activeCategory !== allCategoriesLabel ? activeCategory : null;
    const desiredQuery = query.trim() || null;

    if (
      desiredCat === searchParams.get("cat") &&
      desiredQuery === searchParams.get("q")
    ) {
      return;
    }

    const params = new URLSearchParams();
    if (desiredCat) params.set("cat", desiredCat);
    if (desiredQuery) params.set("q", desiredQuery);
    const next = params.toString();

    startTransition(() => {
      router.replace(next ? `${pathname}?${next}` : pathname, {
        scroll: false,
      });
    });
  }, [activeCategory, query, pathname, router, searchParams]);
  const marketplaceCourses = [...courses, ...publishedCourses];
  const categories = [
    allCategoriesLabel,
    ...Array.from(new Set(marketplaceCourses.map((course) => course.category))),
  ];

  useEffect(() => {
    if (!getSupabaseClientConfig()) {
      return;
    }

    return subscribeToPublishedTeacherCourses(
      (nextCourses) => {
        setPublishedCourses(
          nextCourses
            .filter((course) => !isInternalSmokeCourse(course))
            .map(teacherCourseToCourseCard),
        );
        setPublishedCoursesError("");
        setIsLoadingPublishedCourses(false);
      },
      () => {
        setPublishedCoursesError("Courses could not load right now. Refresh the page to try again.");
        setIsLoadingPublishedCourses(false);
      },
    );
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || !user) {
      return;
    }

    return subscribeToUserWishlistCourseIds(
      user.uid,
      (nextCourseIds) => {
        setWishlistCourseIds(nextCourseIds);
        setWishlistError("");
      },
      () => {
        setWishlistError("Your wishlist could not load right now. Refresh the page to try again.");
      },
    );
  }, [status, user]);

  // Continue-learning strip data. Mirrors the learn dashboard subscription
  // lifecycle; on any error we simply keep the strip empty (no blocking UI on a
  // browse page). Guarded behind authenticated status + a valid user id.
  useEffect(() => {
    if (status !== "authenticated" || !user || !getSupabaseClientConfig()) {
      return;
    }

    return subscribeToUserEnrollments(
      user.uid,
      (nextEnrollments) => {
        setActiveEnrollments(
          nextEnrollments.filter((enrollment) =>
            canContinueEnrollment(enrollment.status),
          ),
        );
      },
      () => {
        setActiveEnrollments([]);
      },
    );
  }, [status, user]);

  async function handleToggleWishlist(course: CourseCard) {
    if (!user) {
      router.push("/auth?mode=signup");
      return;
    }

    setPendingWishlistCourseIds((current) => new Set(current).add(course.slug));
    setWishlistError("");

    try {
      await toggleWishlistCourse({
        userId: user.uid,
        courseId: course.slug,
        courseSlug: course.slug,
      });
    } catch {
      setWishlistError("Could not update your saved courses. Please try again.");
    } finally {
      setPendingWishlistCourseIds((current) => {
        const next = new Set(current);
        next.delete(course.slug);
        return next;
      });
    }
  }

  const visibleCourses = marketplaceCourses.filter((course) => {
    const matchesCategory =
      activeCategory === allCategoriesLabel || course.category === activeCategory;
    const matchesQuery =
      !deferredQuery ||
      `${course.title} ${course.category} ${course.summary}`
        .toLowerCase()
        .includes(deferredQuery);

    return matchesCategory && matchesQuery;
  });
  const sortedCourses = sortCourseCards(visibleCourses, sortKey);
  const instructors = useInstructorNames(
    sortedCourses.map((course) => course.ownerId),
  );

  const hasAnyCourses = marketplaceCourses.length > 0;
  const isFiltering =
    activeCategory !== allCategoriesLabel || deferredQuery.length > 0;

  // Real per-category counts from the loaded courses (All = total).
  const categoryCounts = new Map<string, number>();
  for (const course of marketplaceCourses) {
    categoryCounts.set(
      course.category,
      (categoryCounts.get(course.category) ?? 0) + 1,
    );
  }
  function categoryCount(filter: string): number {
    return filter === allCategoriesLabel
      ? marketplaceCourses.length
      : (categoryCounts.get(filter) ?? 0);
  }

  // Join active enrollments to the visible catalog by slug so we can show the
  // course image/title; skip enrollments whose course isn't currently listed.
  const courseBySlug = new Map(
    marketplaceCourses.map((course) => [course.slug, course]),
  );
  const continueItems = activeEnrollments.flatMap((enrollment) => {
    const course = courseBySlug.get(enrollment.courseSlug);
    return course ? [{ enrollment, course }] : [];
  });

  return (
    <section className="marketplace-section">
      <div className="marketplace-filter-panel">
        <div className="marketplace-filter-list">
          {categories.map((filter) => {
            const isActive = activeCategory === filter;

            return (
              <button
                key={filter}
                type="button"
                aria-pressed={isActive}
                onClick={() => setActiveCategory(filter)}
                className={`marketplace-filter-button ${
                  isActive ? "is-active" : ""
                }`}
              >
                <span>{filter}</span>
                <span className="marketplace-filter-button__count">
                  {categoryCount(filter)}
                </span>
              </button>
            );
          })}
        </div>
        <div className="marketplace-controls">
          <label className="marketplace-field">
            <span>Search</span>
            <span className="marketplace-searchbox">
              <Search aria-hidden="true" size={15} strokeWidth={2} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search skill, category, or outcome"
              />
            </span>
          </label>
          <label className="marketplace-field">
            <span>Sort by</span>
            <select
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as CourseSortKey)}
              className="marketplace-select"
            >
              {courseSortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="marketplace-view">
            <span className="marketplace-view-label">View</span>
            <div
              className="marketplace-view-toggle"
              role="group"
              aria-label="View layout"
            >
              <button
                type="button"
                aria-pressed={viewMode === "grid"}
                aria-label="Grid view"
                title="Grid view"
                onClick={() => setViewMode("grid")}
                className={`marketplace-icon-button ${
                  viewMode === "grid" ? "is-active" : ""
                }`}
              >
                <LayoutGrid aria-hidden="true" size={16} strokeWidth={2} />
                <span className="sr-only">Grid</span>
              </button>
              <button
                type="button"
                aria-pressed={viewMode === "list"}
                aria-label="List view"
                title="List view"
                onClick={() => setViewMode("list")}
                className={`marketplace-icon-button ${
                  viewMode === "list" ? "is-active" : ""
                }`}
              >
                <List aria-hidden="true" size={16} strokeWidth={2} />
                <span className="sr-only">List</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {status === "authenticated" && continueItems.length > 0 ? (
        <div className="marketplace-continue">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Continue learning
          </p>
          <div className="marketplace-continue__rail">
            {continueItems.map(({ enrollment, course }) => {
              const progress = Math.max(
                0,
                Math.min(100, enrollment.progressPercent),
              );

              return (
                <div
                  key={enrollment.id}
                  className="marketplace-continue-card"
                >
                  <div className="marketplace-continue-card__thumb">
                    <Image
                      src={course.image}
                      alt={course.title}
                      fill
                      sizes="56px"
                      className="object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="marketplace-continue-card__title">
                      {course.title}
                    </p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[rgba(26,54,93,0.12)]">
                      <div
                        className="h-full rounded-full bg-[var(--color-accent)]"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
                      {progress}% complete
                    </p>
                  </div>
                  <Link
                    href={`/learn/courses/${enrollment.courseSlug}`}
                    className="button-solid shrink-0 px-3 py-2 text-xs"
                  >
                    Resume
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {publishedCoursesError ? (
        <p className="mb-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
          {publishedCoursesError}
        </p>
      ) : null}

      {wishlistError ? (
        <p className="mb-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
          {wishlistError}
        </p>
      ) : null}

      {isLoadingPublishedCourses ? (
        <>
          <p role="status" className="sr-only">
            Loading courses...
          </p>
          <div className="marketplace-course-grid" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="marketplace-card animate-pulse"
              >
                <div className="marketplace-card__media bg-[var(--color-surface-strong)]" />
                <div className="space-y-3 p-5">
                  <div className="h-3 w-24 rounded bg-[var(--color-surface-strong)]" />
                  <div className="h-6 w-3/4 rounded bg-[var(--color-surface-strong)]" />
                  <div className="h-16 rounded bg-[var(--color-surface-soft)]" />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : visibleCourses.length === 0 ? (
        hasAnyCourses && isFiltering ? (
          <div className="marketplace-empty">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              No matches
            </p>
            <h2 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
              No courses match your search.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[var(--color-ink-soft)]">
              Try a different category or keyword.
            </p>
            <button
              type="button"
              onClick={() => {
                setActiveCategory(allCategoriesLabel);
                setQuery("");
              }}
              className="button-outline mt-5 px-4 py-2.5 text-sm"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="marketplace-empty">
            <div className="mx-auto grid size-14 place-items-center rounded-[14px] bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-7"
              >
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            </div>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              Marketplace opening soon
            </p>
            <h2 className="display-title mt-3 text-3xl text-[var(--color-ink)] sm:text-4xl">
              The first courses are on the way.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-[var(--color-ink-soft)]">
              SkillsetMind reviews every course in the catalog to keep quality
              high. Want to be among the first educators to publish here?
              You can start today.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href="/auth?mode=signup&path=teacher" className="button-solid px-4 py-2.5 text-sm">
                Start teaching
              </Link>
              <Link href="/for-creators" className="button-outline px-4 py-2.5 text-sm">
                Creator overview
              </Link>
            </div>
          </div>
        )
      ) : (
        <div
          className={
            viewMode === "list"
              ? "marketplace-course-grid marketplace-course-grid--list"
              : "marketplace-course-grid"
          }
        >
          {sortedCourses.map((track) => {
            const isWishlisted =
              status === "authenticated" && wishlistCourseIds.has(track.slug);
            const isWishlistPending = pendingWishlistCourseIds.has(track.slug);
            const WishlistIcon = isWishlisted ? BookmarkCheck : Bookmark;
            const isList = viewMode === "list";

            return (
              <CourseTile
                key={`${track.slug}-${track.title}`}
                className={isList ? "marketplace-card--list" : ""}
                href={track.href ?? `/courses/${track.slug}`}
                title={track.title}
                image={track.image}
                summary={track.summary}
                category={track.category}
                meta={track.duration}
                badge={courseCardBadge(track)}
                priceLabel={track.priceLabel}
                rating={
                  track.ratingAverage && track.ratingCount
                    ? { average: track.ratingAverage, count: track.ratingCount }
                    : null
                }
                instructor={
                  (track.ownerId && instructors.get(track.ownerId)) || null
                }
                imageSizes={
                  isList
                    ? "(max-width: 768px) 100vw, 34vw"
                    : "(max-width: 1024px) 100vw, 33vw"
                }
                overlay={
                  <button
                    type="button"
                    aria-pressed={isWishlisted}
                    aria-label={
                      isWishlisted
                        ? `Remove ${track.title} from wishlist`
                        : `Save ${track.title} to wishlist`
                    }
                    title={
                      isWishlisted
                        ? "Remove from wishlist"
                        : status === "authenticated"
                          ? "Save to wishlist"
                          : "Sign in to save"
                    }
                    disabled={isWishlistPending}
                    onClick={() => void handleToggleWishlist(track)}
                    className={`marketplace-card__wishlist ${
                      isWishlisted ? "is-active" : ""
                    }`}
                  >
                    <WishlistIcon aria-hidden="true" size={18} strokeWidth={2} />
                  </button>
                }
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
