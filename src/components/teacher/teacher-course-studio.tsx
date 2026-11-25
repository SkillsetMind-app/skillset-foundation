"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Layers3,
  Megaphone,
  MoreHorizontal,
  Plus,
  UsersRound,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { CoverThumbnail } from "@/components/shared/cover-thumbnail";
import { ListingSearchBar } from "@/components/shared/listing-search-bar";
import { ShortId } from "@/components/shared/short-id";
import { StatusChip } from "@/components/shared/status-chip";
import {
  CourseActionsMenu,
  DeleteOrArchiveCourseDialog,
} from "@/components/teacher/course-actions";
import { ProductRowsSkeleton } from "@/components/teacher/builder-skeleton";
import { CreateCourseStart } from "@/components/teacher/create-course-start";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { TeacherCourse, TeacherCourseProductFormat } from "@/domain/teacher-course";
import { getMyCoursesBeingDeleted, type CourseBeingDeleted } from "@/lib/data/course-deletions";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";
import { getCourseCategoryLabel } from "@/lib/i18n/course-categories";

type ProductFilter = "all" | "draft" | "in_review" | "published" | "inactive" | "attention";

// Labels are dictionary keys resolved at render, so the list follows a locale
// switch; the ids stay the data codes the filter compares against.
const productFilters: Array<{ id: ProductFilter; labelKey: string }> = [
  { id: "all", labelKey: "creatorPanel.filters.all" },
  { id: "draft", labelKey: "creatorPanel.filters.drafts" },
  { id: "in_review", labelKey: "creatorPanel.products.filterLegacyReview" },
  { id: "published", labelKey: "creatorPanel.products.filterLive" },
  // The archive modal promises "you can restore it later in Archived". Without
  // this entry the promise had nowhere to be fulfilled: 'inactive' only showed up
  // inside "Needs attention", which is something else.
  { id: "inactive", labelKey: "creatorPanel.products.filterArchived" },
  { id: "attention", labelKey: "creatorPanel.filters.needsAttention" },
];

const workspaceShortcuts = [
  {
    titleKey: "platform.nav.membersArea",
    detailKey: "creatorPanel.products.shortcuts.membersDetail",
    href: "/teach/members",
    icon: UsersRound,
  },
  {
    titleKey: "platform.nav.onlineEvents",
    detailKey: "creatorPanel.products.shortcuts.eventsDetail",
    href: "/teach/events",
    icon: CalendarDays,
  },
  {
    titleKey: "creatorPanel.hub.tools.marketing",
    detailKey: "creatorPanel.products.shortcuts.marketingDetail",
    href: "/teach/marketing",
    icon: Megaphone,
  },
  // "Coupons" is gone: it led to /teach/coupons, which goes back to this same
  // page. Coupons live inside each product.
] as const;

function filterMatches(course: TeacherCourse, filter: ProductFilter) {
  if (filter === "all") return true;
  if (filter === "attention") {
    return course.status === "needs_changes" || course.status === "inactive";
  }
  return course.status === filter;
}

function ProductActionsMenu({
  course,
  onRequestDelete,
}: {
  course: TeacherCourse;
  onRequestDelete: () => void;
}) {
  const { t } = useTranslation();
  const courseTitle = course.title || t("creatorPanel.untitledProduct");
  const itemClass =
    "flex min-h-11 items-center rounded-md px-3 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]";

  return (
    <CourseActionsMenu courseTitle={courseTitle} icon={MoreHorizontal}>
      <Link
        href={`/teach/builder?courseId=${encodeURIComponent(course.id)}`}
        role="menuitem"
        className={itemClass}
      >
        {t("creatorPanel.products.actions.edit")}
      </Link>
      <Link
        href={`/teach/builder/${encodeURIComponent(course.id)}/preview`}
        role="menuitem"
        className={itemClass}
      >
        {t("creatorPanel.products.actions.viewAsStudent")}
      </Link>
      {/* No status gate: the same action as the hub, and the server decides whether the
          course disappears or goes to the archive. Before, the item vanished for everything that
          was not a draft, and the teacher was left with no way out. */}
      <button
        type="button"
        role="menuitem"
        onClick={onRequestDelete}
        className="flex min-h-11 w-full items-center rounded-md border-t border-[var(--color-line)] px-3 text-left text-sm font-semibold text-[var(--color-danger-fg)] hover:bg-[var(--color-danger-soft)]"
      >
        {t("creatorPanel.products.actions.delete")}
      </button>
    </CourseActionsMenu>
  );
}

export function TeacherCourseStudio({
  autoOpenCreate = false,
  initialFormat = "course",
}: {
  autoOpenCreate?: boolean;
  initialFormat?: TeacherCourseProductFormat;
}) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const productView = searchParams.get("view") === "communities" ? "communities" : "products";
  // The top search sends to /teach/builder?q=: the list already arrives filtered.
  // A new search with the list open changes ?q= without remounting the screen, so
  // the field follows the URL when it changes (and only then).
  const urlQuery = searchParams.get("q") ?? "";
  const [seededQuery, setSeededQuery] = useState(urlQuery);
  const [courseQuery, setCourseQuery] = useState(urlQuery);
  if (seededQuery !== urlQuery) {
    setSeededQuery(urlQuery);
    setCourseQuery(urlQuery);
  }
  const [statusFilter, setStatusFilter] = useState<ProductFilter>("all");
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  // Kept as a dictionary key so the message follows a locale switch.
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);
  const coursesSubscription = useRef<{ reload: () => Promise<void> } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [beingDeleted, setBeingDeleted] = useState<CourseBeingDeleted[]>([]);
  const normalizedCourseQuery = courseQuery.toLowerCase().trim();
  const visibleCourses = courses.filter((course) => {
    if (productView === "communities" && !course.communityEnabled) {
      return false;
    }

    const matchesSearch = normalizedCourseQuery
      ? `${course.title} ${course.summary} ${course.category} ${course.status}`
          .toLowerCase()
          .includes(normalizedCourseQuery)
      : true;
    return matchesSearch && filterMatches(course, statusFilter);
  });

  useEffect(() => {
    if (!user) {
      return;
    }

    const current = subscribeToTeacherCourses(
      user.uid,
      (nextCourses) => {
        setCourses(nextCourses);
        setErrorKey(null);
        setIsLoadingCourses(false);
      },
      () => {
        setErrorKey("creatorPanel.products.loadError");
        setIsLoadingCourses(false);
      },
    );
    coursesSubscription.current = current;
    return () => {
      coursesSubscription.current = null;
      current();
    };
  }, [user]);

  async function retryLoad() {
    setRetrying(true);
    try {
      await coursesSubscription.current?.reload();
    } finally {
      setRetrying(false);
    }
  }

  // ponytail: re-reads when the real-time list changes, which is exactly when
  // a product disappears. Failed: hides the list, which is only informational.
  useEffect(() => {
    if (!user) {
      return;
    }

    let live = true;
    getMyCoursesBeingDeleted()
      .then((next) => {
        if (live) setBeingDeleted(next);
      })
      .catch(() => {
        if (live) setBeingDeleted([]);
      });
    return () => {
      live = false;
    };
  }, [user, courses]);

  if (autoOpenCreate) {
    return user ? (
      <CreateCourseStart ownerId={user.uid} initialFormat={initialFormat} />
    ) : (
      <p className="rounded-lg border border-[var(--color-line)] bg-white p-4 text-sm text-[var(--color-ink-soft)]">
        {t("creatorPanel.products.signIn")}
      </p>
    );
  }

  const createHref =
    productView === "communities"
      ? "/teach/builder?newCourse=1&format=community"
      : "/teach/builder?newCourse=1&format=course";
  const confirmingDeleteCourse =
    courses.find((course) => course.id === confirmingDeleteId) ?? null;
  const count = (oneKey: string, manyKey: string, value: number) =>
    t(value === 1 ? oneKey : manyKey).replace("{count}", () => String(value));
  const communityCount = courses.filter((course) => course.communityEnabled).length;

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-line)] pb-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-accent-fg)]">
            {t("creatorPanel.products.eyebrow")}
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight text-[var(--color-primary)]">
            {t("platform.nav.courseBuilder")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("creatorPanel.products.description")}
          </p>
        </div>
        <Link href={createHref} className="button-solid px-4 text-sm">
          <Plus aria-hidden="true" size={16} strokeWidth={2} />
          {t("creatorPanel.newProduct")}
        </Link>
      </header>

      {/* "Try again" reads again through the same channel (without unsubscribing and resubscribing);
          the error only goes away when the list arrives. */}
      {errorKey ? (
        <div className="grid gap-3">
          <InlineAlert tone="error">{t(errorKey)}</InlineAlert>
          <Button
            variant="outline"
            className="justify-self-start"
            loading={retrying}
            busyLabel={t("appErrors.retry")}
            onClick={() => void retryLoad()}
          >
            {t("appErrors.retry")}
          </Button>
        </div>
      ) : null}

      <section aria-labelledby="product-list-title">
        <div>
          <h2 id="product-list-title" className="text-lg font-semibold text-[var(--color-ink)]">
            {productView === "communities"
              ? t("creatorPanel.products.communityWorkspace")
              : t("creatorPanel.products.productWorkspace")}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            {isLoadingCourses
              ? t("creatorPanel.products.loading")
              : productView === "communities"
                ? count(
                    "creatorPanel.products.communityOne",
                    "creatorPanel.products.communityMany",
                    communityCount,
                  )
                : count(
                    "creatorPanel.products.productOne",
                    "creatorPanel.products.productMany",
                    courses.length,
                  )}
          </p>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(220px,1fr)_minmax(150px,auto)_minmax(170px,auto)] md:items-end">
          <ListingSearchBar
            // The field keeps its own draft; a new search from the top remounts it
            // with the new text.
            key={seededQuery}
            value={courseQuery}
            onChange={setCourseQuery}
            placeholder={
              productView === "communities"
                ? t("creatorPanel.products.searchCommunities")
                : t("creatorPanel.products.searchProducts")
            }
            className="max-w-none"
          />
          <label className="grid gap-1 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
            {t("creatorPanel.products.typeLabel")}
            <select
              aria-label={t("creatorPanel.products.typeAria")}
              value={productView}
              onChange={(event) =>
                router.push(
                  event.target.value === "communities"
                    ? "/teach/builder?view=communities"
                    : "/teach/builder",
                )
              }
              // h-11: .field-input gives 45px; the search next to it is 44.
              className="field-input h-11 normal-case tracking-normal"
            >
              <option value="products">{t("creatorPanel.products.eyebrow")}</option>
              <option value="communities">{t("platform.nav.communities")}</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
            {t("creatorPanel.products.status")}
            <select
              aria-label={t("creatorPanel.products.statusAria")}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as ProductFilter)}
              className="field-input h-11 normal-case tracking-normal"
            >
              {productFilters.map((filter) => (
                <option key={filter.id} value={filter.id}>
                  {t(filter.labelKey)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Deleted, but files and videos still in the queue (pending status). Not
            clickable: the product no longer exists. */}
        {beingDeleted.length > 0 ? (
          <ul
            aria-label={t("creatorPanel.products.beingDeleted.aria")}
            className="mt-5 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]"
          >
            {beingDeleted.map((item) => (
              <li
                key={item.courseId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-white px-3 py-3 sm:px-4"
              >
                <span className="min-w-0 truncate text-sm font-semibold text-[var(--color-ink-soft)]">
                  {item.title || t("creatorPanel.untitledProduct")}
                </span>
                <StatusChip status="deleting" />
                <span className="w-full text-xs text-[var(--color-ink-muted)] sm:w-auto">
                  {t("creatorPanel.products.beingDeleted.note")}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-5">
          {isLoadingCourses ? (
            <ProductRowsSkeleton label={t("creatorPanel.products.loadingAria")} />
          ) : errorKey && courses.length === 0 ? (
            // The read failed and nothing arrived: the error with "Try again" above
            // is enough. "No products yet" below it claimed what is not known.
            null
          ) : courses.length === 0 ||
            (productView === "communities" &&
              !courses.some((course) => course.communityEnabled)) ? (
            <div className="grid place-items-center border-y border-dashed border-[var(--color-line-strong)] px-5 py-14 text-center">
              <span className="grid size-11 place-items-center rounded-md border border-[var(--color-line)] bg-white text-[var(--color-primary)]">
                <BookOpen aria-hidden="true" size={20} strokeWidth={1.8} />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-[var(--color-ink)]">
                {productView === "communities"
                  ? t("creatorPanel.products.emptyCommunitiesTitle")
                  : t("creatorPanel.products.emptyProductsTitle")}
              </h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-[var(--color-ink-soft)]">
                {productView === "communities"
                  ? t("creatorPanel.products.emptyCommunitiesDescription")
                  : t("creatorPanel.products.emptyProductsDescription")}
              </p>
              <Link href={createHref} className="button-solid mt-5 px-4 text-sm">
                <Plus aria-hidden="true" size={16} strokeWidth={2} />
                {productView === "communities"
                  ? t("creatorPanel.products.createCommunity")
                  : t("creatorPanel.createProduct")}
              </Link>
            </div>
          ) : visibleCourses.length === 0 ? (
            <p className="border-y border-[var(--color-line)] py-10 text-center text-sm text-[var(--color-ink-soft)]">
              {t("creatorPanel.products.noMatch")}
            </p>
          ) : (
            <table
              aria-label={
                productView === "communities"
                  ? t("platform.nav.communities")
                  : t("creatorPanel.products.eyebrow")
              }
              className="w-full border-y border-[var(--color-line)]"
            >
              <thead className="hidden border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] lg:table-header-group">
                <tr>
                  <th scope="col" className="w-[42%] px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
                    {t("creatorPanel.products.columns.product")}
                  </th>
                  <th scope="col" className="w-[16%] px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
                    {t("creatorPanel.products.status")}
                  </th>
                  <th scope="col" className="w-[18%] px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
                    {t("creatorPanel.products.columns.access")}
                  </th>
                  <th scope="col" className="w-[10%] px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
                    {t("creatorPanel.hub.sections.students")}
                  </th>
                  <th scope="col" className="w-[14%] px-4 py-3">
                    <span className="sr-only">{t("creatorPanel.products.columns.actions")}</span>
                  </th>
                </tr>
              </thead>
              {/* motion-stagger: the rows rise in a staircase when the list arrives
                  (the table only mounts after the skeleton); from the 6th on,
                  together, so the whole entrance fits in 400ms. */}
              <tbody className="motion-stagger block divide-y divide-[var(--color-line)] lg:table-row-group">
                {visibleCourses.map((course, index) => (
                  <tr
                    key={course.id}
                    style={{ "--i": index } as CSSProperties}
                    className="block bg-white px-3 py-4 transition-colors hover:bg-[var(--color-surface-soft)] sm:px-4 lg:table-row lg:px-0 lg:py-0"
                  >
                    <td className="block pb-4 lg:table-cell lg:px-4 lg:py-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="relative grid aspect-video w-24 shrink-0 place-items-center overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
                          {course.coverImageUrl ? (
                            <CoverThumbnail src={course.coverImageUrl} alt="" sizes="96px" />
                          ) : (
                            <Layers3 aria-hidden="true" size={19} strokeWidth={1.7} />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--color-ink)]">
                            {course.title || t("creatorPanel.untitledProduct")}
                          </p>
                          <p className="mt-1 truncate text-xs text-[var(--color-ink-soft)]">
                            {course.category
                              ? getCourseCategoryLabel(course.category, t)
                              : t("creatorPanel.products.uncategorized")}
                          </p>
                          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                            {count(
                              "creatorPanel.modulesOne",
                              "creatorPanel.modulesMany",
                              course.modules.length,
                            )}
                            {" · "}
                            {count(
                              "publicCourses.lessonOne",
                              "publicCourses.lessonMany",
                              course.lessonCount,
                            )}
                            {course.communityEnabled ? ` · ${t("creatorPanel.communityOn")}` : ""}
                          </p>
                          <div className="mt-1">
                            <ShortId id={course.id} label={t("shortId.product")} />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="block pb-3 lg:table-cell lg:px-4 lg:py-4">
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)] lg:hidden">
                        {t("creatorPanel.products.status")}
                      </p>
                      <StatusChip status={course.status} />
                    </td>
                    <td className="block pb-3 lg:table-cell lg:px-4 lg:py-4">
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)] lg:hidden">
                        {t("creatorPanel.products.columns.access")}
                      </p>
                      <p className="text-xs font-semibold text-[var(--color-ink-soft)]">
                        {t(`creatorPanel.paymentType.${course.paymentType ?? "one_time"}`)}
                      </p>
                    </td>
                    <td className="block pb-4 lg:table-cell lg:px-4 lg:py-4">
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)] lg:hidden">
                        {t("creatorPanel.hub.sections.students")}
                      </p>
                      <p className="text-sm font-semibold tabular-nums text-[var(--color-ink)]">
                        {course.enrollmentCount ?? 0}
                      </p>
                    </td>
                    <td className="block lg:table-cell lg:px-4 lg:py-4">
                      <div className="flex items-center gap-2 lg:justify-end">
                        <Link
                          href={`/teach/courses/${encodeURIComponent(course.id)}/manage`}
                          className="button-solid px-3 text-xs"
                        >
                          {t("teach.insights.open")}
                        </Link>
                        <ProductActionsMenu
                          course={course}
                          onRequestDelete={() => setConfirmingDeleteId(course.id)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <nav
        aria-label={t("creatorPanel.products.shortcuts.label")}
        className="grid overflow-hidden rounded-md border border-[var(--color-line)] sm:grid-cols-3"
      >
        {workspaceShortcuts.map((item) => {
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className="group flex min-h-28 items-start gap-3 border-b border-[var(--color-line)] bg-white p-4 last:border-b-0 hover:bg-[var(--color-surface-soft)] sm:border-b-0 sm:border-r sm:last:border-r-0"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-md border border-[var(--color-line)] text-[var(--color-primary)]">
                <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
              </span>
              <span className="min-w-0">
                <strong className="block text-sm text-[var(--color-ink)]">{t(item.titleKey)}</strong>
                <small className="mt-1 block text-xs leading-5 text-[var(--color-ink-soft)]">
                  {t(item.detailKey)}
                </small>
                <ArrowRight
                  aria-hidden="true"
                  className="mt-2 text-[var(--color-primary)] transition-transform group-hover:translate-x-1"
                  size={14}
                  strokeWidth={1.9}
                />
              </span>
            </Link>
          );
        })}
      </nav>

      {confirmingDeleteCourse ? (
        <DeleteOrArchiveCourseDialog
          courseId={confirmingDeleteCourse.id}
          courseTitle={confirmingDeleteCourse.title || t("creatorPanel.untitledProduct")}
          onCancel={() => setConfirmingDeleteId(null)}
          // The list already listens to `courses` in real time: the deleted course leaves
          // on its own and the archived one changes chip. Only the modal needs to close.
          onDone={() => setConfirmingDeleteId(null)}
        />
      ) : null}
    </div>
  );
}
