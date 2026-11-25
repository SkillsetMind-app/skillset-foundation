import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LearningPathsRows } from "@/components/learn/learning-paths-rows";
import type { Enrollment } from "@/domain/enrollment";
import type { LearningPath } from "@/domain/learning-path";
import type { TeacherCourse } from "@/domain/teacher-course";

/**
 * The dashboard rows used to download the entire public catalog (200 courses with
 * the curriculum, and again on every change to any course) just to find out the
 * teacher of each enrollment. Now they receive the person's courses from the dashboard
 * and ask the database only for what they offer: the learning path steps and the rest of each
 * teacher the person already knows.
 */

const { fixtures } = vi.hoisted(() => {
  const course = (id: string, title: string): TeacherCourse => ({
    id,
    ownerId: "teacher-1",
    title,
    summary: "",
    category: "Coaching",
    status: "published",
    modules: [],
    lessonCount: 3,
  });

  return {
    fixtures: {
      course,
      paths: [] as LearningPath[],
      offered: [] as TeacherCourse[],
      rowCalls: [] as [string[], string[]][],
    },
  };
});

vi.mock("@/lib/data/learning-paths", () => ({
  fetchPublishedLearningPaths: async () => fixtures.paths,
}));

vi.mock("@/lib/data/published-courses", () => ({
  fetchPublishedCoursesForRows: async (ids: string[], ownerIds: string[]) => {
    fixtures.rowCalls.push([ids, ownerIds]);
    return fixtures.offered;
  },
}));

vi.mock("@/lib/data/user-profiles", () => ({
  getPublicProfilesByIds: async () => [{ uid: "teacher-1", displayName: "Ana Lima" }],
}));

const enrollment: Enrollment = {
  id: "student-1__own-course",
  userId: "student-1",
  courseId: "own-course",
  courseSlug: "own-course",
  courseTitle: "Own Course",
  courseCategory: "Coaching",
  courseImage: "",
  status: "active",
  source: "payment",
  progressPercent: 40,
  lastLessonId: null,
};

describe("LearningPathsRows", () => {
  beforeEach(() => {
    fixtures.paths = [];
    fixtures.offered = [];
    fixtures.rowCalls = [];
  });

  it("offers the rest of the teacher's courses based on the courses the dashboard already has", async () => {
    // The purchased course may not even be published: the owner is still derived from it.
    const own = { ...fixtures.course("own-course", "Own Course"), status: "inactive" as const };
    fixtures.offered = [fixtures.course("second-course", "Second Course")];

    render(<LearningPathsRows enrollments={[enrollment]} enrolledCourses={[own]} />);

    const heading = await screen.findByRole("heading", { name: "More from Ana Lima" });
    const row = heading.closest("section") as HTMLElement;
    expect(within(row).getByText("Second Course")).toBeInTheDocument();
    expect(within(row).queryByText("Own Course")).not.toBeInTheDocument();
    expect(fixtures.rowCalls.at(-1)).toEqual([[], ["teacher-1"]]);
  });

  it("a learning path shows the already purchased step and the published step, asking only for the path's ids", async () => {
    fixtures.paths = [
      { id: "path-1", title: "Coach path", description: "", courseIds: ["own-course", "path-course"] },
    ];
    fixtures.offered = [fixtures.course("path-course", "Path Course")];

    render(
      <LearningPathsRows
        enrollments={[enrollment]}
        enrolledCourses={[fixtures.course("own-course", "Own Course")]}
      />,
    );

    const heading = await screen.findByRole("heading", { name: "Coach path" });
    const path = heading.closest("section") as HTMLElement;
    expect(await within(path).findByText("Path Course")).toBeInTheDocument();
    expect(within(path).getByRole("link", { name: "Continue" })).toHaveAttribute(
      "href",
      "/learn/courses/own-course",
    );
    expect(fixtures.rowCalls.at(-1)).toEqual([["own-course", "path-course"], ["teacher-1"]]);

    // Progress is read only once: the bar carries the whole sentence and the visible
    // line with the same text is silent for the screen reader.
    const bar = within(path).getByRole("progressbar");
    const label = bar.getAttribute("aria-label")!;
    expect(label).toMatch(/^\d+\/2 completed · \d+%$/);
    expect(within(path).getByText(label)).toHaveAttribute("aria-hidden", "true");
  });
});
