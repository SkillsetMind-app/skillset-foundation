import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FeaturedCourses } from "@/components/site/featured-courses";

const mocks = vi.hoisted(() => ({
  getSupabaseClientConfig: vi.fn(),
  subscribeToPublishedTeacherCourses: vi.fn(() => () => {}),
}));

vi.mock("@/lib/supabase/config", () => ({
  getSupabaseClientConfig: mocks.getSupabaseClientConfig,
}));

vi.mock("@/lib/data/published-courses", () => ({
  isInternalSmokeCourse: () => false,
  subscribeToPublishedTeacherCourses: mocks.subscribeToPublishedTeacherCourses,
  teacherCourseToCourseCard: (course: unknown) => course,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FeaturedCourses", () => {
  it("keeps the marketplace band and states what it offers when the catalog is empty", () => {
    // No Supabase config on the client is the same end state as an empty or
    // failed catalog stream: zero courses. The band used to return null here,
    // which left the homepage #courses anchor pointing at nothing at all.
    mocks.getSupabaseClientConfig.mockReturnValue(null);

    render(<FeaturedCourses />);

    expect(
      screen.getByRole("heading", {
        name: /courses by verified experts/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/verified by SkillsetMind/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /browse all courses/i }),
    ).toBeInTheDocument();
  });

  it("invites teachers in one strip instead of four cards posing as courses", () => {
    mocks.getSupabaseClientConfig.mockReturnValue(null);

    render(<FeaturedCourses />);

    expect(
      screen.getByText(
        "Marketplace opens soon — be one of the first teachers.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "See how publishing works" }),
    ).toHaveAttribute("href", "/for-creators");
    expect(
      screen.queryByText(/Professional programs across coaching/),
    ).not.toBeInTheDocument();
  });
});
