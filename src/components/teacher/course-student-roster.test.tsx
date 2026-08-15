import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CourseStudentRosterView } from "@/components/teacher/course-student-roster";
import type { CourseStudent } from "@/lib/data/enrollments";

const student = {
  enrollmentId: "learner-1__course-1",
  courseId: "course-1",
  courseTitle: "Clinical Focus",
  uid: "learner-1",
  displayName: "Maria Silva",
  email: "maria@example.com",
  photoUrl: "",
  status: "active",
  source: "payment",
  progressPercent: 42,
  enrolledAt: "2026-07-15T10:00:00.000Z",
} as CourseStudent;

const refunded = {
  ...student,
  enrollmentId: "learner-2__course-1",
  uid: "learner-2",
  displayName: "Joao Costa",
  email: "joao@example.com",
  status: "refunded",
  source: "admin",
  progressPercent: 0,
} as CourseStudent;

describe("CourseStudentRosterView", () => {
  it("lists the student with the identity a plain enrollments read cannot return", () => {
    render(<CourseStudentRosterView state="ready" students={[student]} />);

    expect(screen.getByText("Maria Silva")).toBeInTheDocument();
    expect(screen.getByText("maria@example.com")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText("One-time purchase")).toBeInTheDocument();
  });

  it("keeps refunded students visible — support needs them, entitlement does not", () => {
    render(<CourseStudentRosterView state="ready" students={[student, refunded]} />);

    expect(screen.getByText("Joao Costa")).toBeInTheDocument();
    expect(screen.getByText("Granted by support")).toBeInTheDocument();
    // 2 enrolled, but only the active one still has access.
    expect(screen.getByText(/2 enrolled/)).toBeInTheDocument();
    expect(screen.getByText(/1 with active access/)).toBeInTheDocument();
  });

  it("says nobody is enrolled instead of inventing a placeholder row", () => {
    render(<CourseStudentRosterView state="ready" students={[]} />);

    expect(screen.getByText(/No one is enrolled yet/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("reports a failed read rather than rendering an empty roster", () => {
    render(<CourseStudentRosterView state="error" students={[]} />);

    expect(screen.getByText(/could not load the roster/)).toBeInTheDocument();
    expect(screen.queryByText(/No one is enrolled yet/)).not.toBeInTheDocument();
  });
});
