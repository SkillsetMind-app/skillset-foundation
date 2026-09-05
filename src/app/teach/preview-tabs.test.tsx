/// <reference types="vite/client" />

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PreviewPage from "@/app/teach/builder/[courseId]/preview/page";
import type { TeacherCourse } from "@/domain/teacher-course";

const mocks = vi.hoisted(() => ({
  pathname: "",
  searchParams: new URLSearchParams("lesson=l2"),
  auth: {
    status: "authenticated",
    user: { uid: "teacher-1", email: "teacher@example.test", roles: ["teacher"] },
  },
  getMemberArea: vi.fn(),
  subscribeToTeacherCourse: vi.fn(),
  subscribeToEnrollment: vi.fn(() => vi.fn()),
  recordLessonProgress: vi.fn(),
  submitCourseReview: vi.fn(),
  subscribeToUserCourseReview: vi.fn(() => vi.fn()),
}));

vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  usePathname: () => mocks.pathname,
  useSearchParams: () => mocks.searchParams,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/learn/server/member-area", () => ({ getMemberArea: mocks.getMemberArea }));
vi.mock("@/lib/supabase/config", () => ({
  getSupabaseClientConfig: () => ({ url: "https://storage.example.test", anonKey: "fixture-key" }),
}));
vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourse: mocks.subscribeToTeacherCourse,
}));
vi.mock("@/lib/data/enrollments", () => ({
  subscribeToEnrollment: mocks.subscribeToEnrollment,
  markLessonComplete: vi.fn(),
  updateEnrollmentProgress: vi.fn(),
}));
vi.mock("@/lib/data/lesson-progress", () => ({
  recordLessonProgress: mocks.recordLessonProgress,
  subscribeToCompletedLessons: vi.fn(() => vi.fn()),
}));
vi.mock("@/lib/data/lesson-content", () => ({
  subscribeToLessonContent: vi.fn((_courseId, onNext) => {
    onNext(new Map());
    return vi.fn();
  }),
  resolveLessonContent: vi.fn(() => null),
}));
vi.mock("@/lib/data/course-assets", () => ({
  subscribeToCourseAssets: vi.fn((_courseId, onNext) => {
    onNext([]);
    return vi.fn();
  }),
  getProtectedCourseAssetObjectUrl: vi.fn(),
}));
vi.mock("@/lib/data/course-reviews", () => ({
  submitCourseReview: mocks.submitCourseReview,
  subscribeToUserCourseReview: mocks.subscribeToUserCourseReview,
}));

const course: TeacherCourse = {
  id: "course-1",
  ownerId: "teacher-1",
  title: "Preview course",
  summary: "Course summary",
  category: "Leadership",
  status: "draft",
  lessonCount: 2,
  membersTheme: "dark",
  communityEnabled: true,
  modules: [{
    id: "module-1",
    title: "First module",
    lessons: [
      { id: "l1", title: "First lesson", type: "text", description: "First" },
      { id: "l2", title: "Second lesson", type: "text", description: "Second" },
    ],
  }],
};

// Next's filesystem route must exist: discovering modules also lets this test
// fail with a useful assertion if the dynamic route is accidentally removed.
const routes = import.meta.glob<{ default: typeof PreviewPage }>(
  "./builder/**/preview/**/page.tsx",
);

async function renderPreview(tab?: string) {
  const basePath = `/teach/builder/${course.id}/preview`;
  mocks.pathname = tab ? `${basePath}/${tab}` : basePath;
  let Page = PreviewPage;
  if (tab !== undefined) {
    const load = routes["./builder/[courseId]/preview/[tab]/page.tsx"];
    expect(load, "Next route /teach/builder/[courseId]/preview/[tab]").toBeDefined();
    Page = (await load()).default;
  }
  return render(await Page({ params: Promise.resolve({ courseId: course.id, tab }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  mocks.auth.user.roles = ["teacher"];
  mocks.searchParams = new URLSearchParams("lesson=l2");
  mocks.getMemberArea.mockResolvedValue({ brand: { name: "Preview Academy" }, theme: "dark" });
  mocks.subscribeToTeacherCourse.mockImplementation(
    (_courseId: string, onNext: (value: TeacherCourse) => void) => {
      onNext(course);
      return vi.fn();
    },
  );
});

describe("abas da prévia do professor", () => {
  it("mantém a aula na rota-base e os links das abas dentro da prévia", async () => {
    await renderPreview();
    const tabs = screen.getByRole("navigation", { name: "Course sections" });
    expect(within(tabs).getByRole("link", { name: "Lesson" })).toHaveAttribute("aria-current", "page");
    for (const [tab, label] of [["materials", "Materials"], ["review", "Review"], ["about", "About"]]) {
      expect(within(tabs).getByRole("link", { name: label })).toHaveAttribute(
        "href", `/teach/builder/course-1/preview/${tab}?lesson=l2`,
      );
    }
    expect(screen.getByRole("button", { name: "Preview only" })).toBeDisabled();
    expect(mocks.recordLessonProgress).not.toHaveBeenCalled();
  });

  it.each([["materials", "Materials"], ["review", "Review"], ["about", "About"]])(
    "a rota %s chega ao workspace na aba pedida, com a mesma aula e marca",
    async (tab, label) => {
      await renderPreview(tab);
      const tabs = screen.getByRole("navigation", { name: "Course sections" });
      expect(within(tabs).getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
      expect(within(tabs).getByRole("link", { name: "Lesson" })).toHaveAttribute(
        "href", "/teach/builder/course-1/preview?lesson=l2",
      );
      expect(screen.getByRole("link", { name: "Exit preview" })).toHaveAttribute(
        "href", "/teach/builder?courseId=course-1&tab=members",
      );
      expect(screen.getByText("Preview Academy").closest("[data-members-theme]")).toHaveAttribute(
        "data-members-theme", "dark",
      );
      expect(screen.queryByRole("button", { name: "Preview only" })).not.toBeInTheDocument();
      expect(within(tabs).queryByRole("link", { name: /Lives|Community|Messages/ })).not.toBeInTheDocument();
      expect(mocks.subscribeToEnrollment).not.toHaveBeenCalled();
      expect(mocks.recordLessonProgress).not.toHaveBeenCalled();
      if (tab === "materials") expect(screen.getByText("Course resources")).toBeInTheDocument();
      if (tab === "review") {
        const submit = screen.getByRole("button", { name: "Submit review" });
        expect(submit).toBeDisabled();
        fireEvent.submit(submit.closest("form")!);
        expect(mocks.submitCourseReview).not.toHaveBeenCalled();
        expect(mocks.subscribeToUserCourseReview).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["unknown", "lesson"])("recusa /%s antes de consultar o curso", async (tab) => {
    await expect(PreviewPage({
      params: Promise.resolve({ courseId: course.id, tab }),
    })).rejects.toThrow("NOT_FOUND");
    expect(mocks.getMemberArea).not.toHaveBeenCalled();
  });

  it("mantém a permissão do estúdio nas rotas de abas", async () => {
    mocks.auth.user.roles = ["student"];
    await renderPreview("materials");
    expect(screen.queryByRole("navigation", { name: "Course sections" })).not.toBeInTheDocument();
    expect(mocks.subscribeToTeacherCourse).not.toHaveBeenCalled();
  });
});
