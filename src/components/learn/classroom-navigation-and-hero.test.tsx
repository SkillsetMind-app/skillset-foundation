import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import { MembersAreaHero } from "@/components/learn/members-area-hero";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import type { ClassroomTab } from "@/domain/classroom-tabs";
import type { Course } from "@/domain/learning";
import type { CourseAsset } from "@/domain/course-asset";
import { subscribeToCourseAssets } from "@/lib/data/course-assets";
import { recordLessonProgress } from "@/lib/data/lesson-progress";

/**
 * P2/P4 da paridade com a Hotmart (§4.2 e §4.3 do relatorio de 2026-09-06):
 *   - anterior / proxima junto do titulo da aula, uma vez so, sem burlar o
 *     cadeado;
 *   - "Tocando agora" na playlist, so no item atual;
 *   - "Informacoes da aula" sob o player (tipo, duracao, modulo, materiais);
 *   - "N de M aulas · X%" e "Ver certificado" (so a 100%) no hero da home.
 *
 * Arquivo proprio: classroom-home.test.tsx ja e pesado e um arquivo grande
 * estoura a RAM. Os mocks sao os MESMOS de la — em especial o `auth` unico
 * por sessao (um objeto novo por render reinscreve a matricula em laco).
 */

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  pathname: "/learn/courses/demo-course",
  replace: vi.fn(),
  completed: [] as string[],
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

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToPublicProfile: vi.fn(() => vi.fn()),
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

vi.mock("@/lib/data/community-posts", () => ({
  countOpenCommunityQuestions: vi.fn(() => new Promise<number>(() => {})),
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

vi.mock("@/components/learn/course-messages-panel", () => ({
  CourseMessagesPanel: () => <div data-testid="messages-panel" />,
}));
vi.mock("@/components/learn/course-review-panel", () => ({
  CourseReviewPanel: () => <div data-testid="review-panel" />,
}));
vi.mock("@/components/learn/community-feed", () => ({
  CommunityFeed: () => <div data-testid="community-feed" />,
}));
// O anexo da aula abre um preview protegido (URL assinada). Nao e o alvo
// daqui: so a contagem importa.
vi.mock("@/components/shared/protected-asset-preview", () => ({
  ProtectedAssetPreview: () => null,
}));

// Tres aulas em dois modulos: da para testar "primeira" (sem anterior),
// "ultima" (sem proxima) e a troca de modulo no meio.
const course = {
  id: "course-1",
  slug: "demo-course",
  title: "Demo course",
  category: "Leadership",
  summary: "A demo course.",
  durationLabel: "2h",
  image: null,
  membersTheme: "dark",
  communityEnabled: false,
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
    {
      id: "m2",
      title: "Module two",
      summary: "",
      lessons: [
        { id: "l3", title: "Lesson three", type: "text", duration: "9 min", isPreview: false, contentText: "Three" },
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
  props: Partial<Parameters<typeof EnrolledCourseWorkspace>[0]> = {},
) {
  const tab: ClassroomTab = props.tab ?? "lesson";
  mocks.searchParams = new URLSearchParams(search);
  mocks.pathname =
    tab === "lesson" ? "/learn/courses/demo-course" : `/learn/courses/demo-course/${tab}`;
  mocks.completed = completed;
  return render(<EnrolledCourseWorkspace course={course} {...props} />);
}

function head() {
  const element = document.querySelector(".member-classroom-head");
  if (!element) throw new Error("cabecalho curto da aula nao renderizou");
  return element as HTMLElement;
}

function playlist() {
  return screen.getByRole("navigation", { name: "Lessons" });
}

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.pathname = "/learn/courses/demo-course";
  mocks.enrollmentSubscriptions = 0;
  vi.mocked(recordLessonProgress).mockClear();
  Element.prototype.scrollIntoView = vi.fn();
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  };
});

describe("anterior / proxima junto do titulo", () => {
  it("troca de aula pelo cabecalho, grava a aula no endereco e move o destaque da playlist", () => {
    renderClassroom("lesson=l1");

    const previous = within(head()).getByRole("button", { name: "Previous lesson" });
    const next = within(head()).getByRole("button", { name: "Next lesson: Lesson two" });
    expect(previous).toHaveAttribute("aria-disabled", "true");
    expect(next).not.toHaveAttribute("aria-disabled");

    // Desabilitado nao e "some": segue focavel, so nao faz nada.
    fireEvent.click(previous);
    expect(mocks.replace).not.toHaveBeenCalled();

    fireEvent.click(next);
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
      "/learn/courses/demo-course?lesson=l2",
      { scroll: false },
    );
    expect(within(playlist()).getByRole("button", { name: /Lesson two/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    // Na aula 2 os dois vizinhos existem — inclusive a proxima, que esta no
    // outro modulo (a ordem e a do curso inteiro, nao a do modulo).
    expect(within(head()).getByRole("button", { name: "Previous lesson: Lesson one" })).not.toHaveAttribute("aria-disabled");
    expect(within(head()).getByRole("button", { name: "Next lesson: Lesson three" })).not.toHaveAttribute("aria-disabled");
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });

  it("nunca burla o cadeado: a proxima bloqueada fica desabilitada e o clique nao abre nada", () => {
    renderClassroom("lesson=l1", [], { course: { ...course, dripStrategy: "sequential_progress" } });

    const next = within(head()).getByRole("button", { name: "Next lesson: Lesson two" });
    expect(next).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(next);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(within(playlist()).getByRole("button", { name: /Lesson one/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("na ultima aula 'proxima' desabilita, e o 'anterior' solto da barra inferior sumiu", () => {
    renderClassroom("lesson=l3", ["l1", "l2"]);

    expect(within(head()).getByRole("button", { name: "Next lesson" })).toHaveAttribute("aria-disabled", "true");
    expect(within(head()).getByRole("button", { name: "Previous lesson: Lesson two" })).not.toHaveAttribute("aria-disabled");
    // Um so "anterior" na sala inteira (antes: outro, com "← titulo", sob o video).
    expect(screen.getAllByRole("button", { name: /^Previous lesson/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^← / })).toBeNull();
  });

  it("fora da aba da aula o cabecalho nao tem setas (elas trocam a aula, nao a aba)", () => {
    renderClassroom("lesson=l2", [], { tab: "review" });

    expect(within(head()).queryByRole("button", { name: /lesson/i })).toBeNull();
  });
});

describe("Tocando agora na playlist", () => {
  it("so no item atual, em EN e ES, mantendo aria-current e sem reinscrever", () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    mocks.completed = [];
    render(
      <I18nProvider initialLocale="en">
        <ChangeLanguage />
        <EnrolledCourseWorkspace course={course} />
      </I18nProvider>,
    );

    const list = playlist();
    expect(within(list).getAllByText("Playing now")).toHaveLength(1);
    const current = list.querySelector(".member-playlist__lesson.is-current") as HTMLElement;
    expect(within(current).getByText("Playing now")).toBeInTheDocument();
    expect(within(current).getByRole("button", { name: /Lesson two/ })).toHaveAttribute("aria-current", "true");
    expect(within(list).getByRole("button", { name: /Lesson one/ })).not.toHaveAttribute("aria-current");

    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(within(list).getAllByText("Reproduciendo ahora")).toHaveLength(1);
    expect(within(list).queryByText("Playing now")).toBeNull();
    expect(within(current).getByRole("button", { name: /Lesson two/ })).toHaveAttribute("aria-current", "true");
    expect(mocks.enrollmentSubscriptions).toBe(1);
  });
});

describe("Informacoes da aula sob o player", () => {
  it("abre e fecha com aria-expanded e mostra tipo, duracao e modulo", () => {
    renderClassroom("lesson=l2");

    const toggle = screen.getByRole("button", { name: "Lesson information" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Fechado = fora do DOM (uma copia oculta duplicaria "Text lesson", que o
    // cabecalho do painel ja mostra) — e sem aria-controls para um id que
    // nao existe.
    expect(toggle).not.toHaveAttribute("aria-controls");
    expect(document.getElementById("member-lesson-info")).toBeNull();
    expect(screen.getAllByText("Text lesson")).toHaveLength(1);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", "member-lesson-info");
    const panel = document.getElementById("member-lesson-info") as HTMLElement;
    expect(panel).toBeInTheDocument();
    expect(within(panel).getByText("Text lesson")).toBeInTheDocument();
    expect(within(panel).getByText("7 min")).toBeInTheDocument();
    expect(within(panel).getByText("Module one")).toBeInTheDocument();
    // Sem arquivos de curso (catalogo) e sem gotejamento por data, essas
    // linhas nao existem — nada de "0 files" nem data vazia.
    expect(within(panel).queryByText("Materials")).toBeNull();
    expect(within(panel).queryByText("Available from")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("member-lesson-info")).toBeNull();
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });

  it("com arquivos do curso, conta so os materiais da aula (miniatura nao conta)", () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    mocks.completed = [];
    let emit!: (assets: CourseAsset[]) => void;
    vi.mocked(subscribeToCourseAssets).mockImplementationOnce((_id, callback) => {
      emit = callback;
      return vi.fn();
    });
    render(<EnrolledCourseWorkspace course={course} enableFirestoreAssets />);
    const asset = (patch: Partial<CourseAsset>): CourseAsset => ({
      id: "file", courseId: course.id, ownerId: "teacher-1", lessonId: "l2",
      kind: "lesson_material", fileName: "Worksheet.pdf", contentType: "application/pdf",
      size: 512, storagePath: "courses/course-1/assets/file.pdf", isPreview: false, ...patch,
    });
    act(() => emit([
      asset({}),
      asset({ id: "thumb", kind: "lesson_thumbnail", fileName: "thumb.png", contentType: "image/png" }),
      asset({ id: "other-lesson", lessonId: "l1" }),
    ]));

    fireEvent.click(screen.getByRole("button", { name: "Lesson information" }));
    const panel = document.getElementById("member-lesson-info") as HTMLElement;
    expect(within(panel).getByText("Materials")).toBeInTheDocument();
    expect(within(panel).getByText("1 file")).toBeInTheDocument();
  });
});

describe("hero da home do curso", () => {
  it("mostra 'N de M aulas · X%' e o certificado so a 100%; sem contagens fica como era", () => {
    const { rerender, container } = render(
      <MembersAreaHero theme="dark" title="Course" progressPercent={25}
        completedCount={3} totalCount={12} certificateHref="/learn/credentials" />,
    );
    expect(screen.getByText("3 of 12 lessons · 25%")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View certificate" })).toBeNull();

    rerender(
      <MembersAreaHero theme="dark" title="Course" progressPercent={100}
        completedCount={12} totalCount={12} certificateHref="/learn/credentials" />,
    );
    expect(screen.getByText("12 of 12 lessons · 100%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View certificate" })).toHaveAttribute("href", "/learn/credentials");

    // Sem destino (whitelabel) nada aparece, mesmo a 100%.
    rerender(
      <MembersAreaHero theme="dark" title="Course" progressPercent={100}
        completedCount={12} totalCount={12} />,
    );
    expect(screen.queryByRole("link", { name: "View certificate" })).toBeNull();

    // Sem as contagens: identico ao de hoje.
    rerender(<MembersAreaHero theme="dark" title="Course" progressPercent={42} />);
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText("complete")).toBeInTheDocument();
    expect(container.querySelector(".members-hero__cta")).toBeNull();
  });

  it("na sala, o hero le o progresso ja calculado e o certificado reusa /learn/credentials", () => {
    const { unmount } = renderClassroom("");
    expect(screen.getByText("0 of 3 lessons · 0%")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View certificate" })).toBeNull();
    unmount();

    renderClassroom("lesson=l3", ["l1", "l2", "l3"], { tab: "about" });
    expect(screen.getByText("3 of 3 lessons · 100%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View certificate" })).toHaveAttribute("href", "/learn/credentials");
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });

  it("whitelabel: nenhum certificado no hero mesmo a 100% (nada leva de volta a plataforma)", () => {
    renderClassroom("lesson=l3", ["l1", "l2", "l3"], { tab: "about", whitelabel: true });

    expect(screen.getByText("3 of 3 lessons · 100%")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /certificate/i })).toBeNull();
  });
});

describe("EN <-> ES com a sala aberta", () => {
  it("traduz setas, badge e informacoes sem trocar de aula, fechar o painel ou reinscrever", () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    mocks.completed = [];
    render(
      <I18nProvider initialLocale="en">
        <ChangeLanguage />
        <EnrolledCourseWorkspace course={course} />
      </I18nProvider>,
    );

    const toggle = screen.getByRole("button", { name: "Lesson information" });
    fireEvent.click(toggle);
    expect(within(head()).getByRole("button", { name: "Next lesson: Lesson three" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(within(head()).getByRole("button", { name: "Siguiente lección: Lesson three" })).toBeInTheDocument();
    expect(within(head()).getByRole("button", { name: "Lección anterior: Lesson one" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Información de la lección" })).toBe(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById("member-lesson-info") as HTMLElement;
    expect(within(panel).getByText("Duración")).toBeInTheDocument();
    expect(within(panel).getByText("Lección de texto")).toBeInTheDocument();
    // Titulo do modulo e do autor: nao se traduz.
    expect(within(panel).getByText("Module one")).toBeInTheDocument();
    expect(screen.getByText("Reproduciendo ahora")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(within(head()).getByRole("button", { name: "Next lesson: Lesson three" })).toBeInTheDocument();
    expect(screen.getByText("Playing now")).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.enrollmentSubscriptions).toBe(1);
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });
});
