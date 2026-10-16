import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { CourseEvent } from "@/domain/course-event";
import type { Course } from "@/domain/learning";

/**
 * A sala do aluno para o que nao e curso gravado (courses.product_format).
 *
 *   - Comunidade e evento ao vivo publicam sem aula: a sala abria em "Lesson"
 *     com "0 of 0 lessons" e uma playlist vazia. Agora abre na comunidade, ou
 *     nas lives, e a aba Lesson sem aula tem um aviso.
 *   - Evento ao vivo depois da data: a aba de lives sumia. Agora diz que a
 *     sessao ja aconteceu e leva a gravacao, quando o professor pos uma.
 *   - E-book: a aula "download" e o arquivo, sem a caixa "sem video"; o botao
 *     da capa abre o arquivo; e nao ha certificado.
 *   - Avaliacao sem trilha de aulas nao cobra 50% de progresso.
 */

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  completed: [] as string[],
  events: [] as CourseEvent[],
  auth: {
    status: "authenticated",
    user: { uid: "student-1", email: "student@example.com", roles: ["student"] },
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
  usePathname: () => "/learn/courses/demo-course",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToEnrollment: vi.fn((_uid: string, _slug: string, onNext: (enrollment: unknown) => void) => {
    onNext({
      id: "enr-1",
      userId: "student-1",
      courseId: "course-1",
      courseSlug: "demo-course",
      courseTitle: "Demo product",
      courseCategory: "Leadership",
      courseImage: "",
      status: "active",
      source: "admin",
      progressPercent: 0,
      lastLessonId: null,
    });
    return vi.fn();
  }),
}));

vi.mock("@/lib/data/lesson-progress", () => ({
  recordLessonProgress: vi.fn(),
  subscribeToCompletedLessons: vi.fn(
    (_enrollmentId: string, onNext: (lessonIds: string[]) => void) => {
      onNext(mocks.completed);
      return vi.fn();
    },
  ),
}));

vi.mock("@/lib/data/lesson-content", () => ({
  subscribeToLessonContent: vi.fn((_courseId, onNext) => {
    onNext(new Map());
    return vi.fn();
  }),
  resolveLessonContent: vi.fn(() => ({})),
}));

vi.mock("@/lib/data/course-assets", () => ({
  subscribeToCourseAssets: vi.fn(() => vi.fn()),
  getProtectedCourseAssetObjectUrl: vi.fn(),
}));

vi.mock("@/lib/data/course-events", () => ({
  subscribeToCourseEvents: vi.fn((_slug: string, onNext: (events: CourseEvent[]) => void) => {
    onNext(mocks.events);
    return vi.fn();
  }),
}));

vi.mock("@/lib/data/community-posts", () => ({
  countOpenCommunityQuestions: vi.fn(() => new Promise<number>(() => {})),
  subscribeToCommunityPosts: vi.fn(() => vi.fn()),
  subscribeToCourseCommunityComments: vi.fn(() => vi.fn()),
  createCommunityPost: vi.fn(),
}));

vi.mock("@/components/learn/community-feed", () => ({
  CommunityFeed: () => <div data-testid="community-feed" />,
}));

vi.mock("@/lib/data/course-reviews", () => ({
  submitCourseReview: vi.fn(),
  subscribeToUserCourseReview: vi.fn((_courseId: string, _uid: string, onNext: (review: null) => void) => {
    onNext(null);
    return vi.fn();
  }),
}));

vi.mock("@/lib/posthog/events", () => ({
  track: new Proxy({}, { get: () => vi.fn() }),
}));

function product(overrides: Partial<Course>): Course {
  return {
    id: "course-1",
    slug: "demo-course",
    title: "Demo product",
    category: "Leadership",
    summary: "A demo product.",
    image: null,
    membersTheme: "light",
    communityEnabled: false,
    modules: [],
    ...overrides,
  } as unknown as Course;
}

const replayLesson = {
  id: "l1", title: "Replay", type: "live_recording", duration: "", isPreview: false,
};

function pastSession(): CourseEvent {
  return {
    id: "event-1",
    courseId: "course-1",
    courseSlug: "course-1",
    courseTitle: "Demo product",
    ownerId: "teacher-1",
    title: "Live intensive",
    description: "",
    type: "live_class",
    status: "scheduled",
    startsAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    externalUrl: "",
    recordingAssetId: null,
    createdAt: "",
    updatedAt: "",
  } as CourseEvent;
}

function tabBar() {
  return screen.getByRole("navigation", { name: "Course sections" });
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  mocks.searchParams = new URLSearchParams();
  mocks.completed = [];
  mocks.events = [];
});

describe("Sala por tipo de produto", () => {
  it("comunidade sem aula abre na comunidade, sem aba Lesson e sem '0 of 0 lessons'", () => {
    render(
      <EnrolledCourseWorkspace
        course={product({ productFormat: "community", communityEnabled: true })}
      />,
    );

    expect(screen.getByTestId("community-feed")).toBeInTheDocument();
    const tabs = within(tabBar());
    expect(tabs.queryByRole("link", { name: "Lesson" })).toBeNull();
    expect(tabs.getByRole("link", { name: /^Community/ })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText(/0 of 0 lessons/)).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Lesson navigation" })).toBeNull();
  });

  it("evento ao vivo sem aula abre nas lives e, depois da data, diz que a sessao ja aconteceu", () => {
    mocks.events = [pastSession()];
    render(<EnrolledCourseWorkspace course={product({ productFormat: "live_event" })} />);

    const tabs = within(tabBar());
    expect(tabs.queryByRole("link", { name: "Lesson" })).toBeNull();
    expect(tabs.getByRole("link", { name: "Live sessions" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("The session already happened.")).toBeInTheDocument();
    // Sem aula nao ha gravacao para oferecer.
    expect(screen.queryByRole("link", { name: /Watch the replay/ })).toBeNull();
  });

  it("evento passado com a gravacao numa aula leva a ela pela aba de lives", () => {
    mocks.events = [pastSession()];
    render(
      <EnrolledCourseWorkspace
        course={product({
          productFormat: "live_event",
          modules: [{ id: "m1", title: "Replay", summary: "", lessons: [replayLesson] }],
        } as Partial<Course>)}
        tab="lives"
      />,
    );

    expect(screen.getByText("The session already happened.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Watch the replay/ })).toHaveAttribute(
      "href",
      "/learn/courses/demo-course?lesson=l1",
    );
  });

  it("a aba Lesson sem aula mostra um aviso, nao uma playlist vazia", () => {
    render(<EnrolledCourseWorkspace course={product({ productFormat: "course" })} />);

    expect(screen.getByText("There are no lessons here yet.")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Lesson navigation" })).toBeNull();
    expect(screen.queryByText(/0 of 0 lessons/)).toBeNull();
  });

  describe("e-book", () => {
    const ebook = product({
      productFormat: "ebook",
      modules: [
        {
          id: "m1",
          title: "Your file",
          summary: "",
          lessons: [{ id: "l1", title: "Workbook", type: "download", duration: "", isPreview: false }],
        },
      ],
    } as Partial<Course>);

    it("a aula do arquivo nao mostra a caixa de video, e a capa diz 'Open your file'", () => {
      render(<EnrolledCourseWorkspace course={ebook} />);

      expect(screen.getByRole("link", { name: "Open your file" })).toHaveAttribute(
        "href",
        "/learn/courses/demo-course?lesson=l1",
      );
      expect(screen.queryByText("Media not attached yet")).toBeNull();
      expect(screen.queryByText("Start lesson 1")).toBeNull();
    });

    it("concluido nao oferece certificado", () => {
      mocks.searchParams = new URLSearchParams("lesson=l1");
      mocks.completed = ["l1"];
      render(<EnrolledCourseWorkspace course={ebook} />);

      expect(screen.getByText("100%")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Get certificate/ })).toBeNull();
    });
  });

  it("sem trilha de aulas a avaliacao abre sem os 50%", () => {
    render(
      <EnrolledCourseWorkspace
        course={product({ productFormat: "community", communityEnabled: true })}
        tab="review"
      />,
    );

    expect(screen.getByRole("button", { name: "Submit review" })).toBeEnabled();
    expect(screen.queryByText(/Reviews open after you complete 50%/)).toBeNull();
  });

  it("curso com aula segue cobrando os 50%", () => {
    render(
      <EnrolledCourseWorkspace
        course={product({
          productFormat: "course",
          modules: [{ id: "m1", title: "Module", summary: "", lessons: [replayLesson] }],
        } as Partial<Course>)}
        tab="review"
      />,
    );

    expect(screen.getByRole("button", { name: "Submit review" })).toBeDisabled();
    expect(screen.getByText(/Reviews open after you complete 50%/)).toBeInTheDocument();
  });
});
