"use client";

import { useEffect, useState } from "react";

import { StatusChip } from "@/components/shared/status-chip";
import { PanelCard } from "@/components/teacher/course-commerce-panels";
import { getMyCourseStudents, type CourseStudent } from "@/lib/data/enrollments";

// Who bought this course. Hotmart calls this tab "Alunos"; before this the hub
// had 11 tabs and none of them answered "who is in my course" -- the sales tab
// only carries an order id, never a name or an e-mail.
//
// Data comes from the `get_my_course_students` RPC, not a table read: RLS on
// `enrollments` only lets the STUDENT read their own row, so a teacher SELECT
// returns zero rows with no error. See the migration for the full reasoning.

const sourceLabels: Record<string, string> = {
  payment: "One-time purchase",
  subscription: "Subscription",
  free_course: "Free enrollment",
  admin: "Granted by support",
  manual_demo: "Demo",
};

function formatDate(value: string): string {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "--"
    : date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function CourseStudentRosterView({
  state,
  students,
}: {
  state: "loading" | "ready" | "error";
  students: CourseStudent[];
}) {
  if (state === "loading") {
    return (
      <PanelCard title="Students" description="Everyone enrolled in this course.">
        <p className="mt-5 text-sm text-[var(--color-ink-soft)]">Loading students...</p>
      </PanelCard>
    );
  }

  if (state === "error") {
    return (
      <PanelCard title="Students" description="Everyone enrolled in this course.">
        <p className="mt-5 text-sm text-[var(--color-ink-soft)]">
          We could not load the roster. Reload the page — if it keeps failing, contact support.
        </p>
      </PanelCard>
    );
  }

  if (students.length === 0) {
    return (
      <PanelCard
        title="Students"
        description="Everyone enrolled in this course."
      >
        <p className="mt-5 text-sm leading-6 text-[var(--color-ink-soft)]">
          No one is enrolled yet. Buyers show up here the moment a purchase clears, with their
          name, e-mail, and progress — so you can support them without leaving the studio.
        </p>
      </PanelCard>
    );
  }

  const active = students.filter((s) => s.status === "active" || s.status === "completed").length;

  return (
    <PanelCard
      title="Students"
      description={`${students.length} enrolled · ${active} with active access`}
    >
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b fine-rule">
              {["Student", "Access", "Progress", "How", "Enrolled"].map((head) => (
                <th
                  key={head}
                  className="py-2 pr-4 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]"
                >
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((student) => (
              <tr key={student.enrollmentId} className="border-b fine-rule last:border-b-0">
                <td className="py-3 pr-4">
                  <strong className="block font-medium text-[var(--color-ink)]">
                    {student.displayName || "Unnamed student"}
                  </strong>
                  {student.email ? (
                    <a
                      href={`mailto:${student.email}`}
                      className="text-xs text-[var(--color-ink-soft)] underline"
                    >
                      {student.email}
                    </a>
                  ) : null}
                </td>
                <td className="py-3 pr-4">
                  <StatusChip status={student.status} />
                </td>
                <td className="py-3 pr-4 tabular-nums text-[var(--color-ink)]">
                  {student.progressPercent}%
                </td>
                <td className="py-3 pr-4 text-xs text-[var(--color-ink-soft)]">
                  {sourceLabels[student.source] ?? student.source}
                </td>
                <td className="py-3 pr-4 text-xs text-[var(--color-ink-soft)]">
                  {formatDate(student.enrolledAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelCard>
  );
}

export function CourseStudentRoster({ courseId }: { courseId: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [students, setStudents] = useState<CourseStudent[]>([]);

  useEffect(() => {
    let current = true;
    // ponytail: the RPC returns every course the teacher owns and this filters
    // client-side. One round trip serves any course tab; add `p_course_id` when
    // a single teacher's total roster gets big enough to notice.
    void getMyCourseStudents()
      .then((rows) => {
        if (!current) return;
        setStudents(rows.filter((row) => row.courseId === courseId));
        setState("ready");
      })
      .catch(() => {
        if (!current) return;
        setState("error");
      });
    return () => {
      current = false;
    };
  }, [courseId]);

  return <CourseStudentRosterView state={state} students={students} />;
}
