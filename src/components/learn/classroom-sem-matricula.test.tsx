import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { Course } from "@/domain/learning";

// Someone without an enrollment used to get a full page "enrollment required"
// with a link out. Now the classroom shows the same buy popup as the course
// page, and nothing protected (lesson content, lesson videos) is fetched.

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(""),
  router: { push: vi.fn(), replace: vi.fn() },
  subscribeToEnrollment: vi.fn(),
  subscribeToLessonContent: vi.fn(() => vi.fn()),
  subscribeToCourseAssets: vi.fn(() => vi.fn()),
  getProtectedCourseAssetObjectUrl: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
  usePathname: () => "/learn/courses/demo-course",
  useRouter: () => mocks.router,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { uid: "visitor-1", email: "visitor@example.test", roles: ["student"] },
  }),
}));

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToEnrollment: mocks.subscribeToEnrollment,
  subscribeToCompletedLessons: vi.fn(() => vi.fn()),
  markLessonComplete: vi.fn(),
  updateEnrollmentProgress: vi.fn(),
}));

vi.mock("@/lib/data/lesson-content", () => ({
  subscribeToLessonContent: mocks.subscribeToLessonContent,
  resolveLessonContent: (_doc: unknown, lesson: { contentText?: string | null; externalUrl?: string | null }) => ({
    contentText: lesson.contentText ?? null,
    externalUrl: lesson.externalUrl ?? null,
  }),
}));

vi.mock("@/lib/data/course-assets", () => ({
  subscribeToCourseAssets: mocks.subscribeToCourseAssets,
  getProtectedCourseAssetObjectUrl: mocks.getProtectedCourseAssetObjectUrl,
}));

const course = {
  id: "course-1",
  slug: "demo-course",
  title: "Demo course",
  category: "Leadership",
  summary: "A demo course.",
  image: null,
  priceAmountMinor: 12900,
  currency: "USD",
  modules: [
    {
      id: "m1",
      title: "Start",
      lessons: [{ id: "l1", title: "Welcome", type: "video", duration: "Self-paced" }],
    },
  ],
  membersTheme: "light",
} as unknown as Course;

describe("classroom without an enrollment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams("");
    mocks.subscribeToEnrollment.mockImplementation((_uid, _slug, onNext) => {
      onNext(null);
      return vi.fn();
    });
  });

  it("shows the buy popup with the course page link and 'Back to my learning', fetching nothing protected", () => {
    render(<EnrolledCourseWorkspace course={course} />);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Demo course" })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /Unlock course/ })).toHaveAttribute("href", "/courses/demo-course");
    expect(within(dialog).getByRole("link", { name: "Back to my learning" })).toHaveAttribute("href", "/learn");
    expect(screen.queryByText("Enrollment required")).not.toBeInTheDocument();

    expect(mocks.subscribeToLessonContent).not.toHaveBeenCalled();
    expect(mocks.subscribeToCourseAssets).not.toHaveBeenCalled();
    expect(mocks.getProtectedCourseAssetObjectUrl).not.toHaveBeenCalled();
  });

  // The modal's fallback printed "Unlock course - $129.00" from the raw
  // course price, always in English. The course page owns the price.
  it("the popup button says 'Unlock course' with no price", () => {
    render(<EnrolledCourseWorkspace course={course} />);

    const cta = within(screen.getByRole("dialog")).getAllByRole("link")[0];
    expect(cta.textContent?.trim()).toBe("Unlock course");
  });

  it("closing the popup goes back to my learning", () => {
    render(<EnrolledCourseWorkspace course={course} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(mocks.router.push).toHaveBeenCalledWith("/learn");
  });

  it("right after checkout, 'Opening your course...' still renders, with no popup", () => {
    mocks.searchParams = new URLSearchParams("checkout=success");
    render(<EnrolledCourseWorkspace course={course} />);

    expect(screen.getByRole("heading", { name: "Opening your course..." })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
