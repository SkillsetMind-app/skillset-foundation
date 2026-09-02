import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { ClassroomTab } from "@/domain/classroom-tabs";
import type { Course } from "@/domain/learning";
import { recordLessonProgress } from "@/lib/data/lesson-progress";

/**
 * Reanalise item 8, renderizado de verdade (matricula real, nao preview):
 *   - a capa inteira e a PAGINA INICIAL do curso (primeira visita: sem aula no
 *     endereco e sem progresso). Em toda aula, um cabecalho curto;
 *   - a playlist fica ao lado do video, com a aula atual em destaque;
 *   - ha UM so botao de concluir na sala inteira (sob o video). Na lista, o
 *     check da aula concluida desfaz — pelo mesmo caminho.
 */

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  pathname: "/learn/courses/demo-course",
  replace: vi.fn(),
  completed: [] as string[],
  // UM objeto de usuario para a sessao inteira. A inscricao da matricula
  // depende de `user`; um objeto novo a cada render reinscrevia, a inscricao
  // entregava a matricula (setState), o render seguinte trazia outro objeto...
  // e o teste comia 4 GB de memoria em vez de falhar. O provider real emite
  // so quando o conteudo muda (#134); o mock precisa do mesmo contrato.
  auth: {
    status: "authenticated",
    user: { uid: "student-1", email: "student@example.com", roles: ["student"] },
  },
  enrollmentSubscriptions: 0,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/lib/data/enrollments", () => ({
  // Entrega a matricula na hora, seja qual for a assinatura da funcao.
  subscribeToEnrollment: vi.fn((...args: unknown[]) => {
    // Fusivel: um laco de inscricao e sincrono dentro do render — nem o
    // timeout do vitest alcanca. Vira falha que termina, nao travamento.
    mocks.enrollmentSubscriptions += 1;
    if (mocks.enrollmentSubscriptions > 20) {
      throw new Error("subscribeToEnrollment chamado mais de 20 vezes: laco de render");
    }
    const onNext = args.find((arg) => typeof arg === "function") as (
      enrollment: unknown,
    ) => void;
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
  markLessonComplete: vi.fn(),
  updateEnrollmentProgress: vi.fn(),
}));

vi.mock("@/lib/data/lesson-progress", () => ({
  recordLessonProgress: vi.fn(() => Promise.resolve()),
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

vi.mock("@/lib/data/lesson-comments", () => ({
  subscribeToLessonComments: vi.fn(() => vi.fn()),
  addLessonComment: vi.fn(),
  deleteLessonComment: vi.fn(),
}));

vi.mock("@/lib/posthog/events", () => ({
  track: new Proxy({}, { get: () => vi.fn() }),
}));

// Fora do preview, mensagens e avaliacao abrem inscricao no Supabase de
// verdade ("Supabase client configuration is missing" no jsdom). Nao sao o
// alvo deste teste: viram caixas vazias.
vi.mock("@/components/learn/course-messages-panel", () => ({
  CourseMessagesPanel: () => <div data-testid="messages-panel" />,
}));
vi.mock("@/components/learn/course-review-panel", () => ({
  CourseReviewPanel: () => <div data-testid="review-panel" />,
}));
// A aba Community renderiza o feed simplificado (community-feed.tsx); o
// componente antigo (course-community-feed.tsx) ficou so no hub /learn/community.
vi.mock("@/components/learn/community-feed", () => ({
  CommunityFeed: () => <div data-testid="community-feed" />,
}));

const course = {
  id: "course-1",
  slug: "demo-course",
  title: "Demo course",
  category: "Leadership",
  summary: "A demo course.",
  durationLabel: "2h",
  image: null,
  membersTheme: "light",
  communityEnabled: true,
  modules: [
    {
      id: "m1",
      title: "Module one",
      summary: "",
      lessons: [
        { id: "l1", title: "Lesson one", type: "text", duration: "5 min", isPreview: true, contentText: "One" },
        { id: "l2", title: "Lesson two", type: "text", duration: "7 min", isPreview: false, contentText: "Two" },
      ],
    },
  ],
} as unknown as Course;

function renderClassroom(
  search: string,
  completed: string[] = [],
  tab: ClassroomTab = "lesson",
) {
  mocks.searchParams = new URLSearchParams(search);
  mocks.pathname =
    tab === "lesson" ? "/learn/courses/demo-course" : `/learn/courses/demo-course/${tab}`;
  mocks.completed = completed;
  return render(<EnrolledCourseWorkspace course={course} tab={tab} />);
}

describe("sala de aula com matricula real", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.enrollmentSubscriptions = 0;
    vi.mocked(recordLessonProgress).mockClear();
    Element.prototype.scrollIntoView = vi.fn();
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
  });

  it("primeira visita (sem ?lesson=, sem progresso): a capa inteira, sem cabecalho curto", () => {
    renderClassroom("");

    expect(document.querySelector(".members-hero")).not.toBeNull();
    expect(document.querySelector(".member-classroom-head")).toBeNull();
  });

  it("em aula (?lesson=): cabecalho curto com '← My courses' no lugar da capa", () => {
    renderClassroom("lesson=l2");

    expect(document.querySelector(".members-hero")).toBeNull();
    expect(screen.getByRole("link", { name: "← My courses" })).toHaveAttribute("href", "/learn");
    expect(screen.getByRole("progressbar", { name: /complete/ })).toBeInTheDocument();
  });

  it("quem ja tem progresso nao ve a capa de novo, mesmo sem ?lesson=", () => {
    renderClassroom("", ["l1"]);

    expect(document.querySelector(".members-hero")).toBeNull();
    expect(document.querySelector(".member-classroom-head")).not.toBeNull();
  });

  it("a playlist mora na lateral, com a aula atual em destaque — e ha UM so botao de concluir", () => {
    renderClassroom("lesson=l2");

    const playlist = screen.getByRole("navigation", { name: "Lessons" });
    expect(playlist.closest("aside")).toHaveClass("member-classroom-sidebar");
    expect(within(playlist).getByRole("button", { name: /Lesson two/ })).toHaveAttribute(
      "aria-current",
      "true",
    );

    // Antes: um sob o video E um em cada cartao da grade, todos para a mesma aula.
    expect(screen.getAllByRole("button", { name: /^Mark (complete|incomplete)$/ })).toHaveLength(1);
  });

  it("na lista, o check da aula concluida desfaz pelo mesmo caminho do botao sob o video", async () => {
    renderClassroom("lesson=l2", ["l1"]);

    fireEvent.click(screen.getByRole("button", { name: 'Mark "Lesson one" incomplete' }));

    await waitFor(() => expect(recordLessonProgress).toHaveBeenCalled());
    expect(JSON.stringify(vi.mocked(recordLessonProgress).mock.calls[0])).toContain("l1");
  });
});

/**
 * Reanalise item 9: as abas da sala tem endereco proprio. Materiais,
 * comunidade, mensagens e avaliacao moravam na mesma rolagem da aula, sem
 * endereco — nem compartilhar nem voltar. E a faixa "Lesson tools" tinha tres
 * botoes que so ROLAVAM a pagina.
 */
describe("abas da sala com endereco proprio", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.enrollmentSubscriptions = 0;
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("em aula: a barra de abas leva a aula atual junto, e so a aula renderiza", () => {
    renderClassroom("lesson=l2");

    const tabs = screen.getByRole("navigation", { name: "Course sections" });
    expect(within(tabs).getByRole("link", { name: "Lesson" })).toHaveAttribute(
      "href",
      "/learn/courses/demo-course?lesson=l2",
    );
    expect(within(tabs).getByRole("link", { name: "Lesson" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(tabs).getByRole("link", { name: "Community" })).toHaveAttribute(
      "href",
      "/learn/courses/demo-course/community?lesson=l2",
    );

    expect(document.querySelector("#member-lesson-player")).not.toBeNull();
    expect(screen.queryByTestId("community-feed")).toBeNull();
    expect(screen.queryByTestId("messages-panel")).toBeNull();
    expect(screen.queryByTestId("review-panel")).toBeNull();
  });

  it("os botoes que so rolavam a pagina sairam", () => {
    renderClassroom("lesson=l2");

    expect(screen.queryByRole("button", { name: /Current lesson/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Resources/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Discussion$/ })).toBeNull();
  });

  it("na aba Community: o feed aparece, o player nao, e 'Lesson' devolve a MESMA aula", () => {
    renderClassroom("lesson=l2", [], "community");

    expect(screen.getByTestId("community-feed")).toBeInTheDocument();
    expect(document.querySelector("#member-lesson-player")).toBeNull();

    const tabs = screen.getByRole("navigation", { name: "Course sections" });
    expect(within(tabs).getByRole("link", { name: "Community" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(tabs).getByRole("link", { name: "Lesson" })).toHaveAttribute(
      "href",
      "/learn/courses/demo-course?lesson=l2",
    );
  });

  it("Messages e Review sao abas, cada uma renderiza so o seu painel", () => {
    const { unmount } = renderClassroom("lesson=l2", [], "messages");
    expect(screen.getByTestId("messages-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("review-panel")).toBeNull();
    unmount();

    renderClassroom("lesson=l2", [], "review");
    expect(screen.getByTestId("review-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("messages-panel")).toBeNull();
  });

  it("a aba About e a capa inteira, mesmo para quem ja tem progresso", () => {
    renderClassroom("lesson=l2", ["l1"], "about");

    expect(document.querySelector(".members-hero")).not.toBeNull();
    expect(document.querySelector("#member-lesson-player")).toBeNull();
  });
});
