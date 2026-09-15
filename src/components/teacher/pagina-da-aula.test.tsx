import { act, cleanup, fireEvent, render, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import type { CourseAsset } from "@/domain/course-asset";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToTeacherCourse, updateTeacherCourseBuilder } from "@/lib/data/teacher-courses";
import { fetchCourseAssets, uploadCourseAsset } from "@/lib/data/course-assets";

// Pagina da aula: Curso > Modulo > Aula, no lugar do modal. A aula mora na URL
// (?module=M&lesson=L), igual ao modulo (#373), e o voltar do navegador funciona.

const youtube = "https://www.youtube.com/watch?v=abc";
const vimeo = "https://vimeo.com/123456";

const mocks = vi.hoisted(() => ({
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

vi.mock("@/lib/bunny/config", () => ({ isBunnyConfigured: false }));
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
      <CourseBuilderStudio />
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
const linkField = () => screen.getByRole("textbox", { name: "YouTube or Vimeo URL" });
const lastPayload = () => vi.mocked(updateTeacherCourseBuilder).mock.calls.at(-1)?.[1];

describe("pagina da aula no builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.course = courseFixture();
    mocks.assets = [];
    openAt("/teach/builder?courseId=course-1&tab=content");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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
  it("envio em curso segura a pagina da aula no voltar e na troca de aba, e depois segue a URL", async () => {
    mocks.course = withIntro();
    let finishUpload: (assetId: string) => void = () => {};
    vi.mocked(uploadCourseAsset).mockImplementationOnce(
      () => new Promise<string>((resolve) => { finishUpload = resolve; }),
    );
    openAt(introUrl);
    await renderBuilder();

    fireEvent.change(screen.getByLabelText("Upload a lesson video"), {
      target: { files: [new File(["video-bytes"], "aula.mp4", { type: "video/mp4" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
    expect(uploadCourseAsset).toHaveBeenCalledTimes(1);

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
    expect(uploadCourseAsset).toHaveBeenCalledTimes(1);
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
