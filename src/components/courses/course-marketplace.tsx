"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { startTransition, useDeferredValue, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import type { CourseCard } from "@/lib/data/catalog";
import type { TeacherCourse } from "@/domain/teacher-course";
import {
  courseSortOptions,
  sortCourseCards,
  type CourseSortKey,
} from "@/lib/data/course-sort";
import {
  subscribeToPublishedTeacherCourses,
  teacherCourseToCourseCard,
} from "@/lib/data/published-courses";
import {
  subscribeToUserWishlistCourseIds,
  toggleWishlistCourse,
} from "@/lib/data/wishlist";
import { getFirebaseClientConfig } from "@/lib/firebase/config";

type CourseMarketplaceProps = {
  courses?: CourseCard[];
};

const allCategoriesLabel = "All courses";

// Internal live-checkout smoke-test courses (priced at $1, used to verify the
// real Stripe pipeline end to end) are published under a deliberate `smoke-`
// id prefix. They must stay published and reachable by direct URL for that
// test, but must never surface in the public marketplace browse.
function isInternalSmokeCourse(course: TeacherCourse): boolean {
  return course.id.startsWith("smoke-");
}

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
    Boolean(getFirebaseClientConfig()),
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
    if (!getFirebaseClientConfig()) {
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

  const hasAnyCourses = marketplaceCourses.length > 0;
  const isFiltering =
    activeCategory !== allCategoriesLabel || deferredQuery.length > 0;

  return (
    <section>
      <div className="mb-8 grid gap-3 lg:grid-cols-[1fr_280px] lg:items-start">
        <div className="flex flex-wrap gap-2.5">
          {categories.map((filter) => {
            const isActive = activeCategory === filter;

            return (
              <button
                key={filter}
                type="button"
                aria-pressed={isActive}
                onClick={() => setActiveCategory(filter)}
                className={
                  isActive
                    ? "button-solid px-3.5 py-2 text-xs"
                    : "button-outline px-3.5 py-2 text-xs"
                }
              >
                {filter}
              </button>
            );
          })}
        </div>
        <div className="grid gap-3">
          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            Search
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search skill, category, or outcome"
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            Sort
            <select
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as CourseSortKey)}
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
            >
              {courseSortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {publishedCoursesError ? (
        <p className="mb-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          {publishedCoursesError}
        </p>
      ) : null}

      {wishlistError ? (
        <p className="mb-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          {wishlistError}
        </p>
      ) : null}

      {isLoadingPublishedCourses ? (
        <div className="grid gap-5 lg:grid-cols-3" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="surface-card animate-pulse overflow-hidden rounded-[18px]"
            >
              <div className="aspect-[4/3] bg-[var(--color-surface-strong)]" />
              <div className="space-y-3 p-5">
                <div className="h-3 w-24 rounded bg-[var(--color-surface-strong)]" />
                <div className="h-6 w-3/4 rounded bg-[var(--color-surface-strong)]" />
                <div className="h-16 rounded bg-[var(--color-surface-soft)]" />
              </div>
            </div>
          ))}
        </div>
      ) : visibleCourses.length === 0 ? (
        hasAnyCourses && isFiltering ? (
          <div className="rounded-[18px] border border-[var(--color-line)] bg-white p-8 text-center shadow-[var(--shadow-soft)]">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-brand)]">
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
          <div className="rounded-[18px] border-2 border-dashed border-[var(--color-line-strong)] bg-white p-8 text-center sm:p-12">
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
              Skillset reviews every course in the catalog to keep quality
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
        <div className="grid gap-5 lg:grid-cols-3">
          {sortedCourses.map((track) => {
            const hasFreePreview = Boolean(track.freePreviewHref);
            const isWishlisted =
              status === "authenticated" && wishlistCourseIds.has(track.slug);
            const isWishlistPending = pendingWishlistCourseIds.has(track.slug);
            const WishlistIcon = isWishlisted ? BookmarkCheck : Bookmark;

            return (
            <article
              key={`${track.slug}-${track.title}`}
              className="surface-card overflow-hidden rounded-[18px]"
            >
              <div className="relative aspect-[4/3] overflow-hidden">
                <Image
                  src={track.image}
                  alt={track.title}
                  fill
                  sizes="(max-width: 1024px) 100vw, 33vw"
                  className="object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[rgba(15,39,68,0.84)] via-transparent to-transparent" />
                <div className="absolute left-5 top-5 flex flex-wrap gap-2">
                  <span className="accent-chip rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em]">
                    {track.status}
                  </span>
                  <span className="accent-chip rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em]">
                    {track.sourceLabel ?? "Preview"}
                  </span>
                </div>
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
                  className={`absolute right-5 top-5 grid size-10 place-items-center rounded-full border border-white/30 shadow-[0_12px_24px_rgba(15,39,68,0.22)] transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-60 ${
                    isWishlisted
                      ? "bg-[var(--color-primary)] text-[var(--color-base)]"
                      : "bg-white/95 text-[var(--color-primary)]"
                  }`}
                >
                  <WishlistIcon aria-hidden="true" size={18} strokeWidth={2} />
                </button>
              </div>
              <div className="p-5">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent-fg)]">
                    {track.category}
                  </span>
                  <span className="text-xs text-[var(--color-ink-soft)]">{track.duration}</span>
                </div>
                <h2 className="display-title mt-4 text-3xl leading-tight text-[var(--color-primary)]">
                  {track.title}
                </h2>
                <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
                  {track.summary}
                </p>
                <div className="mt-5 grid gap-2 rounded-[12px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm">
                  <p className="font-semibold text-[var(--color-ink)]">
                    {track.priceLabel}
                  </p>
                  <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
                    {track.freePreviewLabel}
                  </p>
                  {track.ratingLabel ? (
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
                      {track.ratingLabel}
                    </p>
                  ) : null}
                </div>
                <div className="mt-6 flex flex-wrap gap-2">
                  <Link
                    href={track.href ?? `/courses/${track.slug}`}
                    className="button-solid px-3.5 py-2 text-xs"
                  >
                    View course
                  </Link>
                  {hasFreePreview ? (
                    <Link
                      href={track.freePreviewHref ?? `/courses/${track.slug}#free-preview`}
                      className="button-outline px-4 py-2.5 text-sm"
                    >
                      Free preview
                    </Link>
                  ) : null}
                </div>
              </div>
            </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
