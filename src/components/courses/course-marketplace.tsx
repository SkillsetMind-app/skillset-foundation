"use client";

import { getCourseCategoryLabel } from "@/lib/i18n/course-categories";
import { LOCALES } from "@/lib/i18n/config";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

import { useTranslation } from "@/components/i18n/i18n-provider";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bookmark, BookmarkCheck, ChevronDown, LayoutGrid, List, Search, SlidersHorizontal } from "lucide-react";
import { startTransition, useDeferredValue, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { CourseGridSkeleton } from "@/components/courses/course-grid-skeleton";
import { CourseTile } from "@/components/courses/course-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { ProgressBar } from "@/components/ui/progress-bar";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import { useInstructorNames } from "@/components/courses/use-instructor-names";
import type { TeacherCourse } from "@/domain/teacher-course";
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
  const { t } = useTranslation();
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
  // So no celular (CSS abaixo de 640px): os filtros fechados atras de um botao.
  // Abertos, eram uns 800px de cabecalho e filtros antes do primeiro curso.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeEnrollments, setActiveEnrollments] = useState<Enrollment[]>([]);
  const [publishedCourses, setPublishedCourses] = useState<TeacherCourse[]>([]);
  const [publishedCoursesError, setPublishedCoursesError] = useState("");
  // A falha de LER os favoritos (com "Try again") e a de salvar um favorito
  // (só o aviso) ficam à parte: salvar outro não apaga a primeira.
  const [wishlistLoadFailed, setWishlistLoadFailed] = useState(false);
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
  // "Try again" lê de novo pela mesma inscrição (sem religar); o foco vai para
  // a seção, que fica na tela quando o aviso some.
  const coursesSubscription = useRef<{ reload: () => Promise<void> } | null>(null);
  const wishlistSubscription = useRef<{ reload: () => Promise<void> } | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
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

    const params = new URLSearchParams(searchParams.toString());
    params.delete("cat");
    params.delete("q");
    if (desiredCat) params.set("cat", desiredCat);
    if (desiredQuery) params.set("q", desiredQuery);
    const next = params.toString();

    startTransition(() => {
      router.replace(next ? `${pathname}?${next}` : pathname, {
        scroll: false,
      });
    });
  }, [activeCategory, query, pathname, router, searchParams]);
  const marketplaceCourses = [...courses, ...publishedCourses.map((course) => teacherCourseToCourseCard(course))];
  const categories = [
    allCategoriesLabel,
    ...Array.from(new Set(marketplaceCourses.map((course) => course.category))),
  ];

  useEffect(() => {
    if (!getSupabaseClientConfig()) {
      return;
    }

    const current = subscribeToPublishedTeacherCourses(
      (nextCourses) => {
        setPublishedCourses(
          nextCourses
            .filter((course) => !isInternalSmokeCourse(course)),
        );
        setPublishedCoursesError("");
        setIsLoadingPublishedCourses(false);
      },
      () => {
        setPublishedCoursesError("publicCourses.loadCoursesError");
        setIsLoadingPublishedCourses(false);
      },
    );
    coursesSubscription.current = current;
    return () => {
      coursesSubscription.current = null;
      current();
    };
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || !user) {
      return;
    }

    const current = subscribeToUserWishlistCourseIds(
      user.uid,
      (nextCourseIds) => {
        setWishlistCourseIds(nextCourseIds);
        setWishlistLoadFailed(false);
        setWishlistError("");
      },
      () => {
        setWishlistLoadFailed(true);
      },
    );
    wishlistSubscription.current = current;
    return () => {
      wishlistSubscription.current = null;
      current();
    };
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
      setWishlistError("publicCourses.updateWishlistError");
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
      [
        course.title,
        course.category,
        ...LOCALES.map((locale) => getCourseCategoryLabel(
          course.category,
          (key) => translate(getDictionary(locale), key),
        )),
        course.summary,
      ].join(" ")
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
  // Quantos filtros estao valendo (categoria e busca), no botao "Filters" do
  // celular: com o painel fechado, a pessoa ainda ve que a lista esta filtrada.
  const activeFilterCount =
    (activeCategory !== allCategoriesLabel ? 1 : 0) + (query.trim() ? 1 : 0);

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
    <section ref={sectionRef} tabIndex={-1} className="marketplace-section">
      <div className="marketplace-filter-panel">
        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="marketplace-filters"
          onClick={() => setFiltersOpen((open) => !open)}
          className="marketplace-filters-toggle"
        >
          <SlidersHorizontal aria-hidden="true" size={16} strokeWidth={2} />
          <span>{t("publicCourses.filters")}</span>
          {activeFilterCount > 0 ? (
            <>
              <span aria-hidden="true" className="marketplace-filters-toggle__count">{activeFilterCount}</span>
              {" "}
              <span className="sr-only">{t("publicCourses.filtersActive").replace("{count}", String(activeFilterCount))}</span>
            </>
          ) : null}
          <ChevronDown aria-hidden="true" size={16} strokeWidth={2} className="marketplace-filters-toggle__chevron" />
        </button>
        <div id="marketplace-filters" className={`marketplace-filter-body${filtersOpen ? " is-open" : ""}`}>
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
                  <span>{filter === allCategoriesLabel ? t("publicCourses.all") : getCourseCategoryLabel(filter, t)}</span>
                  {/* Sem número até a lista chegar: "All courses 0" lia como loja vazia. */}
                  {isLoadingPublishedCourses ? null : (
                    <span className="marketplace-filter-button__count">
                      {categoryCount(filter)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="marketplace-controls">
            <label className="marketplace-field">
              <span>{t("publicCourses.search")}</span>
              <span className="marketplace-searchbox">
                <Search aria-hidden="true" size={15} strokeWidth={2} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("publicCourses.searchHint")}
                />
              </span>
            </label>
            <label className="marketplace-field">
              <span>{t("publicCourses.sort")}</span>
              <select
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as CourseSortKey)}
                className="marketplace-select"
              >
                {courseSortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
            </label>
            <div className="marketplace-view">
              <span className="marketplace-view-label">{t("publicCourses.view")}</span>
              <div
                className="marketplace-view-toggle"
                role="group"
                aria-label={t("publicCourses.viewLayout")}
              >
                <button
                  type="button"
                  aria-pressed={viewMode === "grid"}
                  aria-label={t("publicCourses.gridView")}
                  title={t("publicCourses.gridView")}
                  onClick={() => setViewMode("grid")}
                  className={`marketplace-icon-button ${
                    viewMode === "grid" ? "is-active" : ""
                  }`}
                >
                  <LayoutGrid aria-hidden="true" size={16} strokeWidth={2} />
                  <span className="sr-only">{t("publicCourses.grid")}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={viewMode === "list"}
                  aria-label={t("publicCourses.listView")}
                  title={t("publicCourses.listView")}
                  onClick={() => setViewMode("list")}
                  className={`marketplace-icon-button ${
                    viewMode === "list" ? "is-active" : ""
                  }`}
                >
                  <List aria-hidden="true" size={16} strokeWidth={2} />
                  <span className="sr-only">{t("publicCourses.list")}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {status === "authenticated" && continueItems.length > 0 ? (
        <div className="marketplace-continue">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">{t("publicCourses.continueLearning")}</p>
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
                    <ProgressBar
                      value={progress}
                      label={t("publicCourses.complete").replace("{count}", String(progress))}
                      className="mt-2"
                    />
                    {/* A barra já diz "40% complete" ao leitor de tela: a linha
                        visível fica calada para o número não ser lido duas vezes. */}
                    <p aria-hidden="true" className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
                      {t("publicCourses.complete").replace("{count}", String(progress))}
                    </p>
                  </div>
                  <Link
                    href={`/learn/courses/${enrollment.courseSlug}`}
                    className="button-solid shrink-0 px-3 py-2 text-xs"
                  >
                    {t("publicCourses.resume")}
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Erro de leitura com "Try again"; o aviso só sai quando a leitura
          volta. A falha ao salvar um favorito segue sendo só o aviso. */}
      {publishedCoursesError ? (
        <LoadErrorAlert
          className="mb-5"
          focusRef={sectionRef}
          onRetry={() => coursesSubscription.current?.reload()}
        >
          {t(publishedCoursesError)}
        </LoadErrorAlert>
      ) : null}

      {wishlistLoadFailed ? (
        <LoadErrorAlert
          className="mb-5"
          focusRef={sectionRef}
          onRetry={() => wishlistSubscription.current?.reload()}
        >
          {t("publicCourses.loadWishlistError")}
        </LoadErrorAlert>
      ) : null}

      {wishlistError ? (
        <InlineAlert tone="error" className="mb-5">{t(wishlistError)}</InlineAlert>
      ) : null}

      {isLoadingPublishedCourses ? (
        <>
          <p role="status" className="sr-only">{t("publicCourses.loadingCourses")}</p>
          <CourseGridSkeleton />
        </>
      ) : visibleCourses.length === 0 ? (
        // Com a leitura em erro, o vazio mentiria ("Marketplace opening soon").
        publishedCoursesError ? null : hasAnyCourses && isFiltering ? (
          // O vazio da plataforma (EmptyState): o h1 serifado da página continua
          // sendo a única manchete; antes este h2 era outra serifa de 30px.
          <EmptyState
            as="h2"
            eyebrow={t("publicCourses.noMatches")}
            title={t("publicCourses.noSearchMatches")}
            description={t("publicCourses.trySearch")}
            action={
              <button
                type="button"
                onClick={() => {
                  setActiveCategory(allCategoriesLabel);
                  setQuery("");
                }}
                className="button-outline px-4 py-2.5 text-sm"
              >{t("publicCourses.clearFilters")}</button>
            }
          />
        ) : (
          <EmptyState
            as="h2"
            eyebrow={t("publicCourses.openingSoon")}
            title={t("publicCourses.firstCourses")}
            description={t("publicCourses.openingBody")}
            action={
              <>
                <Link href="/auth?mode=signup&path=teacher" className="button-solid px-4 py-2.5 text-sm">{t("publicCourses.startTeaching")}</Link>
                <Link href="/for-creators" className="button-outline px-4 py-2.5 text-sm">{t("publicCourses.creatorOverview")}</Link>
              </>
            }
          />
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
                courseData={{
                  lessonCount: track.lessonCount,
                  priceAmountMinor: track.priceAmountMinor,
                  currency: track.currency,
                  freePreviewHref: track.freePreviewHref,
                  ratingCount: track.ratingCount,
                  ownerId: track.ownerId,
                  featured: track.featured,
                }}
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
                        ? t("publicCourses.removeTitleWishlist").replace("{title}", () => track.title)
                        : t("publicCourses.saveTitleWishlist").replace("{title}", () => track.title)
                    }
                    title={
                      isWishlisted
                        ? t("publicCourses.removeWishlist")
                        : status === "authenticated"
                          ? t("publicCourses.saveWishlist")
                          : t("publicCourses.signInSave")
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
