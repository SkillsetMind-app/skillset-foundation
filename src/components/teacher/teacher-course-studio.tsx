"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Handshake,
  Layers3,
  Megaphone,
  MoreHorizontal,
  Plus,
  UsersRound,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { ListingSearchBar } from "@/components/shared/listing-search-bar";
import { StatusChip } from "@/components/shared/status-chip";
import {
  CourseActionsMenu,
  DeleteOrArchiveCourseDialog,
} from "@/components/teacher/course-actions";
import { CreateCourseStart } from "@/components/teacher/create-course-start";
import type { TeacherCourse, TeacherCourseProductFormat } from "@/domain/teacher-course";
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
  // O modal de arquivar promete "voce pode restaurar depois em Archived". Sem
  // esta entrada a promessa nao tinha onde ser cumprida: 'inactive' so aparecia
  // dentro de "Needs attention", que e outra coisa.
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
  {
    titleKey: "platform.nav.coupons",
    detailKey: "creatorPanel.products.shortcuts.couponsDetail",
    href: "/teach/coupons",
    icon: Handshake,
  },
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
    "flex min-h-11 items-center rounded-[6px] px-3 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]";

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
      {/* Sem porteiro de status: a mesma acao do hub, e o servidor decide se o
          curso some ou vai para o arquivo. Antes o item sumia para tudo que
          nao fosse rascunho, e o professor ficava sem saida. */}
      <button
        type="button"
        role="menuitem"
        onClick={onRequestDelete}
        className="flex min-h-11 w-full items-center rounded-[6px] border-t border-[var(--color-line)] px-3 text-left text-sm font-semibold text-[var(--color-danger-fg)] hover:bg-[var(--color-danger-soft)]"
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
  const [courseQuery, setCourseQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProductFilter>("all");
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  // Kept as a dictionary key so the message follows a locale switch.
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
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

    return subscribeToTeacherCourses(
      user.uid,
      (nextCourses) => {
        setCourses(nextCourses);
        setIsLoadingCourses(false);
      },
      () => {
        setErrorKey("creatorPanel.products.loadError");
        setIsLoadingCourses(false);
      },
    );
  }, [user]);

  if (autoOpenCreate) {
    return user ? (
      <CreateCourseStart ownerId={user.uid} initialFormat={initialFormat} />
    ) : (
      <p className="rounded-[8px] border border-[var(--color-line)] bg-white p-4 text-sm text-[var(--color-ink-soft)]">
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

      {errorKey ? (
        <p
          role="alert"
          className="rounded-[8px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]"
        >
          {t(errorKey)}
        </p>
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
              className="min-h-11 rounded-[7px] border border-[var(--color-line-strong)] bg-white px-3 text-sm font-semibold normal-case tracking-normal text-[var(--color-ink)] outline-none focus:border-[var(--color-primary-light)] focus:ring-2 focus:ring-[rgba(66,102,145,0.18)]"
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
              className="min-h-11 rounded-[7px] border border-[var(--color-line-strong)] bg-white px-3 text-sm font-semibold normal-case tracking-normal text-[var(--color-ink)] outline-none focus:border-[var(--color-primary-light)] focus:ring-2 focus:ring-[rgba(66,102,145,0.18)]"
            >
              {productFilters.map((filter) => (
                <option key={filter.id} value={filter.id}>
                  {t(filter.labelKey)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5">
          {isLoadingCourses ? (
            <div className="grid gap-0" aria-label={t("creatorPanel.products.loadingAria")}>
              {[1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="h-24 animate-pulse border-b border-[var(--color-line)] bg-[var(--color-surface-soft)]"
                />
              ))}
            </div>
          ) : courses.length === 0 ||
            (productView === "communities" &&
              !courses.some((course) => course.communityEnabled)) ? (
            <div className="grid place-items-center border-y border-dashed border-[var(--color-line-strong)] px-5 py-14 text-center">
              <span className="grid size-11 place-items-center rounded-[8px] border border-[var(--color-line)] bg-white text-[var(--color-primary)]">
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
              <tbody className="block divide-y divide-[var(--color-line)] lg:table-row-group">
                {visibleCourses.map((course) => (
                  <tr
                    key={course.id}
                    className="block bg-white px-3 py-4 transition-colors hover:bg-[var(--color-surface-soft)] sm:px-4 lg:table-row lg:px-0 lg:py-0"
                  >
                    <td className="block pb-4 lg:table-cell lg:px-4 lg:py-4">
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
        className="grid overflow-hidden rounded-[8px] border border-[var(--color-line)] sm:grid-cols-2 xl:grid-cols-4"
      >
        {workspaceShortcuts.map((item) => {
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className="group flex min-h-28 items-start gap-3 border-b border-[var(--color-line)] bg-white p-4 last:border-b-0 hover:bg-[var(--color-surface-soft)] sm:[&:nth-last-child(-n+2)]:border-b-0 xl:border-b-0 xl:border-r xl:last:border-r-0"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-[7px] border border-[var(--color-line)] text-[var(--color-primary)]">
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
          // A lista ja escuta `courses` em tempo real: o curso apagado sai
          // sozinho e o arquivado troca de chip. So o modal precisa fechar.
          onDone={() => setConfirmingDeleteId(null)}
        />
      ) : null}
    </div>
  );
}
