import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreatorCourseDetail } from "@/components/courses/creator-course-detail";
import type { TeacherCourse } from "@/domain/teacher-course";

const fixtures = vi.hoisted(() => ({
  course: {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Deep Focus Systems",
    summary: "Build a repeatable focus practice.",
    category: "Performance",
    status: "published",
    modules: [],
    lessonCount: 0,
  } satisfies TeacherCourse,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    refreshUser: vi.fn(),
    status: "unauthenticated",
    user: null,
    signOut: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/supabase/config", () => ({
  getSupabaseClientConfig: () => ({}),
}));

// Entrega o curso publicado na hora, como a assinatura real faria.
vi.mock("@/lib/data/published-courses", () => ({
  subscribeToViewableTeacherCourse: (
    _ref: string,
    onNext: (course: TeacherCourse) => void,
  ) => {
    onNext(fixtures.course);
    return () => {};
  },
}));

vi.mock("@/lib/data/course-landings", () => ({
  emptyCourseLanding: { template: "classic", blocks: [] },
  getCourseLanding: async () => ({ template: "classic", blocks: [] }),
}));

vi.mock("@/lib/data/lesson-content", () => ({
  getLessonContentDoc: vi.fn(),
  resolveLessonContent: () => ({ contentText: null, externalUrl: null }),
}));

vi.mock("@/lib/payments/checkout", () => ({
  enrollInFreeCreatorCourse: vi.fn(),
  startCourseCheckout: vi.fn(),
}));

vi.mock("@/components/courses/course-landing-blocks", () => ({
  CourseLandingBlocks: () => null,
}));

vi.mock("@/components/courses/course-social-proof", () => ({
  CourseInstructorCard: () => null,
  CourseReviewsSection: () => null,
}));

vi.mock("@/components/courses/bunny-video-player", () => ({
  BunnyVideoPlayer: () => null,
}));

beforeEach(() => {
  // A busca de ofertas fica pendente: o preço mostra "Loading pricing...".
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CreatorCourseDetail", () => {
  it("por padrão desenha o próprio cabeçalho com o título do curso", () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" />);

    const title = screen.getByRole("heading", { level: 1, name: "Deep Focus Systems" });
    // Clamp, não 60px fixos.
    expect(title).toHaveClass("page-title");
    expect(title.className).not.toMatch(/text-6xl/);
  });

  it("com hideHeader não repete o título que a página já renderizou no servidor", () => {
    const { container } = render(
      <CreatorCourseDetail courseIdOverride="course-1" hideHeader />,
    );

    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByText("Deep Focus Systems")).not.toBeInTheDocument();
    // O resto do conteúdo interativo continua no lugar.
    expect(container.querySelector("#free-preview")).not.toBeNull();
  });
});
