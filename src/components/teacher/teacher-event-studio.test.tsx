import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TeacherEventStudio } from "@/components/teacher/teacher-event-studio";

const authState = vi.hoisted(() => ({
  user: { uid: "teacher-1", roles: ["teacher"] },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("courseId=event-product-1&newEvent=1"),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => authState,
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourses: (
    _ownerId: string,
    onData: (courses: Array<Record<string, unknown>>) => void
  ) => {
    onData([
      {
        id: "course-1",
        ownerId: "teacher-1",
        title: "Existing course",
        summary: "Existing course summary",
        category: "Mental Health Foundations",
        status: "draft",
        modules: [],
        lessonCount: 0,
      },
      {
        id: "event-product-1",
        ownerId: "teacher-1",
        title: "Live supervision intensive",
        summary: "A paid live cohort",
        category: "Supervision & Continuing Education",
        status: "draft",
        modules: [],
        lessonCount: 0,
      },
    ]);
    return vi.fn();
  },
}));

vi.mock("@/lib/data/course-events", () => ({
  cancelCourseEvent: vi.fn(),
  createCourseEvent: vi.fn(),
  deleteCourseEvent: vi.fn(),
  subscribeToCourseEventRsvps: vi.fn(() => vi.fn()),
  subscribeToTeacherCourseEvents: (_ownerId: string, onData: (events: unknown[]) => void) => {
    onData([]);
    return vi.fn();
  },
  updateCourseEvent: vi.fn(),
}));

describe("TeacherEventStudio", () => {
  it("preselects the product created by the event workflow", async () => {
    render(<TeacherEventStudio />);

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Course" })).toHaveValue("event-product-1");
    });
  });
});
