import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import type { ClassroomTab } from "@/domain/classroom-tabs";
import type { Course } from "@/domain/learning";
import type { CourseAsset } from "@/domain/course-asset";
import { subscribeToCourseAssets, getProtectedCourseAssetObjectUrl } from "@/lib/data/course-assets";
import { countOpenCommunityQuestions } from "@/lib/data/community-posts";
import { subscribeToCourseEvents } from "@/lib/data/course-events";
import { recordLessonProgress } from "@/lib/data/lesson-progress";
import { subscribeToEnrollment } from "@/lib/data/enrollments";

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
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace, refresh: vi.fn() }),
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

// O nome publico do professor, para o feed da comunidade.
vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToPublicProfile: vi.fn(
    (uid: string, onNext: (profile: unknown) => void) => {
      onNext({ uid, displayName: "Ana Prof", username: "ana", photoURL: null, bio: null, credentials: [] });
      return vi.fn();
    },
  ),
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

// O contador da aba Community: uma leitura ao abrir a sala. Por padrao ela
// nunca volta — e o estado real de quase todo teste daqui (a sala renderiza
// antes do numero chegar) e evita um setState solto fora de act(). Os testes
// do contador dizem o que a leitura devolve.
vi.mock("@/lib/data/community-posts", () => ({
  countOpenCommunityQuestions: vi.fn(() => new Promise<number>(() => {})),
  // Comentarios da aula sob o player (P3) abrem as mesmas inscricoes do feed.
  // Aqui nunca respondem: a sala renderiza antes do feed chegar, e o alvo
  // deste arquivo e a sala, nao a lista (lesson-comments.test.tsx).
  subscribeToCommunityPosts: vi.fn(() => vi.fn()),
  subscribeToCourseCommunityComments: vi.fn(() => vi.fn()),
  createCommunityPost: vi.fn(),
}));

vi.mock("@/lib/data/course-events", () => ({
  subscribeToCourseEvents: vi.fn(() => vi.fn()),
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
  CommunityFeed: (props: { instructorName?: string | null; instructorIds?: string[] }) => (
    <div
      data-testid="community-feed"
      data-instructor={props.instructorName ?? ""}
      data-instructor-ids={(props.instructorIds ?? []).join(",")}
    />
  ),
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
  instructorId: "teacher-1",
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

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}

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

  it("translates the lesson body, completion controls and compact header without changing the lesson or progress", () => {
    mocks.searchParams = new URLSearchParams("lesson=l1&campaign=literal");
    mocks.pathname = "/learn/courses/demo-course";
    mocks.completed = [];
    render(<I18nProvider initialLocale="es"><EnrolledCourseWorkspace course={course} /></I18nProvider>);
    expect(screen.getByRole("link", { name: "← Mis cursos" })).toHaveAttribute("href", "/learn");
    expect(screen.getByRole("progressbar", { name: "0% completado" })).toBeInTheDocument();
    expect(screen.getByText("Lección de texto")).toBeInTheDocument();
    expect(screen.getByText("Contenido de la lección")).toBeInTheDocument();
    expect(screen.getByText("Vista previa gratuita")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Comentarios de la lección" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar como completada y continuar" })).toBeInTheDocument();
    expect(screen.getByText("One")).toBeInTheDocument();
    expect(mocks.searchParams.toString()).toBe("lesson=l1&campaign=literal");
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });

  it("translates loading and a later enrollment failure without reconnecting on locale change", () => {
    mocks.searchParams = new URLSearchParams();
    mocks.completed = [];
    let fail!: (error: Error) => void;
    vi.mocked(subscribeToEnrollment).mockClear();
    vi.mocked(subscribeToEnrollment).mockImplementationOnce((_uid, _slug, _next, onError) => {
      fail = onError;
      return vi.fn();
    });
    render(<I18nProvider initialLocale="en"><ChangeLanguage /><EnrolledCourseWorkspace course={course} /></I18nProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("Loading course workspace...");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("status")).toHaveTextContent("Cargando el espacio del curso...");
    act(() => fail(new Error("private enrollment detail")));
    expect(screen.getByText("No pudimos confirmar tu inscripción en este curso.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir página del curso" })).toHaveAttribute("href", "/courses/demo-course");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByText("We could not confirm your enrollment for this course.")).toBeInTheDocument();
    expect(subscribeToEnrollment).toHaveBeenCalledTimes(1);
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });

  it("localizes course resource loading, kind, count and empty state with the existing asset contract", () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.completed = [];
    let emit!: (assets: CourseAsset[]) => void;
    vi.mocked(subscribeToCourseAssets).mockImplementationOnce((_id, callback) => {
      emit = callback;
      return vi.fn();
    });
    render(<I18nProvider initialLocale="es"><EnrolledCourseWorkspace course={course} tab="materials" enableFirestoreAssets /></I18nProvider>);
    expect(screen.getByText("Cargando recursos del curso...")).toBeInTheDocument();
    act(() => emit([{ id: "file-test", courseId: course.id, ownerId: "teacher-1", lessonId: null,
      kind: "lesson_material", fileName: "Worksheet $$50 $&.pdf", contentType: "application/pdf",
      size: 512, storagePath: "courses/course-1/assets/file-test.pdf", isPreview: false }]));
    expect(screen.getByText("1 archivo")).toBeInTheDocument();
    expect(screen.getByText("Worksheet $$50 $&.pdf")).toBeInTheDocument();
    expect(screen.getByText(/Material de la lección/)).toBeInTheDocument();
    expect(screen.getByText("Solo inscritos")).toBeInTheDocument();
    act(() => emit([]));
    expect(screen.getByText("0 archivos")).toBeInTheDocument();
    expect(screen.getByText("Este curso todavía no tiene recursos generales adjuntos.")).toBeInTheDocument();
  });

  it("localizes the certificate link without changing its destination", () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    mocks.completed = ["l1", "l2"];
    render(<I18nProvider initialLocale="es"><EnrolledCourseWorkspace course={course} /></I18nProvider>);
    expect(screen.getByRole("link", { name: "Obtener certificado" })).toHaveAttribute("href", "/learn/credentials");
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });

  it("translates the sequential lock reason while keeping protected content and completion unavailable", () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    mocks.completed = [];
    render(<I18nProvider initialLocale="es"><EnrolledCourseWorkspace
      course={{ ...course, dripStrategy: "sequential_progress" }} /></I18nProvider>);
    expect(screen.getByRole("heading", { name: "Lección bloqueada" })).toBeInTheDocument();
    expect(screen.getByText("Completa la lección anterior para desbloquearla")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lección bloqueada" })).toBeDisabled();
    expect(screen.queryByText("Two")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });

  it("passes the translated mini-player label without replacing the real iframe or resetting dismissal", () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.completed = [];
    let observe!: IntersectionObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { observe = callback; }
      observe() {}
      disconnect() { disconnect(); }
    });
    try {
      const videoCourse = { ...course, modules: course.modules.map((module) => ({ ...module,
        lessons: module.lessons.map((lesson) => lesson.id === "l1" ? {
          ...lesson, type: "video" as const, videoSource: "youtube" as const,
          externalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        } : lesson),
      })) };
      const { container, unmount } = render(<I18nProvider initialLocale="en"><ChangeLanguage />
        <EnrolledCourseWorkspace course={videoCourse} />
      </I18nProvider>);
      const iframe = container.querySelector("iframe");
      expect(iframe).not.toBeNull();
      act(() => observe([{ isIntersecting: false, boundingClientRect: { top: -400, height: 200 } } as IntersectionObserverEntry], {} as IntersectionObserver));
      fireEvent.click(screen.getByRole("button", { name: "Change language" }));
      const close = screen.getByRole("button", { name: "Cerrar mini reproductor" });
      expect(container.querySelector("iframe")).toBe(iframe);
      expect(container.querySelector(".member-video-dock")).toHaveAttribute("data-mini", "true");
      fireEvent.click(close);
      fireEvent.click(screen.getByRole("button", { name: "Change language" }));
      expect(container.querySelector(".member-video-dock")).toHaveAttribute("data-mini", "false");
      expect(container.querySelector("iframe")).toBe(iframe);
      expect(disconnect).not.toHaveBeenCalled();
      expect(recordLessonProgress).not.toHaveBeenCalled();
      unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("translates all seven shared tab labels without changing routes or authored lesson names", () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    mocks.pathname = "/learn/courses/demo-course";
    mocks.completed = [];
    const authoredTitle = "Lección $$50; código literal $&.";
    const localizedCourse = {
      ...course,
      communityEnabled: true,
      modules: course.modules.map((module) => ({ ...module, lessons: module.lessons.map((lesson) => lesson.id === "l1" ? { ...lesson, title: authoredTitle } : lesson) })),
    };
    render(<I18nProvider initialLocale="es"><EnrolledCourseWorkspace course={localizedCourse} enableFirestoreAssets /></I18nProvider>);
    const tabs = screen.getByRole("navigation", { name: "Secciones del curso" });
    for (const [tab, label] of [["lesson", "Lección"], ["materials", "Materiales"], ["lives", "En vivo"], ["community", "Comunidad"], ["messages", "Mensajes"], ["review", "Reseña"], ["about", "Acerca del curso"]]) {
      expect(within(tabs).getByRole("link", { name: label })).toHaveAttribute("href", `/learn/courses/demo-course${tab === "lesson" ? "" : `/${tab}`}?lesson=l2`);
    }
    expect(screen.getByRole("button", { name: `Lección anterior: ${authoredTitle}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Todas las lecciones (2)" })).toBeInTheDocument();
    expect(mocks.enrollmentSubscriptions).toBe(1);
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });

  it("primeira visita (sem ?lesson=, sem progresso): a capa inteira, sem cabecalho curto", () => {
    renderClassroom("");

    expect(document.querySelector(".members-hero")).not.toBeNull();
    expect(document.querySelector(".member-classroom-head")).toBeNull();
  });

  it("uses subscribed lesson thumbnails in both lists without signing private content", () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.completed = [];
    vi.mocked(subscribeToCourseAssets).mockClear();
    vi.mocked(getProtectedCourseAssetObjectUrl).mockClear();
    let emit!: (assets: CourseAsset[]) => void;
    vi.mocked(subscribeToCourseAssets).mockImplementationOnce((_id, callback) => {
      emit = callback;
      return vi.fn();
    });
    const { container, rerender } = render(<EnrolledCourseWorkspace course={course} enableFirestoreAssets />);
    const thumbnail = (patch: Partial<CourseAsset>): CourseAsset => ({
      id: "old", courseId: course.id, ownerId: "teacher-1", lessonId: "l1",
      kind: "lesson_thumbnail", fileName: "z-old.png", contentType: "image/png", size: 123,
      storagePath: "courses/course-1/assets/old.png", downloadUrl: "/old.png", isPreview: false,
      createdAt: "2026-09-01", ...patch,
    });
    act(() => emit([
      thumbnail({}),
      thumbnail({ id: "new", fileName: "a-new.png", createdAt: "2026-09-02", downloadUrl: "/new.png" }),
      thumbnail({ id: "tracker", createdAt: "2026-09-03", downloadUrl: "https://tracker.invalid/secret.png" }),
      thumbnail({ id: "private", lessonId: "l2", storagePath: "private.png", downloadUrl: null }),
      thumbnail({ id: "other-course", courseId: "other", lessonId: "l2", downloadUrl: "/other-course.png" }),
    ]));
    expect(container.querySelector('img[src="/new.png"]')).not.toBeNull();
    expect(container.querySelector('img[src="/old.png"]')).toBeNull();
    expect(container.querySelector('img[src="/other-course.png"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /All lessons/ }));
    const overlay = screen.getByRole("dialog", { name: "All lessons" });
    expect(overlay.querySelector('img[src="/new.png"]')).not.toBeNull();
    act(() => emit([]));
    expect(container.querySelector('img[src="/new.png"]')).toBeNull();
    act(() => emit([thumbnail({})]));
    expect(container.querySelector('img[src="/old.png"]')).not.toBeNull();
    expect(subscribeToCourseAssets).toHaveBeenCalledTimes(1);
    expect(getProtectedCourseAssetObjectUrl).not.toHaveBeenCalled();
    rerender(<EnrolledCourseWorkspace course={{ ...course, id: "other", slug: "other" }} enableFirestoreAssets />);
    expect(container.querySelector('img[src="/old.png"]')).toBeNull();
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

  it("na aba Community: o feed sabe quem e o professor — id e nome publico", () => {
    renderClassroom("lesson=l2", [], "community");

    const feed = screen.getByTestId("community-feed");
    expect(feed).toHaveAttribute("data-instructor-ids", "teacher-1");
    expect(feed).toHaveAttribute("data-instructor", "Ana Prof");
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

/**
 * Voltar sobe UM nivel. Dentro de uma aba, o "←" ia direto para "My courses":
 * quem abriu a comunidade para tirar uma duvida da aula era jogado para fora do
 * curso inteiro e tinha que achar o curso, a aula e o ponto de novo.
 */
describe("o voltar da sala sobe um nivel", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.enrollmentSubscriptions = 0;
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("na aula, volta para a lista de cursos", () => {
    renderClassroom("lesson=l2");

    expect(screen.getByRole("link", { name: "← My courses" })).toHaveAttribute("href", "/learn");
  });

  it("numa aba, volta para a AULA — a mesma, pelo ?lesson=", () => {
    const { unmount } = renderClassroom("lesson=l2", [], "community");

    const back = screen.getByRole("link", { name: "← Lesson" });
    expect(back).toHaveAttribute("href", "/learn/courses/demo-course?lesson=l2");
    expect(screen.queryByRole("link", { name: "← My courses" })).toBeNull();
    unmount();

    renderClassroom("lesson=l2", [], "materials");
    expect(screen.getByRole("link", { name: "← Lesson" })).toHaveAttribute(
      "href",
      "/learn/courses/demo-course?lesson=l2",
    );
  });

  it("na aba About (que e a capa), a capa tambem devolve a aula", () => {
    renderClassroom("lesson=l2", ["l1"], "about");

    expect(document.querySelector(".members-hero__back")).toHaveAttribute(
      "href",
      "/learn/courses/demo-course?lesson=l2",
    );
    expect(document.querySelector(".members-hero__back")).toHaveTextContent("Lesson");
  });
});

/**
 * A aba Community nao avisava nada: quem estava na aula nao tinha como saber
 * que havia pergunta esperando resposta. A barra de abas ja sabia mostrar
 * numero (Materiais mostra) — Comunidade nunca recebeu um.
 */
describe("o contador de perguntas abertas na aba Community", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.enrollmentSubscriptions = 0;
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(countOpenCommunityQuestions).mockClear();
  });

  it("mostra quantas perguntas do curso seguem sem resposta", async () => {
    vi.mocked(countOpenCommunityQuestions).mockResolvedValueOnce(3);

    renderClassroom("lesson=l2");

    const tabs = screen.getByRole("navigation", { name: "Course sections" });
    expect(await within(tabs).findByRole("link", { name: /Community\s*3/ })).toBeInTheDocument();
    // Le pela MESMA chave que o feed usa (course.id, nao o slug da rota).
    expect(countOpenCommunityQuestions).toHaveBeenCalledWith("course-1");
  });

  it("sem pergunta aberta, nenhum numero aparece", async () => {
    vi.mocked(countOpenCommunityQuestions).mockResolvedValueOnce(0);

    renderClassroom("lesson=l2");

    const tabs = screen.getByRole("navigation", { name: "Course sections" });
    await waitFor(() => expect(countOpenCommunityQuestions).toHaveBeenCalled());
    expect(within(tabs).getByRole("link", { name: "Community" })).toBeInTheDocument();
    expect(tabs.querySelector(".member-classroom-tabs__count")).toBeNull();
  });

  it("na aba En vivo, a data da sessao sai no idioma da pessoa", () => {
    const startsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(subscribeToCourseEvents).mockImplementationOnce((_courseId, onData) => {
      onData([{
        id: "event-1",
        courseId: course.id,
        courseSlug: course.slug,
        courseTitle: course.title,
        ownerId: "teacher-1",
        title: "Live Q&A",
        description: "",
        type: "live_class",
        status: "scheduled",
        startsAt,
        externalUrl: "https://meet.example.com/live",
        recordingAssetId: null,
      }]);
      return () => undefined;
    });
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.pathname = "/learn/courses/demo-course/lives";
    mocks.completed = [];
    render(<I18nProvider initialLocale="es"><EnrolledCourseWorkspace course={course} tab="lives" /></I18nProvider>);

    expect(screen.getByText(
      new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(startsAt)),
    )).toBeInTheDocument();
  });
});
