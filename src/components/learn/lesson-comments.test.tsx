import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import type { CommunityComment, CommunityPost } from "@/domain/community-post";
import type { Course } from "@/domain/learning";
import {
  countOpenCommunityQuestions,
  createCommunityPost,
  subscribeToCommunityPosts,
  subscribeToCourseCommunityComments,
} from "@/lib/data/community-posts";
import { recordLessonProgress } from "@/lib/data/lesson-progress";

/**
 * P3 da paridade com a Hotmart (§4.3 do relatorio de 2026-09-06): comentarios
 * da aula SOB o player, reusando o feed da comunidade filtrado pela aula:
 *   - so os posts desta aula, com contagem no titulo, autor, hora relativa,
 *     numero de respostas e "Ver na comunidade" (a gaveta do post);
 *   - trocar de aula troca a lista sem reabrir o canal (um canal por curso);
 *   - comunidade desligada esconde a secao; preview desabilita a caixa;
 *   - publicar e o MESMO caminho da pergunta com aula anexada (createCommunityPost
 *     com lessonId e "lesson N"); erros ficam como chave e traduzem;
 *   - EN e ES.
 *
 * Arquivo proprio: classroom-home.test.tsx ja e pesado. Os mocks sao os
 * MESMOS de la — em especial o `auth` unico por sessao (um objeto novo por
 * render reinscreve a matricula em laco) e o fusivel das inscricoes.
 */

const HOUR = 3_600_000;

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
  postSubscriptions: 0,
  postsCallback: null as null | ((posts: CommunityPost[]) => void),
  commentsCallback: null as null | ((comments: CommunityComment[]) => void),
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

// A MESMA fonte do feed: as inscricoes por curso de community-posts.ts. O
// teste entrega os posts pelo callback, como o Supabase faria; o fusivel
// pega um laco de reinscricao antes de a maquina travar.
vi.mock("@/lib/data/community-posts", () => ({
  countOpenCommunityQuestions: vi.fn(() => new Promise<number>(() => {})),
  subscribeToCommunityPosts: vi.fn(
    (_slug: string, onNext: (posts: CommunityPost[]) => void) => {
      mocks.postSubscriptions += 1;
      if (mocks.postSubscriptions > 20) {
        throw new Error("subscribeToCommunityPosts chamado mais de 20 vezes: laco de render");
      }
      mocks.postsCallback = onNext;
      return vi.fn();
    },
  ),
  subscribeToCourseCommunityComments: vi.fn(
    (_slug: string, onNext: (comments: CommunityComment[]) => void) => {
      mocks.commentsCallback = onNext;
      return vi.fn();
    },
  ),
  createCommunityPost: vi.fn(() => Promise.resolve({ id: "post-new" })),
}));

vi.mock("@/lib/data/course-events", () => ({
  subscribeToCourseEvents: vi.fn(() => vi.fn()),
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
vi.mock("@/components/shared/protected-asset-preview", () => ({
  ProtectedAssetPreview: () => null,
}));

const course = {
  id: "course-1",
  slug: "demo-course",
  title: "Demo course",
  category: "Leadership",
  summary: "A demo course.",
  durationLabel: "2h",
  image: null,
  membersTheme: "dark",
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

function post(overrides: Partial<CommunityPost>): CommunityPost {
  return {
    id: "p",
    courseSlug: "course-1",
    authorId: "student-2",
    authorName: "Carla Souza",
    authorRole: "student",
    category: "question",
    body: "",
    // 2 h e uns minutos: "2h ago" mesmo que o teste demore.
    createdAt: new Date(Date.now() - 2 * HOUR - 5 * 60_000).toISOString(),
    ...overrides,
  };
}

// Uma pergunta na aula 1, uma na aula 2, um compartilhamento sem aula.
const posts: CommunityPost[] = [
  post({ id: "q-l1", title: "Where is the template for step 3?", lessonId: "l1", lessonTitle: "lesson 1" }),
  post({
    id: "q-l2",
    authorId: "student-3",
    authorName: "Lucas Melo",
    title: "Does the checklist apply to remote teams?",
    lessonId: "l2",
    lessonTitle: "lesson 2",
    createdAt: new Date(Date.now() - 26 * HOUR).toISOString(),
  }),
  post({
    id: "share",
    category: "discussion",
    body: "The honest-scarcity checklist saved a launch this week.",
    lessonId: null,
  }),
];

const comments: CommunityComment[] = [
  {
    id: "c1", postId: "q-l1", courseSlug: "course-1", authorId: "teacher-1", authorName: "Ana Prof",
    authorRole: "teacher", body: "Module resources, second file.",
    createdAt: new Date(Date.now() - HOUR).toISOString(),
  },
  {
    id: "c2", postId: "q-l1", courseSlug: "course-1", authorId: "student-2", authorName: "Carla Souza",
    authorRole: "student", body: "Found it, thanks!",
    createdAt: new Date(Date.now() - HOUR / 2).toISOString(),
  },
];

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}

function renderClassroom(
  search: string,
  props: Partial<Parameters<typeof EnrolledCourseWorkspace>[0]> = {},
) {
  mocks.searchParams = new URLSearchParams(search);
  mocks.pathname = "/learn/courses/demo-course";
  mocks.completed = [];
  return render(<EnrolledCourseWorkspace course={course} {...props} />);
}

function deliverFeed() {
  act(() => {
    mocks.postsCallback?.(posts);
    mocks.commentsCallback?.(comments);
  });
}

function head() {
  const element = document.querySelector(".member-classroom-head");
  if (!element) throw new Error("cabecalho curto da aula nao renderizou");
  return element as HTMLElement;
}

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.enrollmentSubscriptions = 0;
  mocks.postSubscriptions = 0;
  mocks.postsCallback = null;
  mocks.commentsCallback = null;
  vi.mocked(recordLessonProgress).mockClear();
  vi.mocked(countOpenCommunityQuestions).mockClear();
  vi.mocked(createCommunityPost).mockClear();
  vi.mocked(subscribeToCommunityPosts).mockClear();
  vi.mocked(subscribeToCourseCommunityComments).mockClear();
  Element.prototype.scrollIntoView = vi.fn();
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  };
});

describe("comentarios da aula sob o player", () => {
  it("mostra so os posts desta aula, com contagem, autor, hora, respostas e o link para a gaveta", () => {
    renderClassroom("lesson=l1");

    // Enquanto o feed nao chega: titulo sem numero e "carregando".
    const loading = screen.getByRole("region", { name: "Lesson comments" });
    expect(within(loading).getByText("Loading lesson comments...")).toBeInTheDocument();
    expect(subscribeToCommunityPosts).toHaveBeenCalledExactlyOnceWith(
      "course-1", expect.any(Function), expect.any(Function),
    );
    expect(subscribeToCourseCommunityComments).toHaveBeenCalledExactlyOnceWith(
      "course-1", expect.any(Function), expect.any(Function),
    );

    deliverFeed();

    const region = screen.getByRole("region", { name: "Lesson comments · 1" });
    expect(within(region).getByText("Carla Souza")).toBeInTheDocument();
    expect(within(region).getByText("Where is the template for step 3?")).toBeInTheDocument();
    expect(within(region).getByText(/2h ago/)).toBeInTheDocument();
    expect(within(region).getByText("2 replies")).toBeInTheDocument();
    expect(within(region).getByRole("link", { name: "View in community" })).toHaveAttribute(
      "href",
      "/learn/courses/demo-course/community/q/q-l1?lesson=l1",
    );
    // A pergunta da outra aula e o compartilhamento sem aula ficam de fora.
    expect(within(region).queryByText("Does the checklist apply to remote teams?")).toBeNull();
    expect(within(region).queryByText(/honest-scarcity/)).toBeNull();
    // Sem respostas inline, sem curtidas: isso segue no feed.
    expect(within(region).queryByText("Found it, thanks!")).toBeNull();
    expect(within(region).queryByRole("button", { name: /reply|clap|👏/i })).toBeNull();

    // Posicao: depois de "Informacoes da aula", antes do corpo da aula.
    const info = screen.getByRole("button", { name: "Lesson information" });
    const body = document.getElementById("member-lesson-content") as HTMLElement;
    expect(info.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // O contador da aba Community nao muda: uma leitura, a de sempre.
    expect(countOpenCommunityQuestions).toHaveBeenCalledExactlyOnceWith("course-1");
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });

  it("trocar de aula troca a lista sem reabrir o canal (um canal por curso)", () => {
    renderClassroom("lesson=l1");
    deliverFeed();
    expect(screen.getByRole("region", { name: "Lesson comments · 1" })).toBeInTheDocument();

    fireEvent.click(within(head()).getByRole("button", { name: "Next lesson: Lesson two" }));

    const region = screen.getByRole("region", { name: "Lesson comments · 1" });
    expect(within(region).getByText("Lucas Melo")).toBeInTheDocument();
    expect(within(region).getByText("Does the checklist apply to remote teams?")).toBeInTheDocument();
    expect(within(region).getByText("0 replies")).toBeInTheDocument();
    expect(within(region).queryByText("Where is the template for step 3?")).toBeNull();
    expect(within(region).getByRole("link", { name: "View in community" })).toHaveAttribute(
      "href",
      "/learn/courses/demo-course/community/q/q-l2?lesson=l2",
    );
    expect(subscribeToCommunityPosts).toHaveBeenCalledTimes(1);
    expect(subscribeToCourseCommunityComments).toHaveBeenCalledTimes(1);
    expect(countOpenCommunityQuestions).toHaveBeenCalledTimes(1);
    expect(mocks.enrollmentSubscriptions).toBe(1);
  });

  it("comunidade desligada no curso: a secao inteira some e nada e inscrito", () => {
    renderClassroom("lesson=l1", { course: { ...course, communityEnabled: false } });

    expect(screen.queryByRole("region", { name: /Lesson comments/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Comment on the lesson." })).toBeNull();
    expect(subscribeToCommunityPosts).not.toHaveBeenCalled();
    expect(subscribeToCourseCommunityComments).not.toHaveBeenCalled();
    // "Informacoes da aula" (#222) segue no lugar.
    expect(screen.getByRole("button", { name: "Lesson information" })).toBeInTheDocument();
  });

  it("preview do professor: caixa desabilitada com a porta do feed, sem inscricao e sem lista", () => {
    renderClassroom("lesson=l1", { previewMode: true });

    const region = screen.getByRole("region", { name: "Lesson comments" });
    expect(
      within(region).getByRole("button", { name: "This community is linked to course enrollment." }),
    ).toBeDisabled();
    expect(within(region).queryByRole("textbox")).toBeNull();
    expect(within(region).queryByText("Loading lesson comments...")).toBeNull();
    expect(within(region).queryByRole("link")).toBeNull();
    expect(subscribeToCommunityPosts).not.toHaveBeenCalled();
    expect(subscribeToCourseCommunityComments).not.toHaveBeenCalled();
    expect(createCommunityPost).not.toHaveBeenCalled();
  });

  it("publicar usa o mesmo caminho da pergunta com a aula anexada", async () => {
    renderClassroom("lesson=l1");
    deliverFeed();
    let resolve!: (value: { id: string }) => void;
    vi.mocked(createCommunityPost).mockReturnValueOnce(
      new Promise<{ id: string }>((done) => { resolve = done; }),
    );

    // Em repouso a caixa e um botao: nenhum textbox na aula.
    fireEvent.click(screen.getByRole("button", { name: "Comment on the lesson." }));
    const field = screen.getByRole("textbox", { name: "Your comment on this lesson" });
    expect(field).toHaveAttribute("placeholder", "Comment on the lesson.");

    // Curto demais: a mesma regra e a mesma mensagem do feed, nada publicado.
    fireEvent.change(field, { target: { value: "Short" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(
      screen.getByText("Write your question in one line first — at least a few words."),
    ).toBeInTheDocument();
    expect(createCommunityPost).not.toHaveBeenCalled();

    // Primeira linha = a pergunta (titulo do feed); o resto = detalhes.
    fireEvent.change(field, {
      target: { value: "Where is the template for step 3? $$50 $&\nI looked in the module resources." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(screen.getByRole("button", { name: "Posting…" })).toBeDisabled();
    expect(createCommunityPost).toHaveBeenCalledExactlyOnceWith({
      courseSlug: "course-1",
      category: "question",
      title: "Where is the template for step 3? $$50 $&",
      body: "I looked in the module resources.",
      lessonId: "l1",
      lessonTitle: "lesson 1",
      user: mocks.auth.user,
    });

    await act(async () => resolve({ id: "post-new" }));
    expect(screen.queryByRole("textbox", { name: "Your comment on this lesson" })).toBeNull();
    expect(screen.getByRole("button", { name: "Comment on the lesson." })).toBeInTheDocument();
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });

  it("erro de publicacao fica como chave e traduz; EN <-> ES sem trocar de aula nem reinscrever", async () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.pathname = "/learn/courses/demo-course";
    mocks.completed = [];
    render(
      <I18nProvider initialLocale="en">
        <ChangeLanguage />
        <EnrolledCourseWorkspace course={course} />
      </I18nProvider>,
    );
    deliverFeed();
    vi.mocked(createCommunityPost).mockRejectedValueOnce(new Error("private internal detail"));

    fireEvent.click(screen.getByRole("button", { name: "Comment on the lesson." }));
    const draft = "Is there a Portuguese version? $$ $&";
    fireEvent.change(screen.getByRole("textbox", { name: "Your comment on this lesson" }), {
      target: { value: draft },
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Comment" })); });
    expect(screen.getByText("We could not publish your post.")).toBeInTheDocument();
    expect(screen.queryByText("private internal detail")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByText("No pudimos publicar tu publicación.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Tu comentario sobre esta lección" })).toHaveValue(draft);
    const region = screen.getByRole("region", { name: "Comentarios de la lección · 1" });
    expect(within(region).getByRole("button", { name: "Comentar" })).toBeInTheDocument();
    expect(within(region).getByText("2 respuestas")).toBeInTheDocument();
    expect(within(region).getByText(/Hace 2 h/)).toBeInTheDocument();
    expect(within(region).getByRole("link", { name: "Ver en la comunidad" })).toHaveAttribute(
      "href",
      "/learn/courses/demo-course/community/q/q-l1?lesson=l1",
    );

    fireEvent.click(within(region).getByRole("button", { name: "Cancelar" }));
    expect(within(region).getByRole("button", { name: "Comenta algo sobre la lección." })).toBeInTheDocument();
    expect(within(region).queryByText("No pudimos publicar tu publicación.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("region", { name: "Lesson comments · 1" })).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.enrollmentSubscriptions).toBe(1);
    expect(subscribeToCommunityPosts).toHaveBeenCalledTimes(1);
    expect(createCommunityPost).toHaveBeenCalledTimes(1);
  });

  it("uma caixa so por aula (decisao 07/09): a antiga, da tabela lesson_comments, saiu", () => {
    renderClassroom("lesson=l1");
    deliverFeed();

    // Em repouso: nenhum textbox na aula e um so botao de comentar.
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: /comment/i })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Comment on the lesson." }));

    // Aberta: UM textbox e UM "Comment" — os da caixa nova, sob o player.
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /comment/i })).toHaveLength(1);
    // O bloco do fim do corpo (a caixa antiga) nao existe.
    expect(document.getElementById("member-lesson-discussion")).toBeNull();
  });
});
