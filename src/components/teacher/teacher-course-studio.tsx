"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Handshake,
  Layers3,
  Megaphone,
  Plus,
  UsersRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/components/auth/auth-provider";
import { ListingSearchBar } from "@/components/shared/listing-search-bar";
import { StatusChip } from "@/components/shared/status-chip";
import { CreateCourseStart } from "@/components/teacher/create-course-start";
import type { TeacherCourse, TeacherCourseProductFormat } from "@/domain/teacher-course";
import { teacherCanDeleteCourse, teacherCanPublishCourse } from "@/domain/teacher-course";
import { deleteTeacherCourse, subscribeToTeacherCourses } from "@/lib/data/teacher-courses";

type ProductFilter = "all" | "draft" | "in_review" | "published" | "attention";

const productFilters: Array<{ id: ProductFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "draft", label: "Drafts" },
  { id: "in_review", label: "Legacy review" },
  { id: "published", label: "Live" },
  { id: "attention", label: "Needs attention" },
];

function filterMatches(course: TeacherCourse, filter: ProductFilter) {
  if (filter === "all") return true;
  if (filter === "attention") {
    return course.status === "needs_changes" || course.status === "inactive";
  }
  return course.status === filter;
}

function accessModelLabel(course: TeacherCourse) {
  if (course.paymentType === "free") return "Free";
  if (course.paymentType === "subscription_monthly") return "Monthly subscription";
  if (course.paymentType === "subscription_yearly") return "Yearly subscription";
  return "One-time purchase";
}

export function TeacherCourseStudio({
  autoOpenCreate = false,
  initialFormat = "course",
}: {
  autoOpenCreate?: boolean;
  initialFormat?: TeacherCourseProductFormat;
}) {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const productView = searchParams.get("view") === "communities" ? "communities" : "products";
  const [courseQuery, setCourseQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProductFilter>("all");
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [error, setError] = useState("");
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);
  const [deletingCourseId, setDeletingCourseId] = useState<string | null>(null);
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
        setError(
          "We could not load your products. Please refresh or contact SkillsetMind support."
        );
        setIsLoadingCourses(false);
      }
    );
  }, [user]);

  async function handleDeleteCourse(courseId: string) {
    setError("");
    setDeletingCourseId(courseId);

    try {
      await deleteTeacherCourse(courseId);
    } catch {
      setError("We could not delete this draft. Please try again or contact SkillsetMind support.");
    } finally {
      setDeletingCourseId(null);
      setConfirmingDeleteId(null);
    }
  }

  if (autoOpenCreate) {
    return user ? (
      <CreateCourseStart ownerId={user.uid} initialFormat={initialFormat} />
    ) : (
      <p className="rounded-[8px] border border-[var(--color-line)] bg-white p-4 text-sm text-[var(--color-ink-soft)]">
        Sign in as a creator to start a product.
      </p>
    );
  }

  const createHref =
    productView === "communities"
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
            My products
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            Create private drafts, complete the product checks, and publish directly once your
            professional verification is approved.
          </p>
        </div>
        <Link href={createHref} className="button-solid min-h-10 px-4 text-sm">
          <Plus aria-hidden="true" size={16} strokeWidth={2} />
          {productView === "communities" ? "New community" : "New product"}
        </Link>
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-[8px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]"
        >
          {error}
        </p>
      ) : null}

      <nav
        aria-label="Product workspace shortcuts"
        className="grid overflow-hidden rounded-[8px] border border-[var(--color-line)] sm:grid-cols-2 xl:grid-cols-4"
      >
        {[
          {
            title: "Members & communities",
            detail: "Customize delivery and learner spaces",
            href: "/teach/members",
            icon: UsersRound,
          },
          {
            title: "Online events",
            detail: "Schedule workshops and live sessions",
            href: "/teach/events",
            icon: CalendarDays,
          },
          {
            title: "Marketing workspace",
            detail: "Pages, media, messages, and promotions",
            href: "/teach/marketing",
            icon: Megaphone,
          },
          {
            title: "Coupons",
            detail: "Create discount codes for your products",
            href: "/teach/coupons",
            icon: Handshake,
          },
        ].map((item) => {
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
                <strong className="block text-sm text-[var(--color-ink)]">{item.title}</strong>
                <small className="mt-1 block text-xs leading-5 text-[var(--color-ink-soft)]">
                  {item.detail}
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

      <section aria-labelledby="product-list-title">
        <div
          className="mb-5 inline-grid grid-cols-2 rounded-[7px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-1"
          role="radiogroup"
          aria-label="Product content type"
        >
          {(["products", "communities"] as const).map((view) => (
            <button
              key={view}
              type="button"
              role="radio"
              aria-checked={productView === view}
              onClick={() =>
                router.push(
                  view === "communities" ? "/teach/builder?view=communities" : "/teach/builder"
                )
              }
              className={`min-h-9 rounded-[5px] px-4 text-sm font-semibold transition-colors ${
                productView === view
                  ? "bg-[var(--color-primary)] text-white"
                  : "text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
              }`}
            >
              {view === "products" ? "Products" : "Communities"}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="product-list-title" className="text-lg font-semibold text-[var(--color-ink)]">
              {productView === "communities" ? "Community workspace" : "Product workspace"}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
              {isLoadingCourses
                ? "Loading products..."
                : productView === "communities"
                  ? `${courses.filter((course) => course.communityEnabled).length} ${
                      courses.filter((course) => course.communityEnabled).length === 1
                        ? "community"
                        : "communities"
                    }`
                  : `${courses.length} ${courses.length === 1 ? "product" : "products"}`}
            </p>
          </div>
          {courses.length > 0 ? (
            <ListingSearchBar
              value={courseQuery}
              onChange={setCourseQuery}
              placeholder={
                productView === "communities" ? "Search communities..." : "Search products..."
              }
            />
          ) : null}
        </div>

        {courses.length > 0 ? (
          <div
            className="mt-4 flex gap-1 overflow-x-auto border-b border-[var(--color-line)]"
            aria-label="Product status filters"
          >
            {productFilters.map((filter) => {
              const count = courses.filter((course) => filterMatches(course, filter.id)).length;

              return (
                <button
                  key={filter.id}
                  type="button"
                  aria-pressed={statusFilter === filter.id}
                  onClick={() => setStatusFilter(filter.id)}
                  className={`min-h-10 shrink-0 border-b-2 px-3 text-sm font-semibold transition-colors ${
                    statusFilter === filter.id
                      ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                      : "border-transparent text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  {filter.label}
                  <span className="ml-1.5 text-xs tabular-nums text-[var(--color-ink-muted)]">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="mt-2">
          {isLoadingCourses ? (
            <div className="grid gap-0" aria-label="Loading products">
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
                {productView === "communities" ? "No communities yet" : "No products yet"}
              </h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-[var(--color-ink-soft)]">
                {productView === "communities"
                  ? "Create a recurring members space for posts, discussion, and practitioner-led exchange."
                  : "Start a course, subscription, community, event, or free program. The draft stays private until you publish it."}
              </p>
              <Link href={createHref} className="button-solid mt-5 min-h-10 px-4 text-sm">
                <Plus aria-hidden="true" size={16} strokeWidth={2} />
                {productView === "communities" ? "Create community" : "Create product"}
              </Link>
            </div>
          ) : visibleCourses.length === 0 ? (
            <p className="border-y border-[var(--color-line)] py-10 text-center text-sm text-[var(--color-ink-soft)]">
              No products match this search and status filter.
            </p>
          ) : (
            <div className="divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
              {visibleCourses.map((course) => (
                <article
                  key={course.id}
                  className="grid gap-4 bg-white px-3 py-4 transition-colors hover:bg-[var(--color-surface-soft)] sm:px-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(150px,0.55fr)_minmax(140px,0.5fr)_auto] lg:items-center"
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
                        <Layers3 aria-hidden="true" size={19} strokeWidth={1.7} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--color-ink)]">
                        {course.title || "Untitled product"}
                      </p>
                      <p className="mt-1 truncate text-xs text-[var(--color-ink-soft)]">
                        {course.category || "Uncategorized"}
                      </p>
                      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                        {course.modules.length} modules · {course.lessonCount} lessons
                        {course.communityEnabled ? " · Community on" : ""}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)] lg:hidden">
                      Status
                    </p>
                    <StatusChip status={course.status} />
                  </div>

                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)] lg:hidden">
                      Access model
                    </p>
                    <p className="text-xs font-semibold text-[var(--color-ink-soft)]">
                      {accessModelLabel(course)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <Link
                      href={`/teach/courses/${encodeURIComponent(course.id)}/manage`}
                      className="button-solid min-h-9 px-3 text-xs"
                    >
                      Manage
                    </Link>
                    <Link
                      href={`/teach/builder?courseId=${encodeURIComponent(course.id)}`}
                      className="button-outline min-h-9 px-3 text-xs"
                    >
                      Edit
                    </Link>
                    {teacherCanPublishCourse(course.status) ? (
                      <Link
                        href={`/teach/builder?courseId=${encodeURIComponent(course.id)}&tab=review`}
                        className="button-outline min-h-9 px-3 text-xs"
                      >
                        Review & publish
                      </Link>
                    ) : null}
                    {teacherCanDeleteCourse(course.status) ? (
                      confirmingDeleteId === course.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleDeleteCourse(course.id)}
                            disabled={deletingCourseId === course.id}
                            className="button-accent min-h-9 px-3 text-xs disabled:opacity-60"
                          >
                            {deletingCourseId === course.id ? "Deleting..." : "Confirm delete"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingDeleteId(null)}
                            disabled={deletingCourseId === course.id}
                            className="button-outline min-h-9 px-3 text-xs disabled:opacity-60"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(course.id)}
                          className="min-h-9 px-2 text-xs font-semibold text-[var(--color-accent-fg)] underline-offset-4 hover:underline"
                        >
                          Delete
                        </button>
                      )
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
