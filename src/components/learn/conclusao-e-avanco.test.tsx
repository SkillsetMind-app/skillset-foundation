import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { Course } from "@/domain/learning";
import { recordLessonProgress } from "@/lib/data/lesson-progress";

/**
 * Concluir a aula e seguir para a proxima, pelos dois caminhos: o fim do video
 * e o botao fixo sob a aula.
 *
 *   - Se salvar a conclusao falha, nada avanca. Antes o cartao "Proxima aula"
 *     aparecia mesmo assim e, num curso sequencial, a proxima abria trancada e
 *     o servidor negava o video.
 *   - O botao e um pedido explicito: vai direto para a proxima, sem a contagem
 *     de 5 s (que fica para o fim do video).
 *   - Na ultima aula concluida, o botao morto "Completed" vira "Get
 *     certificate".
 */

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
  completed: [] as string[],
  auth: {
    status: "authenticated",
    user: { uid: "student-1", email: "student@example.com", roles: ["student"] },
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
  usePathname: () => "/learn/courses/demo-course",
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace, refresh: vi.fn() }),
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
      courseTitle: "Demo course",
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
  subscribeToCourseEvents: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/data/community-posts", () => ({
  countOpenCommunityQuestions: vi.fn(() => new Promise<number>(() => {})),
  subscribeToCommunityPosts: vi.fn(() => vi.fn()),
  subscribeToCourseCommunityComments: vi.fn(() => vi.fn()),
  createCommunityPost: vi.fn(),
}));

vi.mock("@/lib/posthog/events", () => ({
  track: new Proxy({}, { get: () => vi.fn() }),
}));

// O fim do video, sem iframe: um botao que dispara o mesmo onEnded.
vi.mock("@/components/learn/trusted-embed-player", () => ({
  TrustedEmbedPlayer: ({ onEnded }: { onEnded: () => void }) => (
    <button type="button" onClick={onEnded}>End video</button>
  ),
}));

const course = {
  id: "course-1",
  slug: "demo-course",
  title: "Demo course",
  category: "Leadership",
  summary: "A demo course.",
  image: null,
  membersTheme: "light",
  dripStrategy: "sequential_progress",
  modules: [
    {
      id: "m1",
      title: "Module one",
      summary: "",
      lessons: [
        {
          id: "l1", title: "Lesson one", type: "video", duration: "5 min", isPreview: false,
          videoSource: "youtube", externalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        },
        { id: "l2", title: "Lesson two", type: "text", duration: "7 min", isPreview: false, contentText: "Two" },
      ],
    },
  ],
} as unknown as Course;

function open(lessonId: string, completed: string[] = [], props: { whitelabel?: boolean } = {}) {
  mocks.searchParams = new URLSearchParams(`lesson=${lessonId}`);
  mocks.completed = completed;
  return render(<EnrolledCourseWorkspace course={course} {...props} />);
}

function lessonBar() {
  return screen.getByRole("navigation", { name: "Lesson navigation" });
}

describe("concluir e seguir para a proxima aula", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    vi.mocked(recordLessonProgress).mockReset();
    Element.prototype.scrollIntoView = vi.fn();
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
  });

  it("fim do video com a conclusao NAO salva: sem cartao de proxima aula, aviso na tela e a aula fica", async () => {
    vi.mocked(recordLessonProgress).mockRejectedValue(new Error("network"));
    open("l1");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "End video" }));
    });

    expect(recordLessonProgress).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Next lesson" })).not.toBeInTheDocument();
    expect(screen.getByText("We could not update lesson progress. Please try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End video" })).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("fim do video com a conclusao salva: o cartao de 5 s propoe a proxima", async () => {
    vi.mocked(recordLessonProgress).mockResolvedValue({ progressPercent: 50, completedLessonCount: 1 } as never);
    open("l1");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "End video" }));
    });

    expect(screen.getByRole("dialog", { name: "Next lesson" })).toBeInTheDocument();
  });

  it("botao com a conclusao NAO salva: nao troca de aula", async () => {
    vi.mocked(recordLessonProgress).mockRejectedValue(new Error("network"));
    open("l1");

    await act(async () => {
      fireEvent.click(within(lessonBar()).getByRole("button", { name: "Mark complete & next" }));
    });

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByText("We could not update lesson progress. Please try again.")).toBeInTheDocument();
  });

  it("botao com a conclusao salva: vai direto para a proxima, sem contagem", async () => {
    vi.mocked(recordLessonProgress).mockResolvedValue({ progressPercent: 50, completedLessonCount: 1 } as never);
    open("l1");

    await act(async () => {
      fireEvent.click(within(lessonBar()).getByRole("button", { name: "Mark complete & next" }));
    });

    expect(mocks.replace).toHaveBeenCalledWith("/learn/courses/demo-course?lesson=l2", { scroll: false });
    expect(screen.queryByRole("dialog", { name: "Next lesson" })).not.toBeInTheDocument();
  });

  it("aula ja concluida: 'Next lesson' vai direto, sem salvar de novo e sem contagem", async () => {
    open("l1", ["l1"]);

    await act(async () => {
      fireEvent.click(within(lessonBar()).getByRole("button", { name: "Next lesson" }));
    });

    expect(recordLessonProgress).not.toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith("/learn/courses/demo-course?lesson=l2", { scroll: false });
    expect(screen.queryByRole("dialog", { name: "Next lesson" })).not.toBeInTheDocument();
  });

  it("ultima aula concluida: 'Get certificate' leva ao certificado, sem o botao morto 'Completed'", () => {
    open("l2", ["l1", "l2"]);

    expect(within(lessonBar()).getByRole("link", { name: "Get certificate" })).toHaveAttribute(
      "href",
      "/learn/credentials",
    );
    expect(within(lessonBar()).queryByRole("button", { name: "Completed" })).not.toBeInTheDocument();
  });

  it("whitelabel: na ultima aula nada leva de volta a plataforma, e 'Completed' nao finge ser acao", () => {
    open("l2", ["l1", "l2"], { whitelabel: true });

    expect(within(lessonBar()).queryByRole("link", { name: "Get certificate" })).not.toBeInTheDocument();
    expect(within(lessonBar()).getByRole("button", { name: "Completed" })).toBeDisabled();
  });
});
