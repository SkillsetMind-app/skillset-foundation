import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
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
  // A lista de concluidas chega de novo pelo realtime: o teste a reemite.
  emitCompleted: null as null | ((lessonIds: string[]) => void),
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
      mocks.emitCompleted = onNext;
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

function playlist() {
  return screen.getByRole("navigation", { name: "Lessons" });
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

    // Trocar de aula leva o aviso junto: ele era da aula anterior.
    fireEvent.click(within(playlist()).getByRole("button", { name: /Lesson two/ }));
    expect(screen.queryByText("We could not update lesson progress. Please try again.")).not.toBeInTheDocument();
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
    // Curso sequencial: a proxima abre ja liberada, sem esperar o realtime
    // trazer a conclusao (o mock nao reenvia a lista).
    expect(screen.queryByRole("heading", { name: "Lesson locked" })).not.toBeInTheDocument();
    expect(screen.getByText("Two")).toBeInTheDocument();
  });

  it("trocar de aula com a contagem pendente cancela a contagem", async () => {
    vi.mocked(recordLessonProgress).mockResolvedValue({ progressPercent: 33, completedLessonCount: 1 } as never);
    const video = (id: string, title: string) => ({
      id, title, type: "video", duration: "5 min", isPreview: false,
      videoSource: "youtube", externalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.completed = [];
    render(<EnrolledCourseWorkspace course={{ ...course, dripStrategy: undefined, modules: [{
      ...course.modules[0], lessons: [video("l1", "Lesson one"), video("l2", "Lesson two"), video("l3", "Lesson three")],
    }] } as unknown as Course} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "End video" }));
    });
    expect(screen.getByRole("dialog", { name: "Next lesson" })).toBeInTheDocument();

    fireEvent.click(within(playlist()).getByRole("button", { name: /Lesson three/ }));
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

// Onda D na sala: o check da aula, o selo de 100% e o painel da aba so se
// mexem na MUDANCA. Quem chega ve tudo parado (e o que vira LCP nunca nasce
// com opacidade 0).
describe("movimento da sala: so na mudanca", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  const checks = () => [...playlist().querySelectorAll("[data-drawn-check]")];

  it("chegar com as aulas concluidas: check e selo de 100% parados", () => {
    open("l2", ["l1", "l2"]);
    expect(checks()).toHaveLength(2);
    expect(playlist().querySelector(".drawn-check")).toBeNull();
    const seal = document.querySelector("[data-milestone-seal]");
    expect(seal).not.toBeNull();
    expect(seal).not.toHaveClass("milestone-seal");
  });

  it("concluir com a sala aberta: o check daquela aula se desenha e o selo de 100% cresce", () => {
    open("l2", ["l1"]);
    expect(document.querySelector("[data-milestone-seal]")).toBeNull();

    act(() => mocks.emitCompleted!(["l1", "l2"]));
    const drawing = playlist().querySelectorAll(".drawn-check");
    expect(drawing).toHaveLength(1);
    expect(drawing[0].closest("li")).toHaveTextContent("Lesson two");
    expect(document.querySelector("[data-milestone-seal]")).toHaveClass("milestone-seal");
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("o botao de concluir e o button-solid, que afunda ao apertar", () => {
    open("l1");
    expect(within(lessonBar()).getByRole("button", { name: "Mark complete & next" })).toHaveClass("button-solid");
  });

  it("carga nova entra parada; so a troca de aba anima", async () => {
    vi.resetModules();
    const { useTabChanged } = await import("@/components/learn/classroom-tabs");
    const load = renderHook(() => useTabChanged("lesson"));
    expect(load.result.current).toBe(false);
    load.unmount();
    const change = renderHook(() => useTabChanged("about"));
    expect(change.result.current).toBe(true);
    change.unmount();
    const same = renderHook(() => useTabChanged("about"));
    expect(same.result.current).toBe(false);
  });

  it("na troca de aba so o painel da aba entra subindo: titulo e abas ficam parados", () => {
    const first = open("l1");
    first.unmount();
    render(<EnrolledCourseWorkspace course={course} tab="about" />);
    const panel = document.querySelector(".motion-panel-in");
    expect(panel).not.toBeNull();
    expect(panel!.querySelector("h1")).toBeNull();
    expect(panel!.querySelector(".member-classroom-tabs")).toBeNull();
    expect(document.querySelector(".motion-panel-in .motion-panel-in")).toBeNull();
  });
});
