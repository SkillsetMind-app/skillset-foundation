import { act, cleanup, fireEvent, render, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import { LessonUploadProvider } from "@/components/teacher/lesson-upload-provider";
import type { CourseAsset } from "@/domain/course-asset";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToTeacherCourse, updateTeacherCourseBuilder } from "@/lib/data/teacher-courses";
import { fetchCourseAssets, uploadCourseAsset, uploadLessonVideoToBunny } from "@/lib/data/course-assets";
import { activateUploadedLessonVideo } from "@/lib/data/lesson-video-selection";

// Pagina da aula: Curso > Modulo > Aula, no lugar do modal. A aula mora na URL
// (?module=M&lesson=L), igual ao modulo (#373), e o voltar do navegador funciona.

const youtube = "https://www.youtube.com/watch?v=abc";
const vimeo = "https://vimeo.com/123456";

const mocks = vi.hoisted(() => ({
  onAuthChange: null as ((event: string, session: { user: { id: string } } | null) => void) | null,
  bunnyConfigured: false,
  course: null as TeacherCourse | null,
  // Lista de arquivos do curso: a busca do builder e o realtime do estudio.
  assets: [] as CourseAsset[],
  user: { uid: "teacher-1" },
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  searchParams: new URLSearchParams("courseId=course-1&tab=content"),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourse: vi.fn((_id: string, onData: (course: TeacherCourse | null) => void) => {
    onData(mocks.course);
    return () => undefined;
  }),
  publishTeacherCourse: vi.fn(() => Promise.resolve()),
  updateTeacherCourseBuilder: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (_uid: string, onData: (profile: unknown) => void) => {
    onData({ creatorVerificationStatus: "none", currentPlanId: "free" });
    return () => undefined;
  },
}));

vi.mock("@/lib/data/creator-verification", () => ({
  fetchRequireCreatorVerification: () => Promise.resolve(false),
}));

vi.mock("@/lib/data/course-assets", () => ({
  CourseAssetUploadCancelled: class CourseAssetUploadCancelled extends Error {},
  deleteCourseAsset: vi.fn(),
  fetchCourseAssets: vi.fn(() => Promise.resolve(mocks.assets)),
  subscribeToCourseAssets: (_id: string, onAssets: (assets: CourseAsset[]) => void) => {
    onAssets(mocks.assets);
    return () => undefined;
  },
  syncLessonPreviewAssets: () => Promise.resolve(),
  uploadCourseAsset: vi.fn(),
  uploadLessonVideoToBunny: vi.fn(),
}));

vi.mock("@/lib/bunny/config", () => ({
  get isBunnyConfigured() { return mocks.bunnyConfigured; },
}));
vi.mock("@/lib/data/lesson-video-selection", () => ({ activateUploadedLessonVideo: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: {
  onAuthStateChange: (callback: NonNullable<typeof mocks.onAuthChange>) => {
    mocks.onAuthChange = callback;
    return { data: { subscription: { unsubscribe: () => { mocks.onAuthChange = null; } } } };
  },
} }) }));
vi.mock("@/components/teacher/course-asset-uploader", () => ({ CourseAssetUploader: () => null }));
vi.mock("@/components/courses/bunny-video-player", () => ({ BunnyVideoPlayer: () => null }));
vi.mock("@/components/shared/protected-asset-preview", () => ({ ProtectedAssetPreview: () => null }));
vi.mock("@/components/learn/trusted-embed-player", () => ({ TrustedEmbedPlayer: () => null }));

function courseFixture(): TeacherCourse {
  return {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Clinical performance foundations",
    summary: "Build a repeatable practice for evidence-informed performance work.",
    category: "Applied Psychology & Behavior",
    categories: ["Applied Psychology & Behavior"],
    status: "draft",
    modules: [
      {
        id: "m1",
        title: "Start here",
        lessons: [
          { id: "l1", title: "Welcome", type: "video", description: "", videoSource: "youtube", externalUrl: youtube },
        ],
      },
      { id: "m2", title: "Deep work", lessons: [] },
    ],
    lessonCount: 1,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
  };
}

// Curso com uma aula sem conteudo nenhum (Intro): so um arquivo enviado conta.
function withIntro(): TeacherCourse {
  const course = courseFixture();
  course.modules[0].lessons.push({ id: "l2", title: "Intro", type: "video", description: "" });
  return course;
}

function introVideo(): CourseAsset {
  return {
    id: "asset-intro",
    courseId: "course-1",
    ownerId: "teacher-1",
    kind: "lesson_video",
    fileName: "aula.mp4",
    contentType: "video/mp4",
    size: 1024,
    storagePath: "courses/course-1/aula.mp4",
    isPreview: false,
    lessonId: "l2",
  };
}

const introUrl = "/teach/builder?courseId=course-1&tab=content&module=m1&lesson=l2";
const missingIntro = /Missing: Intro\./;

const moduleUrl = "/teach/builder?courseId=course-1&tab=content&module=m1";
const lessonUrl = "/teach/builder?courseId=course-1&tab=content&module=m1&lesson=l1";

let view: RenderResult;

function tree() {
  return (
    <I18nProvider initialLocale="en">
      <LessonUploadProvider><CourseBuilderStudio /></LessonUploadProvider>
    </I18nProvider>
  );
}

function openAt(url: string) {
  mocks.searchParams = new URL(url, "https://example.test").searchParams;
}

// O navegador trocou a URL (clique, voltar/avancar): o builder re-renderiza
// com os parametros novos, sem desmontar.
function navigateTo(url: string) {
  openAt(url);
  view.rerender(tree());
}

async function renderBuilder() {
  view = render(tree());
  await screen.findByRole("heading", { name: "Clinical performance foundations" });
}

const card = () => document.querySelector("#builder-sec-modules") as HTMLElement;

function startUpload() {
  fireEvent.change(screen.getByLabelText("Upload a lesson video"), {
    target: { files: [new File(["video-bytes"], "aula.mp4", { type: "video/mp4" })] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
}
const linkField = () => screen.getByRole("textbox", { name: "YouTube or Vimeo URL" });
const lastPayload = () => vi.mocked(updateTeacherCourseBuilder).mock.calls.at(-1)?.[1];

describe("pagina da aula no builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bunnyConfigured = false;
    mocks.course = courseFixture();
    mocks.assets = [];
    openAt("/teach/builder?courseId=course-1&tab=content");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps upload status and original lesson persistence after the entire editor unmounts", async () => {
    mocks.course = withIntro();
    mocks.bunnyConfigured = true;
    let finish!: (assetId: string) => void;
    vi.mocked(uploadLessonVideoToBunny).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    openAt(introUrl);
    await renderBuilder();
    startUpload();
    view.rerender(<I18nProvider initialLocale="en"><LessonUploadProvider><h1>Another page</h1></LessonUploadProvider></I18nProvider>);
    expect(screen.queryByRole("heading", { name: "Intro" })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Lesson upload" })).toHaveTextContent("Uploading file...");
    await act(async () => finish("asset-intro"));
    expect(activateUploadedLessonVideo).toHaveBeenCalledWith("course-1", "l2", "asset-intro", expect.any(Function));
    expect(screen.getByRole("complementary", { name: "Lesson upload" })).toHaveTextContent("File saved.");
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  });

  it("shows an upload error after leaving the editor", async () => {
    mocks.course = withIntro();
    mocks.bunnyConfigured = true;
    let fail!: (error: Error) => void;
    vi.mocked(uploadLessonVideoToBunny).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    openAt(introUrl);
    await renderBuilder();
    startUpload();
    view.rerender(<I18nProvider initialLocale="en"><LessonUploadProvider><h1>Another page</h1></LessonUploadProvider></I18nProvider>);
    await act(async () => fail(new Error("network")));
    expect(screen.getByRole("alert")).toHaveTextContent("Upload needs attention.");
    expect(activateUploadedLessonVideo).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Open lesson" })).toHaveAttribute("href", introUrl);
  });

  it.each([false, true])("bounds the panel and hides cancellation without an abort callback (Bunny entry: %s)", async (bunnyConfigured) => {
    mocks.course = withIntro();
    mocks.bunnyConfigured = bunnyConfigured;
    const transport = bunnyConfigured ? uploadLessonVideoToBunny : uploadCourseAsset;
    let finish!: (assetId: string) => void;
    vi.mocked(transport).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    openAt(introUrl);
    await renderBuilder();
    startUpload();
    const panel = screen.getByRole("complementary", { name: "Lesson upload" });
    expect(panel).toHaveClass("max-h-[calc(100svh-2rem)]", "overflow-y-auto");
    expect(screen.queryByRole("button", { name: /Cancel upload/i })).not.toBeInTheDocument();
    if (bunnyConfigured) {
      act(() => vi.mocked(uploadLessonVideoToBunny).mock.calls[0][0].onCancelAvailable?.(vi.fn()));
      expect(within(panel).getByRole("button", { name: "Cancel upload" })).toBeInTheDocument();
    }
    await act(async () => finish("asset-intro"));
  });

  it("successful connection retry clears the lesson error and file and refreshes readiness without reuploading", async () => {
    mocks.course = withIntro();
    vi.mocked(uploadCourseAsset).mockResolvedValueOnce("asset-intro");
    vi.mocked(activateUploadedLessonVideo).mockRejectedValueOnce(new Error("connection failed"));
    openAt(introUrl);
    await renderBuilder();
    startUpload();
    await waitFor(() => expect(within(card()).getByRole("alert")).toBeInTheDocument());
    const callsBeforeRetry = vi.mocked(fetchCourseAssets).mock.calls.length;
    mocks.assets = [introVideo()];
    fireEvent.click(screen.getByRole("button", { name: "Retry saving" }));
    await waitFor(() => expect(within(card()).queryByRole("alert")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText(missingIntro)).not.toBeInTheDocument());
    expect(vi.mocked(fetchCourseAssets).mock.calls.length).toBeGreaterThan(callsBeforeRetry);
    expect(screen.getByRole("button", { name: "Upload file" })).toBeDisabled();
    expect(uploadCourseAsset).toHaveBeenCalledTimes(1);
    expect(activateUploadedLessonVideo).toHaveBeenCalledTimes(2);
  });

  it("does not lock or update another course reached through history", async () => {
    mocks.course = withIntro();
    mocks.bunnyConfigured = true;
    let finish!: (assetId: string) => void;
    vi.mocked(uploadLessonVideoToBunny).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    openAt(introUrl);
    await renderBuilder();
    startUpload();
    mocks.course = { ...withIntro(), id: "course-2", title: "Another course" };
    navigateTo("/teach/builder?courseId=course-2&tab=content");
    await screen.findByRole("heading", { name: "Another course" });
    mocks.router.push.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /^Continue to/ }));
    expect(mocks.router.push).toHaveBeenCalled();
    await act(async () => finish("asset-intro"));
    expect(activateUploadedLessonVideo).toHaveBeenCalledWith("course-1", "l2", "asset-intro", expect.any(Function));
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  });

  it("invalidates upload on the raw sign-out event before auth context updates", async () => {
    mocks.course = withIntro();
    mocks.bunnyConfigured = true;
    let finish!: (assetId: string) => void;
    vi.mocked(uploadLessonVideoToBunny).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    openAt(introUrl);
    await renderBuilder();
    startUpload();
    act(() => mocks.onAuthChange?.("SIGNED_OUT", null));
    expect(screen.queryByRole("complementary", { name: "Lesson upload" })).not.toBeInTheDocument();
    await act(async () => finish("asset-intro"));
    expect(activateUploadedLessonVideo).not.toHaveBeenCalled();
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  });

  it.each([false, true].flatMap((bunnyConfigured) => [
    "/teach/builder",
    "/teach/builder?courseId=course-2&tab=content",
    "/teach/builder?courseId=course-1&tab=content&module=m2",
  ].map((href) => ({ bunnyConfigured, href }))))("upload blocks navigation to $href (Bunny: $bunnyConfigured)", async ({ bunnyConfigured, href }) => {
    const previousUrl = window.location.href;
    window.history.replaceState(null, "", introUrl);
    try {
      mocks.course = withIntro();
      mocks.bunnyConfigured = bunnyConfigured;
      const transport = bunnyConfigured ? uploadLessonVideoToBunny : uploadCourseAsset;
      vi.mocked(transport).mockImplementationOnce(() => new Promise<string>(() => {}));
      const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
      openAt(introUrl);
      await renderBuilder();
      startUpload();

      const leave = document.createElement("a");
      leave.href = href;
      view.container.appendChild(leave);
      expect(fireEvent.click(leave)).toBe(false);
      expect(alert).toHaveBeenCalledOnce();
      expect(screen.getByRole("heading", { name: "Intro" })).toBeInTheDocument();
      expect(transport).toHaveBeenCalledTimes(1);
      expect(bunnyConfigured ? uploadCourseAsset : uploadLessonVideoToBunny).not.toHaveBeenCalled();

      alert.mockClear();
      leave.target = "_blank";
      expect(fireEvent.click(leave)).toBe(true);
      expect(alert).not.toHaveBeenCalled();
    } finally {
      window.history.replaceState(null, "", previousUrl);
    }
  });

  it("?module=M&lesson=L mostra Curso > Modulo > Aula e a aba de video, sem dialogo", async () => {
    openAt(lessonUrl);
    await renderBuilder();

    const trail = within(card()).getByRole("navigation", { name: "Breadcrumb" });
    expect(within(trail).getByRole("link", { name: "Clinical performance foundations" }))
      .toHaveAttribute("href", "/teach/builder?courseId=course-1&tab=content");
    expect(within(trail).getByRole("link", { name: "Start here" })).toHaveAttribute("href", moduleUrl);
    expect(within(trail).getByText("Welcome").closest("[aria-current='page']")).not.toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(linkField()).toHaveValue(youtube);
  });

  it("link digitado e ainda sem blur e gravado ao clicar no modulo da trilha", async () => {
    openAt(lessonUrl);
    await renderBuilder();
    fireEvent.change(linkField(), { target: { value: vimeo } });

    const trail = within(card()).getByRole("navigation", { name: "Breadcrumb" });
    fireEvent.click(within(trail).getByRole("link", { name: "Start here" }));
    navigateTo(moduleUrl);

    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalled(), { timeout: 5000 });
    expect(lastPayload()?.modules?.[0].lessons[0]).toEqual(
      expect.objectContaining({ id: "l1", externalUrl: vimeo, videoSource: "youtube" }),
    );
  }, 10000);

  it("voltar do navegador na aula leva a pagina do modulo com a edicao mantida", async () => {
    openAt(lessonUrl);
    await renderBuilder();
    fireEvent.change(linkField(), { target: { value: vimeo } });

    // Voltar: a URL perde o ?lesson, sem clique nenhum na pagina.
    navigateTo(moduleUrl);

    expect(within(card()).getByRole("heading", { name: "Start here" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "YouTube or Vimeo URL" })).not.toBeInTheDocument();
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalled(), { timeout: 5000 });
    expect(lastPayload()?.modules?.[0].lessons[0]).toEqual(
      expect.objectContaining({ id: "l1", externalUrl: vimeo }),
    );
  }, 10000);

  it("as entradas do antigo modal abrem a pagina: o botao da aula e a aula recem-criada", async () => {
    let emitCourse: (course: TeacherCourse | null) => void = () => {};
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emitCourse = emit;
      emit(mocks.course);
      return () => undefined;
    });
    openAt(moduleUrl);
    await renderBuilder();

    // Botao da aula na pagina do modulo.
    fireEvent.click(within(card()).getByRole("button", { name: "Edit content" }));
    expect(mocks.router.push).toHaveBeenLastCalledWith(lessonUrl, { scroll: false });
    navigateTo(lessonUrl);
    expect(within(card()).getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Aula nova: quando o eco confirma o save, a pagina dela abre sozinha.
    navigateTo(moduleUrl);
    fireEvent.click(within(card()).getByRole("button", { name: "Add lesson to module 1" }));
    const form = card().querySelector("form") as HTMLElement;
    fireEvent.change(within(form).getByRole("textbox", { name: "Lesson title" }), { target: { value: "Fresh" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add lesson" }));
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalled(), { timeout: 5000 });
    const saved = lastPayload();
    const freshId = saved?.modules?.[0].lessons[1]?.id;
    expect(freshId).toBeDefined();
    emitCourse({ ...(mocks.course as TeacherCourse), ...saved });
    await waitFor(() =>
      expect(mocks.router.push).toHaveBeenLastCalledWith(`${moduleUrl}&lesson=${freshId}`, { scroll: false }),
    );
  }, 10000);

  // Com o modal virando pagina, voltar/avancar ou outra aba desmontavam o
  // estudio no meio de um envio: o envio ficava sem dono e reabrir a aula
  // comecava outro.
  it.each([false, true])("envio segura a aula ao mudar parametros no mesmo editor (Bunny: %s)", async (bunnyConfigured) => {
    mocks.course = withIntro();
    mocks.bunnyConfigured = bunnyConfigured;
    const transport = bunnyConfigured ? uploadLessonVideoToBunny : uploadCourseAsset;
    let finishUpload: (assetId: string) => void = () => {};
    vi.mocked(transport).mockImplementationOnce(
      () => new Promise<string>((resolve) => { finishUpload = resolve; }),
    );
    openAt(introUrl);
    await renderBuilder();

    fireEvent.change(screen.getByLabelText("Upload a lesson video"), {
      target: { files: [new File(["video-bytes"], "aula.mp4", { type: "video/mp4" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
    expect(transport).toHaveBeenCalledTimes(1);

    // Voltar do navegador no meio do envio: a pagina da aula continua.
    navigateTo(moduleUrl);
    expect(screen.getByRole("heading", { name: "Intro" })).toBeInTheDocument();

    // Trocar de aba pelo rodape tambem nao acontece durante o envio.
    mocks.router.push.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /^Continue to/ }));
    expect(mocks.router.push).not.toHaveBeenCalled();

    // O envio acaba: a tela volta a seguir a URL, e nao ha segundo envio.
    await act(async () => finishUpload("asset-intro"));
    expect(within(card()).getByRole("heading", { name: "Start here" })).toBeInTheDocument();
    expect(transport).toHaveBeenCalledTimes(1);
  }, 10000);

  it("depois do envio a prontidao do Publish ve o arquivo, e Continue sai sem ?lesson", async () => {
    mocks.course = withIntro();
    let finishUpload: (assetId: string) => void = () => {};
    vi.mocked(uploadCourseAsset).mockImplementationOnce(
      () => new Promise<string>((resolve) => { finishUpload = resolve; }),
    );
    openAt(introUrl);
    await renderBuilder();
    expect((await screen.findAllByText(missingIntro)).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Upload a lesson video"), {
      target: { files: [new File(["video-bytes"], "aula.mp4", { type: "video/mp4" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
    mocks.assets = [introVideo()];
    await act(async () => finishUpload("asset-intro"));

    await waitFor(() => expect(screen.queryByText(missingIntro)).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Continue to/ }));
    const next = String(mocks.router.push.mock.calls.at(-1)?.[0]);
    expect(next).not.toContain("lesson=");
  }, 10000);

  // O servidor nao cobra conteudo na aula: com a lista velha, o Publish
  // publicava uma aula vazia depois de apagar o unico video dela.
  it("apagar o video na pagina da aula tira a aula da prontidao do Publish", async () => {
    mocks.course = withIntro();
    mocks.assets = [introVideo()];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    openAt(introUrl);
    await renderBuilder();
    await waitFor(() => expect(fetchCourseAssets).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByText(missingIntro)).not.toBeInTheDocument();

    mocks.assets = [];
    const file = screen
      .getAllByText("aula.mp4")
      .map((element) => element.closest("article"))
      .find((article): article is HTMLElement => article instanceof HTMLElement);
    fireEvent.click(within(file as HTMLElement).getByRole("button"));

    await waitFor(() => expect(screen.getAllByText(missingIntro).length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: "Publish product" })).toBeDisabled();
  }, 10000);

  // Sem a camada do antigo modal, a barra lateral ficou clicavel no meio de um
  // envio: sair desmontava o builder e o envio seguia sem dono.
  it("durante um envio, link para fora do builder nao navega", async () => {
    mocks.course = withIntro();
    vi.mocked(uploadCourseAsset).mockImplementationOnce(() => new Promise<string>(() => {}));
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    openAt(introUrl);
    await renderBuilder();
    startUpload();

    const leave = document.createElement("a");
    leave.href = "/teach";
    leave.textContent = "Courses";
    view.container.appendChild(leave);

    expect(fireEvent.click(leave)).toBe(false);
    expect(alert).toHaveBeenCalledOnce();
    expect(uploadCourseAsset).toHaveBeenCalledTimes(1);
  });

  // O erro caia na pagina da aula no mesmo instante em que ela saia da tela
  // (a URL ja estava no modulo): a falha ficava invisivel.
  it.each([false, true])("falha depois de mudar parametros mantem o erro na aula (Bunny: %s)", async (bunnyConfigured) => {
    mocks.course = withIntro();
    mocks.bunnyConfigured = bunnyConfigured;
    const transport = bunnyConfigured ? uploadLessonVideoToBunny : uploadCourseAsset;
    let failUpload: (error: Error) => void = () => {};
    vi.mocked(transport).mockImplementationOnce(
      () => new Promise<string>((_resolve, reject) => { failUpload = reject; }),
    );
    openAt(introUrl);
    await renderBuilder();
    startUpload();

    navigateTo(moduleUrl);
    await act(async () => failUpload(new Error("network")));

    expect(mocks.router.replace).toHaveBeenLastCalledWith(introUrl, { scroll: false });
    expect(screen.getByRole("heading", { name: "Intro" })).toBeInTheDocument();
    expect(within(card()).getByRole("alert")).toBeInTheDocument();
  });

  it("link direto na pagina da aula carrega a lista de arquivos do curso", async () => {
    mocks.course = withIntro();
    openAt(introUrl);
    await renderBuilder();

    // Sem a lista, o item "conteudo em toda aula" nem aparece; com ela, cobra a Intro.
    expect((await screen.findAllByText(missingIntro)).length).toBeGreaterThan(0);
  });

  it("entrar na pagina da aula foca o titulo dela", async () => {
    openAt(moduleUrl);
    await renderBuilder();

    fireEvent.click(within(card()).getByRole("button", { name: "Edit content" }));
    navigateTo(lessonUrl);

    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Welcome" }));
  });

  it("sair pelo Done troca a entrada do historico e devolve o foco ao botao da aula", async () => {
    openAt(moduleUrl);
    await renderBuilder();
    fireEvent.click(within(card()).getByRole("button", { name: "Edit content" }));
    navigateTo(lessonUrl);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(mocks.router.replace).toHaveBeenLastCalledWith(moduleUrl, { scroll: false });
    navigateTo(moduleUrl);

    expect(document.activeElement).toBe(within(card()).getByRole("button", { name: "Edit content" }));
  });
});
