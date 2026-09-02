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
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ListingSearchBar } from "@/components/shared/listing-search-bar";
import { StatusChip } from "@/components/shared/status-chip";
import { CreateCourseStart } from "@/components/teacher/create-course-start";
import type { TeacherCourse, TeacherCourseProductFormat } from "@/domain/teacher-course";
import { teacherCanDeleteCourse } from "@/domain/teacher-course";
import { useModalFocus } from "@/lib/a11y/use-modal-focus";
import { deleteTeacherCourse, subscribeToTeacherCourses } from "@/lib/data/teacher-courses";

type ProductFilter = "all" | "draft" | "in_review" | "published" | "attention";

const productFilters: Array<{ id: ProductFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "draft", label: "Drafts" },
  { id: "in_review", label: "Legacy review" },
  { id: "published", label: "Live" },
  { id: "attention", label: "Needs attention" },
];

const workspaceShortcuts = [
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
] as const;

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

function ProductActionsMenu({
  course,
  onRequestDelete,
}: {
  course: TeacherCourse;
  onRequestDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const courseTitle = course.title || "Untitled product";

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${courseTitle}`}
        onClick={() => setOpen((current) => !current)}
        className="grid min-h-11 min-w-11 place-items-center rounded-[7px] border border-[var(--color-line-strong)] bg-white text-[var(--color-primary)] transition-colors hover:bg-[var(--color-surface-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
      >
        <MoreHorizontal aria-hidden="true" size={19} strokeWidth={2} />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={`Actions for ${courseTitle}`}
          className="absolute right-0 top-[calc(100%+8px)] z-40 w-48 rounded-[8px] border border-[var(--color-line)] bg-white p-1.5 shadow-[var(--shadow-strong)]"
        >
          <Link
            href={`/teach/builder?courseId=${encodeURIComponent(course.id)}`}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center rounded-[6px] px-3 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
          >
            Edit
          </Link>
          <Link
            href={`/teach/builder/${encodeURIComponent(course.id)}/preview`}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center rounded-[6px] px-3 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
          >
            View as student
          </Link>
          {teacherCanDeleteCourse(course.status) ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
                onRequestDelete();
              }}
              className="flex min-h-11 w-full items-center rounded-[6px] border-t border-[var(--color-line)] px-3 text-left text-sm font-semibold text-[var(--color-danger-fg)] hover:bg-[var(--color-danger-soft)]"
            >
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DeleteCourseDialog({
  course,
  busy,
  onCancel,
  onConfirm,
}: {
  course: TeacherCourse;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const courseTitle = course.title || "Untitled product";
  useModalFocus(dialogRef, true);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        onCancel();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-[rgba(7,9,13,0.55)] p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onCancel();
        }
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Delete ${courseTitle}`}
        className="modal-panel modal-panel-scroll w-full max-w-md rounded-[16px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-strong)] outline-none"
      >
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-danger-fg)]">
          Delete product
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-[var(--color-primary)]">
          Delete {courseTitle}?
        </h2>
        <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
          This permanently removes the draft and its course content. This action cannot be undone.
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="button-outline px-4 text-sm disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="button-danger px-4 text-sm disabled:opacity-60"
          >
            {busy ? "Deleting..." : "Confirm delete"}
          </button>
        </div>
      </div>
    </div>
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
          "We could not load your products. Please refresh or contact SkillsetMind support.",
        );
        setIsLoadingCourses(false);
      },
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
  const confirmingDeleteCourse =
    courses.find((course) => course.id === confirmingDeleteId) ?? null;

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
        <Link href={createHref} className="button-solid px-4 text-sm">
          <Plus aria-hidden="true" size={16} strokeWidth={2} />
          New product
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

      <section aria-labelledby="product-list-title">
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

        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(220px,1fr)_minmax(150px,auto)_minmax(170px,auto)] md:items-end">
          <ListingSearchBar
            value={courseQuery}
            onChange={setCourseQuery}
            placeholder={productView === "communities" ? "Search communities..." : "Search products..."}
            className="max-w-none"
          />
          <label className="grid gap-1 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
            Type
            <select
              aria-label="Product type"
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
              <option value="products">Products</option>
              <option value="communities">Communities</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
            Status
            <select
              aria-label="Product status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as ProductFilter)}
              className="min-h-11 rounded-[7px] border border-[var(--color-line-strong)] bg-white px-3 text-sm font-semibold normal-case tracking-normal text-[var(--color-ink)] outline-none focus:border-[var(--color-primary-light)] focus:ring-2 focus:ring-[rgba(66,102,145,0.18)]"
            >
              {productFilters.map((filter) => (
                <option key={filter.id} value={filter.id}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5">
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
              <Link href={createHref} className="button-solid mt-5 px-4 text-sm">
                <Plus aria-hidden="true" size={16} strokeWidth={2} />
                {productView === "communities" ? "Create community" : "Create product"}
              </Link>
            </div>
          ) : visibleCourses.length === 0 ? (
            <p className="border-y border-[var(--color-line)] py-10 text-center text-sm text-[var(--color-ink-soft)]">
              No products match this search and status filter.
            </p>
          ) : (
            <table
              aria-label={productView === "communities" ? "Communities" : "Products"}
              className="w-full border-y border-[var(--color-line)]"
            >
              <thead className="hidden border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] lg:table-header-group">
                <tr>
                  <th scope="col" className="w-[42%] px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
                    Product
                  </th>
                  <th scope="col" className="w-[16%] px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
                    Status
                  </th>
                  <th scope="col" className="w-[18%] px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
                    Access
                  </th>
                  <th scope="col" className="w-[10%] px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
                    Students
                  </th>
                  <th scope="col" className="w-[14%] px-4 py-3">
                    <span className="sr-only">Actions</span>
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
                    </td>
                    <td className="block pb-3 lg:table-cell lg:px-4 lg:py-4">
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)] lg:hidden">
                        Status
                      </p>
                      <StatusChip status={course.status} />
                    </td>
                    <td className="block pb-3 lg:table-cell lg:px-4 lg:py-4">
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)] lg:hidden">
                        Access
                      </p>
                      <p className="text-xs font-semibold text-[var(--color-ink-soft)]">
                        {accessModelLabel(course)}
                      </p>
                    </td>
                    <td className="block pb-4 lg:table-cell lg:px-4 lg:py-4">
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)] lg:hidden">
                        Students
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
                          Open
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
        aria-label="Product workspace shortcuts"
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

      {confirmingDeleteCourse ? (
        <DeleteCourseDialog
          course={confirmingDeleteCourse}
          busy={deletingCourseId === confirmingDeleteCourse.id}
          onCancel={() => setConfirmingDeleteId(null)}
          onConfirm={() => void handleDeleteCourse(confirmingDeleteCourse.id)}
        />
      ) : null}
    </div>
  );
}
