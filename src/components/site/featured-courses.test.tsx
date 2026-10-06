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
  it("keeps the band heading while the live catalog is still loading", () => {
    // The homepage only mounts this band once the server has found a real
    // published course (see src/app/page.tsx), so the heading stays put while
    // the client stream loads. No Supabase config = a stream that never fills.
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

  it("never announces an empty store nor dresses up cards as courses", () => {
    mocks.getSupabaseClientConfig.mockReturnValue(null);

    render(<FeaturedCourses />);

    expect(screen.queryByText(/opens soon/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Professional programs across coaching/),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
