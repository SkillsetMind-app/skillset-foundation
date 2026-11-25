"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { ExportTableButton } from "@/components/shared/export-table-button";
import { StatusChip } from "@/components/shared/status-chip";
import { TableSkeleton } from "@/components/teacher/builder-skeleton";
import { Button, EmptyState, InlineAlert } from "@/components/ui";
import { SpotArt } from "@/components/ui/spot-art";
import { getMyCourseStudents, type CourseStudent } from "@/lib/data/enrollments";
import { getMyCourseSummaries } from "@/lib/data/teacher-courses";

// The read already brings all enrollments; the screen shows 50 at a time, like Sales.
const PAGE = 50;

// The same access cuts as the per-product list (course-student-roster).
const statusFilters = ["all", "active", "completed", "refunded", "revoked", "expired"] as const;
type StatusFilter = (typeof statusFilters)[number];

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; students: CourseStudent[]; communities: Set<string> };

// All learners of all products, in a single list. Before, only the
// per-course list existed (product panel > Students); "Members & communities"
// was, in fact, a list of products. Each row leads to where the
// teacher acts: the product's learner list and its community.
export function TeacherStudentsList() {
  const { user } = useAuth();
  const { t, locale } = useTranslation();
  const [state, setState] = useState<State>({ status: "loading" });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE);
  // Index of the first row that "Show N more" opened: focus goes to it.
  // Without this, the last click took the button off the screen and focus fell on the body.
  const [revealedFrom, setRevealedFrom] = useState<number | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  // "Try again" asks for the same read again (before, the way out was reloading the
  // whole page).
  const [attempt, setAttempt] = useState(0);
  const uid = user?.uid ?? null;

  useEffect(() => {
    if (revealedFrom !== null) tbodyRef.current?.rows[revealedFrom]?.focus();
  }, [revealedFrom]);

  // A new search or filter starts over at the first 50: after opening 300, going
  // back on the filter drew all 300 at once.
  const resetWindow = () => {
    setVisibleCount(PAGE);
    setRevealedFrom(null);
  };

  useEffect(() => {
    if (!uid) {
      return;
    }

    let alive = true;
    void (async () => {
      try {
        const [students, courses] = await Promise.all([
          getMyCourseStudents(),
          getMyCourseSummaries(uid),
        ]);
        if (alive) {
          setState({
            status: "ready",
            students: [...students].sort((a, b) => Date.parse(b.enrolledAt) - Date.parse(a.enrolledAt)),
            communities: new Set(courses.filter((course) => course.communityEnabled).map((course) => course.id)),
          });
        }
      } catch {
        if (alive) setState({ status: "error" });
      }
    })();

    return () => {
      alive = false;
    };
  }, [uid, attempt]);

  if (state.status === "loading") {
    // Search + access filter + Export: the same row that comes after.
    return <TableSkeleton label={t("teach.studentsPage.loading")} controls={3} />;
  }

  if (state.status === "error") {
    return (
      <div className="grid gap-3">
        <InlineAlert tone="error">{t("teach.studentsPage.error")}</InlineAlert>
        <button
          type="button"
          onClick={() => {
            setState({ status: "loading" });
            setAttempt((current) => current + 1);
          }}
          className="button-outline justify-self-start px-4 text-sm"
        >
          {t("appErrors.retry")}
        </button>
      </div>
    );
  }

  if (state.students.length === 0) {
    return (
      <EmptyState
        art={<SpotArt scene="noStudents" />}
        title={t("teach.studentsPage.empty")}
        as="h2"
      />
    );
  }

  // Refunded, removed or expired stays in the list, with the status in
  // plain sight, but does not count as a learner: the same rule as the per-product list.
  const people = new Set(
    state.students.filter((student) => isActiveEnrollment(student.status)).map((student) => student.uid),
  ).size;
  // Search and filter only on what already came (no new query): with 300 learners,
  // finding a name meant scrolling 300 rows.
  const needle = search.trim().toLowerCase();
  const matches = state.students.filter(
    (student) =>
      (status === "all" || student.status === status) &&
      (!needle ||
        `${student.displayName} ${student.email} ${student.courseTitle}`.toLowerCase().includes(needle)),
  );
  const visible = matches.slice(0, visibleCount);
  const hiddenCount = matches.length - visible.length;
  // T-18: Export takes the whole cut of the search and the filter, not just the 50
  // open rows, with the per-product list columns (plus the product).
  const exportRows = matches.map((student) => ({
    name: student.displayName,
    email: student.email,
    product: student.courseTitle,
    access: student.status,
    progressPercent: student.progressPercent,
    enrolledAt: student.enrolledAt,
  }));

  return (
    <section className="rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-[var(--color-ink)]">
          {people === 1
            ? t("teach.studentsPage.countOne")
            : t("teach.studentsPage.countMany").replace("{count}", () => new Intl.NumberFormat(locale).format(people))}
        </p>
        <label htmlFor="students-search" className="sr-only">
          {t("teach.studentsPage.searchLabel")}
        </label>
        <input
          id="students-search"
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            resetWindow();
          }}
          placeholder={t("teach.studentsPage.searchPlaceholder")}
          className="field-input field-input--inline min-w-[12rem] flex-1 sm:max-w-72"
        />
        <label htmlFor="students-status" className="sr-only">
          {t("courseRoster.accessFilter")}
        </label>
        <select
          id="students-status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as StatusFilter);
            resetWindow();
          }}
          className="field-input field-input--inline"
        >
          {statusFilters.map((option) => (
            <option key={option} value={option}>
              {t(option === "all" ? "courseRoster.accessAll" : `courseRoster.${option}`)}
            </option>
          ))}
        </select>
        <ExportTableButton rows={exportRows} filename="students" />
      </div>
      {/* The live region always exists: inserted already with the text, many screen
          readers did not announce it. */}
      <p role="status" className={visible.length === 0 ? "mt-4 text-sm leading-6 text-[var(--color-ink-soft)]" : "sr-only"}>
        {visible.length === 0 ? t("teach.studentsPage.noMatches") : ""}
      </p>
      {visible.length === 0 ? null : (
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b fine-rule">
              {[t("courseRoster.studentHead"), t("teach.studentsPage.product"), t("courseRoster.access"), t("courseRoster.progress"), t("courseRoster.joined")].map((head, index) => (
                <th key={head} className={`py-2 pr-4 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]${index === 3 ? " text-right" : ""}`}>
                  {head}
                </th>
              ))}
              <th className="py-2 pr-4">
                <span className="sr-only">{t("courseRoster.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody ref={tbodyRef}>
            {visible.map((student, index) => {
              const name = student.displayName || t("courseRoster.unnamed");
              const course = encodeURIComponent(student.courseId);
              return (
                <tr
                  key={student.enrollmentId}
                  tabIndex={index === revealedFrom ? -1 : undefined}
                  className="border-b fine-rule last:border-b-0"
                >
                  <td className="py-3 pr-4">
                    {/* The name opens the learner in the product's list. Before there were one or
                        two identical 44px buttons on every row: a wall in the
                        last column. */}
                    <Link
                      href={`/teach/courses/${course}/manage?section=students`}
                      className="block font-semibold text-[var(--color-primary)] underline decoration-[var(--color-line-strong)] underline-offset-4 hover:decoration-current pointer-coarse:relative pointer-coarse:-my-3 pointer-coarse:py-3"
                    >
                      {name}
                      <span className="sr-only">: {t("teach.studentsPage.seeInProduct")}, {student.courseTitle}</span>
                    </Link>
                    {student.email ? (
                      <span className="text-xs text-[var(--color-ink-soft)]">{student.email}</span>
                    ) : null}
                  </td>
                  <td className="py-3 pr-4 text-[var(--color-ink)]">{student.courseTitle}</td>
                  <td className="py-3 pr-4">
                    <StatusChip status={student.status} />
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-[var(--color-ink)]">{student.progressPercent}%</td>
                  <td className="py-3 pr-4 text-xs text-[var(--color-ink-soft)]">{formatDate(student.enrolledAt, locale)}</td>
                  <td className="py-3 pr-4">
                    {state.communities.has(student.courseId) ? (
                      <Link
                        href={`/teach/courses/${course}/community`}
                        className="inline-flex min-h-11 items-center text-xs font-semibold text-[var(--color-primary)] underline underline-offset-4"
                      >
                        {t("teach.studentsPage.community")}
                        <span className="sr-only">: {student.courseTitle}</span>
                      </Link>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
      {hiddenCount > 0 ? (
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => {
            setRevealedFrom(visible.length);
            setVisibleCount((count) => count + PAGE);
          }}
        >
          {t("teach.studentsPage.showMore").replace("{count}", () => String(Math.min(hiddenCount, PAGE)))}
        </Button>
      ) : null}
    </section>
  );
}

function isActiveEnrollment(status: CourseStudent["status"]): boolean {
  return status === "active" || status === "completed";
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" })
    : "--";
}
