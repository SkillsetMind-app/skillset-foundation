import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import type { CourseAsset } from "@/domain/course-asset";
import type { DripStrategy } from "@/domain/drip-policy";
import { resolveLessonVideoSource, type TeacherCourse, type TeacherLesson } from "@/domain/teacher-course";

const deleteCourseAsset = vi.fn<(asset: CourseAsset) => Promise<void>>(
  async () => {},
);
const uploadCourseAsset = vi.fn<(input: unknown) => Promise<void>>(async () => {});
const uploadLessonVideoToBunny = vi.fn<(input: unknown) => Promise<void>>(
  async () => {},
);
let currentAssets: CourseAsset[] = [];
let emitAssets: (assets: CourseAsset[]) => void;
let emitLoadError: (error: Error) => void;
// "wait" segura a primeira entrega dos arquivos; "fail" simula erro de carga.
let subscribeOutcome: "emit" | "wait" | "fail" = "emit";
const subscribed = vi.fn();
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

vi.mock("@/components/courses/bunny-video-player", () => ({
  BunnyVideoPlayer: (props: { assetId: string; resume?: unknown }) => (
    <div data-testid="bunny-preview" data-resume={String(props.resume)}>{props.assetId}</div>
  ),
}));
vi.mock("@/components/shared/protected-asset-preview", () => ({
  ProtectedAssetPreview: (props: { asset: CourseAsset; resume?: unknown }) => (
    <div data-testid="storage-preview" data-resume={String(props.resume)}>{props.asset.id}</div>
  ),
}));
vi.mock("@/components/learn/trusted-embed-player", () => ({
  TrustedEmbedPlayer: (props: { embedUrl: string }) => (
    <div data-testid="embed-preview">{props.embedUrl}</div>
  ),
}));

vi.mock("@/lib/data/course-assets", () => ({
  // A classe é usada com `instanceof` no catch do modal para distinguir
  // cancelamento (desfecho normal) de falha real. Sem ela no mock, o acesso
  // dispara unhandled rejection e o teste passa por sorte.
  CourseAssetUploadCancelled: class CourseAssetUploadCancelled extends Error {
    constructor() {
      super("upload-cancelled");
      this.name = "CourseAssetUploadCancelled";
    }
  },
  deleteCourseAsset: (asset: CourseAsset) => deleteCourseAsset(asset),
  syncLessonPreviewAssets: async () => {},
  uploadCourseAsset: (input: unknown) => uploadCourseAsset(input),
  uploadLessonVideoToBunny: (input: unknown) => uploadLessonVideoToBunny(input),
  subscribeToCourseAssets: (
    _courseId: string,
    onAssets: (assets: CourseAsset[]) => void,
    onError: (error: Error) => void,
  ) => {
    subscribed();
    emitAssets = onAssets;
    emitLoadError = onError;
    if (subscribeOutcome === "emit") onAssets(currentAssets);
    if (subscribeOutcome === "fail") onError(new Error("load-failed"));
    return () => {};
  },
}));

// Sem Bunny no teste: o envio segue pelo Supabase Storage, que é o caminho que
// roda quando a integração de vídeo ainda não foi ligada num ambiente.
const bunnyConfig = vi.hoisted(() => ({ isBunnyConfigured: false }));
vi.mock("@/lib/bunny/config", () => bunnyConfig);

const { LessonContentModal } = await import(
  "@/components/teacher/lesson-content-modal"
);

function videoAsset(overrides: Partial<CourseAsset> = {}): CourseAsset {
  return {
    id: "asset-1",
    courseId: "course-1",
    ownerId: "owner-1",
    kind: "lesson_video",
    fileName: "aula.mp4",
    contentType: "video/mp4",
    size: 1024,
    storagePath: "courses/course-1/aula.mp4",
    isPreview: false,
    lessonId: "lesson-1",
    ...overrides,
  };
}

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}

function renderModal(
  lessonOverrides: Partial<TeacherLesson> = {},
  moduleTitle = "Módulo 1",
  localized = false,
  dripStrategy: DripStrategy = "instant",
  isFreePreview = false,
) {
  const lesson: TeacherLesson = {
    id: "lesson-1",
    title: "Primeira aula",
    type: "video",
    description: "",
    ...lessonOverrides,
  };

  const course: TeacherCourse = {
    id: "course-1",
    ownerId: "owner-1",
    title: "Curso",
    summary: "",
    category: "geral",
    status: "draft",
    lessonCount: 1,
    modules: [{ id: "module-1", title: moduleTitle, lessons: [lesson] }],
  };

  const onUpdateLesson = vi.fn();
  const onClose = vi.fn();

  const modal = (nextLesson: TeacherLesson, onChange: (patch: Partial<TeacherLesson>) => void = onUpdateLesson) => (
    <LessonContentModal
      course={course}
      module={course.modules[0]}
      moduleIndex={0}
      lesson={nextLesson}
      lessonIndex={0}
      isEditable
      isFreePreview={isFreePreview}
      dripStrategy={dripStrategy}
      onClose={onClose}
      onSetFreePreview={vi.fn()}
      onUpdateLesson={onChange}
    />
  );
  function EditableModal() {
    const [draft, setDraft] = useState(lesson);
    return modal(draft, (patch: Partial<TeacherLesson>) => {
      onUpdateLesson(patch);
      setDraft((current) => ({ ...current, ...patch }));
    });
  }
  const view = render(localized ? (
    <I18nProvider initialLocale="en"><ChangeLanguage /><EditableModal /></I18nProvider>
  ) : modal(lesson));

  return { onClose, onUpdateLesson, lesson, unmount: view.unmount, rerenderLesson: (patch: Partial<TeacherLesson>) => view.rerender(modal({ ...lesson, ...patch })) };
}

function chooseVideoFile(name = "aula.mp4") {
  const file = new File(["video-bytes"], name, { type: "video/mp4" });

  fireEvent.change(screen.getByLabelText("Upload a lesson video"), {
    target: { files: [file] },
  });

  return file;
}

// So a estrategia "time_drip_custom" le os dias de espera por aula
// (src/domain/drip-policy.ts). Nas outras o campo nao fazia nada.
describe("LessonContentModal — dias de espera", () => {
  beforeEach(() => {
    currentAssets = [];
    vi.clearAllMocks();
  });

  it("esconde os dias de espera quando a estrategia do curso nao os usa", () => {
    renderModal({ dripDelayDays: 7 }, "Módulo 1", false, "instant");
    fireEvent.click(screen.getByRole("button", { name: /^Settings/ }));
    expect(screen.getByRole("button", { name: "Use this lesson as the free preview" })).toBeInTheDocument();
    expect(screen.queryByDisplayValue("7")).not.toBeInTheDocument();
  });

  it("mostra os dias de espera na liberacao por aula", () => {
    renderModal({ dripDelayDays: 7 }, "Módulo 1", false, "time_drip_custom");
    fireEvent.click(screen.getByRole("button", { name: /^Settings/ }));
    expect(screen.getByDisplayValue("7")).toBeInTheDocument();
  });
});

// Decisao de 14/09: a descricao da aula e UM campo de texto simples, gravado no
// campo protegido (contentText). A nota publica antiga nunca e apagada.
describe("LessonContentModal — descricao", () => {
  const oldNoteLabel = "Old public note (shown to students above the description; anyone can read it)";

  beforeEach(() => {
    currentAssets = [];
    vi.clearAllMocks();
  });

  it("a descricao grava no texto protegido e a nota publica antiga fica recolhida", () => {
    const { onUpdateLesson } = renderModal({ description: "old", contentText: null });
    fireEvent.click(screen.getByRole("button", { name: /^Description/ }));

    const oldNote = screen
      .getByText(oldNoteLabel)
      .closest("details") as HTMLElement;
    expect(oldNote).not.toBeNull();
    expect(oldNote).not.toHaveAttribute("open");
    expect(within(oldNote).getByRole("textbox", { hidden: true })).toHaveValue("old");

    fireEvent.change(
      screen.getByPlaceholderText("Explain what the student is about to learn and why it matters."),
      { target: { value: "Leia isto" } },
    );
    expect(onUpdateLesson).toHaveBeenLastCalledWith({ contentText: "Leia isto" });
    expect(onUpdateLesson).not.toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.anything() }),
    );
  });

  it("a nota antiga continua editavel e some quando a aula nao tem nota", () => {
    const { onUpdateLesson, unmount } = renderModal({ description: "old", contentText: "corpo" });
    fireEvent.click(screen.getByRole("button", { name: /^Description/ }));

    expect(screen.getByPlaceholderText("Explain what the student is about to learn and why it matters.")).toHaveValue("corpo");
    fireEvent.change(
      screen.getByRole("textbox", { name: oldNoteLabel, hidden: true }),
      { target: { value: "old!" } },
    );
    expect(onUpdateLesson).toHaveBeenLastCalledWith({ description: "old!" });
    unmount();

    renderModal({ description: "", contentText: "corpo" });
    fireEvent.click(screen.getByRole("button", { name: /^Description/ }));
    expect(screen.queryByText(oldNoteLabel)).not.toBeInTheDocument();
  });

  // Apagar a nota antiga desmontava o campo no mesmo toque: o professor nao
  // conseguia redigitar nem desfazer, e o autosave gravava "".
  it("apagar a nota antiga nao some com o campo", () => {
    const { onUpdateLesson } = renderModal({ description: "old", contentText: null }, "Módulo 1", true);
    fireEvent.click(screen.getByRole("button", { name: /^Description/ }));
    const note = () => screen.queryByRole("textbox", { name: oldNoteLabel, hidden: true });

    fireEvent.change(note() as HTMLElement, { target: { value: "" } });
    expect(onUpdateLesson).toHaveBeenLastCalledWith({ description: "" });
    expect(note()).toBeInTheDocument();
    fireEvent.change(note() as HTMLElement, { target: { value: "de volta" } });
    expect(onUpdateLesson).toHaveBeenLastCalledWith({ description: "de volta" });
  });

  // O texto da aula de previa gratis e lido por qualquer um na pagina do curso.
  it("na aula de previa gratis a ajuda avisa que o texto e publico", () => {
    const { unmount } = renderModal({}, "Módulo 1", false, "instant", true);
    fireEvent.click(screen.getByRole("button", { name: /^Description/ }));
    expect(screen.getByText(/anyone can read this text on the course page/)).toBeInTheDocument();
    expect(screen.queryByText(/for enrolled students/)).not.toBeInTheDocument();
    unmount();

    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /^Description/ }));
    expect(screen.getByText(/for enrolled students/)).toBeInTheDocument();
  });
});

// Decisao de 14/09: um video por aula, envio OU link do YouTube/Vimeo, nunca
// os dois. Trocar e explicito e nunca apaga um course_assets.
describe("LessonContentModal — um video por aula", () => {
  const linkField = () => screen.queryByRole("textbox", { name: "YouTube or Vimeo URL" }) as HTMLElement;
  const drive = "https://drive.example.test/file/d/abc/view";
  const youtube = "https://www.youtube.com/watch?v=abc";
  const vimeo = "https://vimeo.com/123456";

  beforeEach(() => {
    currentAssets = [];
    bunnyConfig.isBunnyConfigured = false;
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    subscribeOutcome = "emit";
  });

  it("com video enviado, o campo de link so aparece depois de Replace with link", () => {
    currentAssets = [videoAsset()];
    renderModal({ videoSource: "upload" });

    expect(linkField()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    expect(linkField()).toBeInTheDocument();
    expect(screen.queryByLabelText("Upload a lesson video")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Lesson video")).not.toBeInTheDocument();
  });

  it("link que nao e YouTube nem Vimeo mostra erro e nao grava", () => {
    const { onUpdateLesson } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));

    fireEvent.change(linkField(), { target: { value: "https://example.test/v.mp4" } });
    fireEvent.blur(linkField());

    expect(screen.getByText("Only YouTube and Vimeo video links are accepted. This link was not saved.")).toBeInTheDocument();
    expect(linkField()).toHaveAttribute("aria-invalid", "true");
    expect(onUpdateLesson).not.toHaveBeenCalled();
  });

  // O host precisa ser do YouTube ou do Vimeo: e a lista que getTrustedLessonEmbed
  // aceita. O player e mock, nada e buscado.
  it("trocar para link grava fonte e link juntos e nunca apaga o envio", () => {
    currentAssets = [videoAsset()];
    const { onUpdateLesson } = renderModal({ videoSource: "upload" });
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));

    fireEvent.change(linkField(), { target: { value: vimeo } });
    fireEvent.blur(linkField());

    expect(onUpdateLesson).toHaveBeenCalledExactlyOnceWith({
      videoSource: "youtube",
      externalUrl: vimeo,
    });
    expect(deleteCourseAsset).not.toHaveBeenCalled();
    // O envio antigo segue listado, com o proprio botao de apagar.
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("link antigo que nao e video aparece so leitura como Old link", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onUpdateLesson } = renderModal({ externalUrl: drive }, "Módulo 1", true);

    const old = screen.getByRole("region", { name: "Old link" });
    expect(old).toHaveTextContent(drive);
    expect(screen.queryByDisplayValue(drive)).not.toBeInTheDocument();

    // O campo de link comeca vazio; digitar e apagar nao tira o link antigo.
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    expect(linkField()).toHaveValue("");
    fireEvent.change(linkField(), { target: { value: "abc" } });
    fireEvent.change(linkField(), { target: { value: "" } });
    fireEvent.blur(linkField());
    expect(onUpdateLesson).not.toHaveBeenCalled();

    fireEvent.click(within(old).getByRole("button", { name: "Remove old link" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(onUpdateLesson).toHaveBeenCalledExactlyOnceWith({ externalUrl: null });
    // A secao some com o link: o foco vai para um botao que fica e o aviso
    // sai pelo role="status".
    expect(screen.queryByRole("region", { name: "Old link" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace with upload" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Old link removed.");
  });

  it("recusar a confirmacao de tirar o link antigo nao muda nada", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onUpdateLesson } = renderModal({ externalUrl: drive }, "Módulo 1", true);

    fireEvent.click(screen.getByRole("button", { name: "Remove old link" }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(onUpdateLesson).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Old link" })).toHaveTextContent(drive);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  // O primeiro link aceito sobrescrevia o link antigo sem perguntar: a unica
  // confirmacao estava no botao de tirar.
  it("link do Vimeo numa aula com link antigo pede a confirmacao antes de gravar", () => {
    const confirm = vi.spyOn(window, "confirm")
      .mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { onUpdateLesson } = renderModal({ externalUrl: drive }, "Módulo 1", true);
    const notice = "Link not saved. The old link stays.";
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));

    fireEvent.change(linkField(), { target: { value: vimeo } });
    fireEvent.blur(linkField());
    expect(confirm).toHaveBeenCalledExactlyOnceWith("Remove the old link? Students will lose the button that opens it.");
    expect(onUpdateLesson).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Old link" })).toHaveTextContent(drive);
    // Recusou: o campo volta ao salvo e avisa. Sair de novo (X, aba, troca)
    // nao pergunta outra vez nem come o clique.
    expect(linkField()).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent(notice);
    const firstNotice = screen.getByText(notice);
    fireEvent.blur(linkField());
    expect(confirm).toHaveBeenCalledOnce();

    // A segunda recusa vira um no novo no status, para ser anunciada de novo.
    fireEvent.change(linkField(), { target: { value: vimeo } });
    fireEvent.blur(linkField());
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.getByText(notice)).not.toBe(firstNotice);

    fireEvent.change(linkField(), { target: { value: vimeo } });
    fireEvent.blur(linkField());
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(onUpdateLesson).toHaveBeenCalledExactlyOnceWith({ videoSource: "youtube", externalUrl: vimeo });
    expect(confirm.mock.invocationCallOrder[2]).toBeLessThan(onUpdateLesson.mock.invocationCallOrder[0]);
    expect(screen.queryByRole("region", { name: "Old link" })).not.toBeInTheDocument();
    // Gravou: o aviso de "nao salvo" sai.
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("o aviso de link nao salvo some depois de tirar o link antigo e ao trocar de aba", () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderModal({ externalUrl: drive }, "Módulo 1", true);
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    fireEvent.change(linkField(), { target: { value: vimeo } });
    fireEvent.blur(linkField());
    expect(screen.getByRole("status")).toHaveTextContent("Link not saved. The old link stays.");

    fireEvent.click(screen.getByRole("button", { name: "Remove old link" }));
    expect(screen.getByRole("status")).toHaveTextContent("Old link removed.");
    fireEvent.click(screen.getByRole("button", { name: /^Description/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Video/ }));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  // A troca so mexia na tela: com a midia de destino ja salva, o aluno
  // continuava vendo a fonte antiga.
  it("com envio e link salvos, trocar grava a fonte e o aluno ve a troca, sem apagar nada", () => {
    currentAssets = [videoAsset()];
    const { onUpdateLesson, lesson } = renderModal(
      { videoSource: "youtube", externalUrl: youtube, durationMinutes: 12, contentText: "corpo" },
      "Módulo 1",
      true,
    );
    const saved = () =>
      Object.assign({}, lesson, ...onUpdateLesson.mock.calls.map(([patch]) => patch)) as TeacherLesson;
    // O mesmo calculo do player da area de membros (enrolled-course-workspace).
    const learnerSees = () =>
      resolveLessonVideoSource({ declared: saved().videoSource, hasVideoAsset: true, hasTrustedEmbed: true });
    expect(learnerSees()).toBe("youtube");

    fireEvent.click(screen.getByRole("button", { name: "Replace with upload" }));
    expect(onUpdateLesson).toHaveBeenLastCalledWith({ videoSource: "upload" });
    expect(learnerSees()).toBe("upload");

    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    expect(onUpdateLesson).toHaveBeenLastCalledWith({ videoSource: "youtube" });
    expect(learnerSees()).toBe("youtube");

    expect(onUpdateLesson).toHaveBeenCalledTimes(2);
    expect(saved()).toEqual({ ...lesson, videoSource: "youtube" });
    expect(deleteCourseAsset).not.toHaveBeenCalled();
  });

  it("sem a midia de destino, trocar fica so na tela ate um link ou um envio", () => {
    const { onUpdateLesson, unmount } = renderModal({ videoSource: "youtube", externalUrl: youtube });
    fireEvent.click(screen.getByRole("button", { name: "Replace with upload" }));
    expect(onUpdateLesson).not.toHaveBeenCalled();
    unmount();

    currentAssets = [videoAsset()];
    const second = renderModal({ videoSource: "upload" });
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    expect(second.onUpdateLesson).not.toHaveBeenCalled();
  });

  // O modo era rederivado dos dados salvos a cada render: apagar o link
  // mandava a aba de volta ao envio e tirava o campo que o professor digitava.
  it("apagar o link de uma aula do YouTube mantem o campo na tela", () => {
    const { onUpdateLesson } = renderModal({ videoSource: "youtube", externalUrl: youtube }, "Módulo 1", true);
    expect(linkField()).toHaveValue(youtube);

    fireEvent.change(linkField(), { target: { value: "" } });
    expect(linkField()).toBeInTheDocument();
    fireEvent.blur(linkField());
    expect(onUpdateLesson).toHaveBeenCalledExactlyOnceWith({ externalUrl: null, videoSource: null });
    expect(linkField()).toBeInTheDocument();
    expect(linkField()).toHaveValue("");

    fireEvent.change(linkField(), { target: { value: vimeo } });
    fireEvent.blur(linkField());
    expect(onUpdateLesson).toHaveBeenLastCalledWith({ videoSource: "youtube", externalUrl: vimeo });
  });

  // Esc e clique fora desmontam o campo sem um blur que chegue ao React 19: o
  // link digitado e nunca desfocado se perdia ao fechar.
  it("Esc e clique fora gravam o link digitado antes de fechar", () => {
    const first = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    fireEvent.change(linkField(), { target: { value: vimeo } });
    fireEvent.keyDown(linkField(), { key: "Escape" });
    expect(first.onUpdateLesson).toHaveBeenCalledExactlyOnceWith({ videoSource: "youtube", externalUrl: vimeo });
    expect(first.onClose).toHaveBeenCalledOnce();
    expect(first.onUpdateLesson.mock.invocationCallOrder[0]).toBeLessThan(first.onClose.mock.invocationCallOrder[0]);
    first.unmount();

    const second = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    fireEvent.change(linkField(), { target: { value: vimeo } });
    fireEvent.mouseDown(document.querySelector(".lesson-modal-overlay") as HTMLElement);
    expect(second.onUpdateLesson).toHaveBeenCalledExactlyOnceWith({ videoSource: "youtube", externalUrl: vimeo });
    expect(second.onClose).toHaveBeenCalledOnce();
  });

  // A pagina publica do curso so le "upload" da fonte gravada: com a fonte em
  // null, o video da previa gratis sumia da pagina de vendas.
  it("apagar o link com um envio salvo grava a fonte no envio, nao em null", () => {
    currentAssets = [videoAsset()];
    const { onUpdateLesson, lesson } = renderModal({ videoSource: "youtube", externalUrl: youtube }, "Módulo 1", true);

    fireEvent.change(linkField(), { target: { value: "" } });
    fireEvent.blur(linkField());

    expect(onUpdateLesson).toHaveBeenCalledExactlyOnceWith({ externalUrl: null, videoSource: "upload" });
    const saved = { ...lesson, ...onUpdateLesson.mock.calls[0][0] } as TeacherLesson;
    // O mesmo calculo da previa na pagina de vendas (creator-course-detail).
    expect(resolveLessonVideoSource({
      declared: saved.videoSource,
      hasVideoAsset: saved.videoSource === "upload",
      hasTrustedEmbed: false,
    })).toBe("upload");
    expect(deleteCourseAsset).not.toHaveBeenCalled();
  });

  // Fechar calado perdia o link: recusado, ou com a troca nao confirmada.
  it("Esc com link recusado deixa o estudio aberto e mostra o erro", () => {
    const { onUpdateLesson, onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    fireEvent.change(linkField(), { target: { value: "https://example.test/v.mp4" } });

    fireEvent.keyDown(linkField(), { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Only YouTube and Vimeo video links are accepted.");
    expect(onUpdateLesson).not.toHaveBeenCalled();
  });

  it("Esc e Cancelar na confirmacao deixam o estudio aberto; o Esc seguinte fecha", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onUpdateLesson, onClose } = renderModal({ externalUrl: drive }, "Módulo 1", true);
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    fireEvent.change(linkField(), { target: { value: vimeo } });

    fireEvent.keyDown(linkField(), { key: "Escape" });
    expect(confirm).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(onUpdateLesson).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Link not saved. The old link stays.");

    // O campo voltou ao salvo: nada mais a perder, o Esc seguinte fecha.
    fireEvent.keyDown(linkField(), { key: "Escape" });
    expect(confirm).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  // Antes de os arquivos chegarem, primaryVideo e null: apagar o link gravava
  // a fonte em null mesmo com um envio salvo.
  it("antes de os arquivos da aula chegarem, o link e so leitura e apagar nao grava nada", () => {
    subscribeOutcome = "wait";
    currentAssets = [videoAsset()];
    const { onUpdateLesson } = renderModal({ videoSource: "youtube", externalUrl: youtube }, "Módulo 1", true);

    expect(linkField()).toHaveAttribute("readonly");
    expect(screen.getByText("Loading this lesson's files...")).toBeInTheDocument();
    fireEvent.change(linkField(), { target: { value: "" } });
    fireEvent.blur(linkField());
    expect(onUpdateLesson).not.toHaveBeenCalled();

    act(() => emitAssets(currentAssets));
    expect(linkField()).not.toHaveAttribute("readonly");
    fireEvent.change(linkField(), { target: { value: "" } });
    fireEvent.blur(linkField());
    expect(onUpdateLesson).toHaveBeenCalledExactlyOnceWith({ externalUrl: null, videoSource: "upload" });
  });

  it("se os arquivos da aula nao carregam, o link fica so leitura com o erro de carga", () => {
    subscribeOutcome = "fail";
    const { onUpdateLesson } = renderModal({ videoSource: "youtube", externalUrl: youtube });

    expect(linkField()).toHaveAttribute("readonly");
    expect(screen.getByText("We could not load lesson assets.")).toBeInTheDocument();
    fireEvent.change(linkField(), { target: { value: "" } });
    fireEvent.blur(linkField());
    expect(onUpdateLesson).not.toHaveBeenCalled();
  });

  // resetUploadState limpava o erro de carga: depois de "Replace with link" ou
  // de uma troca de aba, o aviso voltava a "Loading..." para sempre.
  it("o erro de carga continua na tela depois de trocar de modo e de aba", () => {
    subscribeOutcome = "fail";
    const { onUpdateLesson } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    fireEvent.click(screen.getByRole("button", { name: /^Description/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Video/ }));

    expect(linkField()).toHaveAttribute("readonly");
    expect(screen.getByText("We could not load lesson assets.")).toBeInTheDocument();
    expect(screen.queryByText("Loading this lesson's files...")).not.toBeInTheDocument();
    expect(onUpdateLesson).not.toHaveBeenCalled();
  });

  // "Replace with upload" antes de os arquivos chegarem nao gravava a fonte: o
  // estudio mostrava o envio e o aluno continuava com o link.
  it("Replace with upload antes da carga grava a fonte no envio quando os arquivos chegam", () => {
    subscribeOutcome = "wait";
    currentAssets = [videoAsset()];
    const { onUpdateLesson, lesson } = renderModal({ videoSource: "youtube", externalUrl: youtube }, "Módulo 1", true);

    fireEvent.click(screen.getByRole("button", { name: "Replace with upload" }));
    expect(onUpdateLesson).not.toHaveBeenCalled();

    act(() => emitAssets(currentAssets));
    expect(onUpdateLesson).toHaveBeenCalledExactlyOnceWith({ videoSource: "upload" });
    const saved = { ...lesson, ...onUpdateLesson.mock.calls[0][0] } as TeacherLesson;
    expect(saved.externalUrl).toBe(youtube);
    // O mesmo calculo do player da area de membros (enrolled-course-workspace).
    expect(resolveLessonVideoSource({ declared: saved.videoSource, hasVideoAsset: true, hasTrustedEmbed: true }))
      .toBe("upload");
    expect(deleteCourseAsset).not.toHaveBeenCalled();
  });

  it("se a carga falha, ou o professor volta para o link, a escolha do envio nao grava nada", () => {
    subscribeOutcome = "fail";
    currentAssets = [videoAsset()];
    const failed = renderModal({ videoSource: "youtube", externalUrl: youtube });
    fireEvent.click(screen.getByRole("button", { name: "Replace with upload" }));
    expect(failed.onUpdateLesson).not.toHaveBeenCalled();
    failed.unmount();

    subscribeOutcome = "wait";
    const back = renderModal({ videoSource: "youtube", externalUrl: youtube }, "Módulo 1", true);
    fireEvent.click(screen.getByRole("button", { name: "Replace with upload" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    act(() => emitAssets(currentAssets));
    expect(back.onUpdateLesson).not.toHaveBeenCalled();
  });

  // Antes da carga o modo link e so o plano B da tela. "Replace with upload" e
  // depois "Replace with link" gravava "youtube" e tirava o aluno do envio.
  it("ida e volta envio/link antes da carga nao tira o aluno do envio", () => {
    subscribeOutcome = "wait";
    currentAssets = [videoAsset()];
    const { onUpdateLesson } = renderModal({ videoSource: "upload", externalUrl: youtube }, "Módulo 1", true);

    fireEvent.click(screen.getByRole("button", { name: "Replace with upload" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    expect(onUpdateLesson).not.toHaveBeenCalled();

    act(() => emitAssets(currentAssets));
    expect(onUpdateLesson).not.toHaveBeenCalled();
    // O aluno segue no envio: a previa mostra o arquivo, nao o embed.
    expect(screen.getByTestId("storage-preview")).toBeInTheDocument();
    expect(screen.queryByTestId("embed-preview")).not.toBeInTheDocument();
  });

  // Depois de uma carga boa, um recarregamento em tempo real que falhava
  // deixava o alerta fixo ao lado de uma lista que continuava na tela.
  it("uma carga boa seguida de um recarregamento que falha nao mostra alerta de carga", () => {
    currentAssets = [videoAsset()];
    renderModal({ videoSource: "upload" });
    expect(screen.getByRole("button", { name: "Upload file" })).toBeInTheDocument();

    act(() => emitLoadError(new Error("reload-failed")));

    expect(screen.queryByText("We could not load lesson assets.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("o erro de carga e anunciado: no campo de link, ligado a ele, e no modo envio", () => {
    subscribeOutcome = "fail";
    const linkMode = renderModal({ videoSource: "youtube", externalUrl: youtube });
    const hint = screen.getByText("We could not load lesson assets.");
    expect(hint).toHaveAttribute("role", "status");
    expect(linkField()).toHaveAccessibleDescription("We could not load lesson assets.");
    linkMode.unmount();

    // Sem link, a aba abre no modo envio: o aviso tambem aparece ali.
    renderModal();
    expect(screen.getByRole("status")).toHaveTextContent("We could not load lesson assets.");
  });
});

describe("LessonContentModal — video tab", () => {
  beforeEach(() => {
    currentAssets = [];
    bunnyConfig.isBunnyConfigured = false;
    vi.clearAllMocks();
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn((file: File) => `blob:local-${file.name}`);
      static revokeObjectURL = vi.fn();
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Tirar o link antigo no meio de um envio sumia com o botao focado e o foco
  // caia no body (o botao de troca fica desabilitado); o aviso nunca saia.
  it("durante um envio, Remove old link fica desabilitado", async () => {
    let finish!: () => void;
    uploadCourseAsset.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderModal({ externalUrl: "https://drive.example.test/file/d/abc/view" });
    chooseVideoFile();
    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));

    await screen.findByRole("progressbar", { name: "Uploading..." });
    expect(screen.getByRole("button", { name: "Remove old link" })).toBeDisabled();
    await act(async () => { finish(); });
    expect(screen.getByRole("button", { name: "Remove old link" })).toBeEnabled();
  });

  it("keeps selected video, local preview and upload in the device column without publishing", () => {
    const { onUpdateLesson, unmount } = renderModal();
    const file = chooseVideoFile("my lesson.mp4");
    const options = document.querySelector(".lesson-video-source-picker__options")!;
    const form = screen.getByRole("button", { name: "Upload file" }).closest("form")!;
    expect(options).toContainElement(form);
    expect(within(form).getByText(/my lesson.mp4/)).toBeInTheDocument();
    expect(within(form).getByRole("status")).toHaveTextContent("Selected on your device. Not uploaded yet.");
    const preview = screen.getByLabelText("Selected video preview");
    expect(form).toContainElement(preview);
    expect(preview.tagName).toBe("VIDEO");
    expect(preview).toHaveAttribute("src", "blob:local-my lesson.mp4");
    expect(preview).toHaveAttribute("controls");
    expect(preview).not.toHaveAttribute("autoplay");
    expect(URL.createObjectURL).toHaveBeenCalledExactlyOnceWith(file);
    // Um video por aula: com o envio na tela, o campo de link nao aparece.
    expect(screen.queryByLabelText("YouTube or Vimeo URL")).not.toBeInTheDocument();
    expect(form.compareDocumentPosition(screen.getByRole("button", { name: "Replace with link" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(onUpdateLesson).not.toHaveBeenCalled();
    expect(uploadCourseAsset).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Video/ })).toHaveTextContent("Selected");

    fireEvent.error(preview);
    expect(screen.getByText("This browser cannot preview this file. You can still upload it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload file" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Lesson video"), {
      target: { files: [new File(["video"], "replacement.webm", { type: "video/webm" })] },
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-my lesson.mp4");
    expect(screen.getByLabelText("Selected video preview")).toHaveAttribute("src", "blob:local-replacement.webm");
    expect(screen.queryByText("This browser cannot preview this file. You can still upload it.")).not.toBeInTheDocument();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-replacement.webm");
  });

  it.each([50, null])("shows transport progress (%s) inside the same device panel", async (percent) => {
    let finish!: () => void;
    uploadCourseAsset.mockImplementationOnce((input) => {
      const callbacks = input as { onProgress: (value: unknown) => void };
      callbacks.onProgress({ bytesTransferred: 5, totalBytes: 10, percent, state: "running" });
      return new Promise<void>((resolve) => { finish = resolve; });
    });
    const { onClose } = renderModal();
    chooseVideoFile();
    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
    const progress = await screen.findByRole("progressbar", { name: "Uploading..." });
    expect(document.querySelector(".lesson-video-source-picker__options")).toContainElement(progress);
    if (percent === null) expect(progress).not.toHaveAttribute("value");
    else expect(progress).toHaveAttribute("value", "50");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("File uploaded to this lesson.");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-aula.mp4");
  });

  it("retains the selected file when choosing live recording", async () => {
    renderModal();
    const file = chooseVideoFile();
    fireEvent.change(screen.getByLabelText("Video type"), { target: { value: "live_recording" } });
    expect(screen.getByRole("button", { name: "Upload file" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
    await waitFor(() => expect(uploadCourseAsset).toHaveBeenCalledWith(expect.objectContaining({ file, kind: "live_recording" })));
  });

  it("moves keyboard focus from the replaced file picker to the upload action", () => {
    renderModal();
    act(() => screen.getByLabelText("Upload a lesson video").focus());
    chooseVideoFile();
    expect(screen.getByRole("button", { name: "Upload file" })).toHaveFocus();
  });

  it("keeps file selection and upload before an existing video preview", () => {
    currentAssets = [videoAsset()];
    renderModal({ videoSource: "upload" });
    const preview = screen.getByTestId("storage-preview");
    const fileInput = screen.getByLabelText("Lesson video");
    const submit = screen.getByRole("button", { name: "Upload file" });
    expect(fileInput.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(submit.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("dismisses URL help with Escape while keeping the lesson open and focused", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    const help = screen.getByRole("button", { name: "How the YouTube or Vimeo URL field works" });
    act(() => help.focus());
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(help, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(help).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(help, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("dismisses hovered URL help before Escape reaches the lesson, without moving input focus", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    const input = screen.getByPlaceholderText("https://www.youtube.com/watch?v=...");
    act(() => input.focus());
    fireEvent.mouseEnter(screen.getByRole("button", { name: "How the YouTube or Vimeo URL field works" }));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each(["success", "failure", "cancel"] as const)(
    "changes language during upload without restarting the file or losing its %s outcome",
    async (outcome) => {
      bunnyConfig.isBunnyConfigured = true;
      const { CourseAssetUploadCancelled } = await import("@/lib/data/course-assets");
      let finish!: () => void;
      let fail!: (error: Error) => void;
      const cancel = vi.fn(() => fail(new CourseAssetUploadCancelled()));
      uploadLessonVideoToBunny.mockImplementationOnce((input) => {
        const callbacks = input as {
          onProgress: (progress: { bytesTransferred: number; totalBytes: number; percent: number; state: "running" }) => void;
          onCancelAvailable: (cancel: () => void) => void;
        };
        callbacks.onProgress({ bytesTransferred: 512, totalBytes: 1024, percent: 50, state: "running" });
        callbacks.onCancelAvailable(cancel);
        return new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
      });
      const url = "https://youtu.be/author-link";
      const { onUpdateLesson } = renderModal({ externalUrl: url }, "Módulo $& integral", true);
      fireEvent.click(screen.getByRole("button", { name: /^Description/ }));
      fireEvent.change(screen.getByLabelText("Lesson title"), { target: { value: "Título $& íntegro" } });
      fireEvent.change(screen.getByPlaceholderText("Explain what the student is about to learn and why it matters."), {
        target: { value: "Descrição autoral — não traduzir" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^Video/ }));
      // A aula tem link do YouTube: a aba abre no link, e o envio e uma troca explicita.
      fireEvent.click(screen.getByRole("button", { name: "Replace with upload" }));
      const file = chooseVideoFile("Aula $& — ação.mp4");
      const fileInput = screen.getByLabelText("Lesson video");
      fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
      await screen.findByText("50% - 512 B of 1.0 KB");
      const updatesBeforeLanguage = onUpdateLesson.mock.calls.length;

      fireEvent.click(screen.getByRole("button", { name: "Change language" }));
      expect(screen.getByText("50% - 512 B de 1.0 KB")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Cancelar subida" })).toBeEnabled();
      expect(screen.getByLabelText("Video de la lección")).toBe(fileInput);
      expect(screen.getByText(/Aula \$& — ação\.mp4/)).toBeInTheDocument();
      // O link salvo nunca foi tocado pela troca nem pelo envio.
      expect(onUpdateLesson).not.toHaveBeenCalledWith(expect.objectContaining({ externalUrl: expect.anything() }));
      for (const name of [/^Video/, /^Descripción/, /^Materiales/, /^Ajustes/]) {
        expect(screen.getByRole("button", { name })).toBeDisabled();
      }
      expect(onUpdateLesson).toHaveBeenCalledTimes(updatesBeforeLanguage);
      expect(subscribed).toHaveBeenCalledOnce();
      expect(uploadLessonVideoToBunny).toHaveBeenCalledOnce();
      expect(uploadLessonVideoToBunny.mock.calls[0][0]).toEqual(expect.objectContaining({ file, kind: "lesson_video" }));

      fireEvent.click(screen.getByRole("button", { name: "Change language" }));
      expect(screen.getByText("50% - 512 B of 1.0 KB")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Change language" }));
      if (outcome === "cancel") {
        fireEvent.click(screen.getByRole("button", { name: "Cancelar subida" }));
      } else if (outcome === "failure") {
        await act(async () => { fail(new Error("bunny-create-failed:429")); });
      } else {
        await act(async () => { emitAssets([videoAsset()]); finish(); });
      }
      await waitFor(() => expect(screen.getByRole("button", { name: /^Descripción/ })).toBeEnabled());
      if (outcome === "failure") {
        expect(screen.getByText(/Demasiadas subidas en la última hora/)).toBeInTheDocument();
      } else if (outcome === "success") {
        expect(screen.getByText("Archivo subido a esta lección.")).toBeInTheDocument();
        expect(onUpdateLesson).toHaveBeenLastCalledWith({ videoSource: "upload" });
      } else {
        expect(cancel).toHaveBeenCalledOnce();
        expect(screen.queryByText(/No pudimos subir|Demasiadas subidas/)).not.toBeInTheDocument();
      }
      fireEvent.click(screen.getByRole("button", { name: "Change language" }));
      if (outcome === "failure") expect(screen.getByText(/Too many uploads in the last hour/)).toBeInTheDocument();
      if (outcome === "success") expect(screen.getByText("File uploaded to this lesson.")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /^Description/ }));
      expect(screen.getByLabelText("Lesson title")).toHaveValue("Título $& íntegro");
      expect(screen.getByDisplayValue("Descrição autoral — não traduzir")).toBeInTheDocument();
      expect(subscribed).toHaveBeenCalledOnce();
      expect(uploadLessonVideoToBunny).toHaveBeenCalledOnce();
      if (outcome !== "success") expect(onUpdateLesson).toHaveBeenCalledTimes(updatesBeforeLanguage);
    },
  );

  it("translates a displayed validation error while preserving the literal filename", () => {
    bunnyConfig.isBunnyConfigured = true;
    renderModal({}, "Módulo 1", true);
    const file = new File(["notes"], "Material $& <autoral>.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Upload a lesson video"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
    expect(screen.getByText('"Material $& <autoral>.pdf" is not a video file. Use MP4, MOV or WebM.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByText('"Material $& <autoral>.pdf" no es un archivo de video. Usa MP4, MOV o WebM.')).toBeInTheDocument();
    expect(uploadLessonVideoToBunny).not.toHaveBeenCalled();
    expect(uploadCourseAsset).not.toHaveBeenCalled();
  });

  it("localizes materials and settings while preserving lesson values, type codes and authored placeholders", () => {
    currentAssets = [videoAsset({
      kind: "lesson_thumbnail", contentType: "image/png", fileName: "Miniatura $&.png",
      downloadUrl: "https://example.supabase.co/storage/v1/object/public/public-media/thumbnail.png",
    })];
    const { onUpdateLesson } = renderModal({ type: "external_embed", durationMinutes: 12, dripDelayDays: 7 }, "Módulo $& {lessonIndex}", true, "time_drip_custom");
    fireEvent.click(screen.getByRole("button", { name: /^Settings/ }));
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("button", { name: /^Ajustes/ })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByLabelText("Tipo de lección")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Duración en minutos")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("7")).toBeInTheDocument();
    expect(screen.getByText("Módulo 1 - Módulo $& {lessonIndex} / Lección 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usar esta lección como vista previa gratuita" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: /^Descripción/ }));
    expect(screen.getByRole("img", { name: "Miniatura de la lección: Miniatura $&.png" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Materiales/ }));
    expect(screen.getByLabelText("Material de la lección")).toBeInTheDocument();
    expect(screen.getByText("Todavía no hay materiales complementarios.")).toBeInTheDocument();
    expect(onUpdateLesson).not.toHaveBeenCalled();
  });

  it("keeps full lesson identity in the content scroll, upload first and preview before guidance", () => {
    const title = "Como preparar uma aula com um título completo que precisa continuar legível em uma tela pequena";
    const moduleTitle = "Planejamento e preparação de todas as etapas do primeiro módulo";
    currentAssets = [videoAsset()];
    renderModal({ title, videoSource: "upload" }, moduleTitle);

    const dialog = screen.getByRole("dialog", { name: title });
    const body = dialog.querySelector(".lesson-modal__body");
    const header = dialog.querySelector("header")!;
    // Geometry belongs to browser QA; this guards the reading/scroll order
    // that keeps user text out of the fixed action bar without truncating it.
    expect(body).toContainElement(screen.getByRole("heading", { name: title }));
    expect(body).toContainElement(screen.getByText(`Module 1 - ${moduleTitle} / Lesson 1`));
    expect(within(header).getByText("Lesson 1")).toBeInTheDocument();
    expect(header).not.toHaveTextContent(title);
    expect(within(header).getByRole("button", { name: "Close lesson studio" })).toBeInTheDocument();

    const preview = screen.getByRole("region", { name: "Lesson video preview" });
    expect(screen.getByLabelText("Lesson video").compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    for (const laterContent of [
      screen.getByText(/Upload the video to SkillsetMind or paste a YouTube\/Vimeo URL/),
    ]) {
      expect(preview.compareDocumentPosition(laterContent) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }

    fireEvent.click(screen.getByRole("button", { name: /^Description/ }));
    expect(dialog).toHaveAccessibleName(title);
    expect(body).toContainElement(screen.getByRole("heading", { name: title }));
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.getByText("Uploads save immediately. Text and settings save with the course draft.")).toBeInTheDocument();
  });

  // O achado P-01 da auditoria: sem este teste, remover o que abre o painel
  // deixa o professor sem nenhum caminho para enviar vídeo, e a suíte fica
  // verde. O formulário de envio é a única porta — Materials e Settings criam
  // lesson_material e lesson_thumbnail, nunca o vídeo da aula.
  it("reveals the upload form as soon as a file is chosen on a brand-new lesson", () => {
    renderModal();

    expect(screen.queryByRole("button", { name: /upload file/i })).toBeNull();

    chooseVideoFile();

    expect(
      screen.getByRole("button", { name: /upload file/i }),
    ).toBeInTheDocument();
  });

  it("reveals the upload form even when the lesson already declares a youtube source", () => {
    renderModal({
      videoSource: "youtube",
      externalUrl: "https://www.youtube.com/watch?v=abc",
    });

    // Um video por aula: o envio aparece pela troca explicita.
    fireEvent.click(screen.getByRole("button", { name: "Replace with upload" }));
    chooseVideoFile();

    expect(
      screen.getByRole("button", { name: /upload file/i }),
    ).toBeInTheDocument();
  });

  // Escolher o arquivo não pode gravar a fonte: é isso que deixava a aula vazia
  // para quem já tinha pago quando o professor desistia do envio.
  it("does not declare the source when the file is only chosen", () => {
    const { onUpdateLesson } = renderModal();

    chooseVideoFile();

    expect(onUpdateLesson).not.toHaveBeenCalled();
  });

  it("declares the source only after the upload succeeds", async () => {
    const { onUpdateLesson } = renderModal();

    chooseVideoFile();
    fireEvent.click(screen.getByRole("button", { name: /upload file/i }));

    await waitFor(() => {
      expect(uploadCourseAsset).toHaveBeenCalledTimes(1);
    });

    expect(onUpdateLesson).toHaveBeenCalledWith({ videoSource: "upload" });
  });

  it("keeps the source untouched when the upload fails", async () => {
    uploadCourseAsset.mockRejectedValueOnce(new Error("network died"));
    const { onUpdateLesson } = renderModal();

    chooseVideoFile();
    fireEvent.click(screen.getByRole("button", { name: /upload file/i }));

    await waitFor(() => {
      expect(uploadCourseAsset).toHaveBeenCalledTimes(1);
    });

    expect(onUpdateLesson).not.toHaveBeenCalled();
  });

  it("previews the latest subscribed upload without student resume and removes stale playback", () => {
    renderModal({ videoSource: "upload", externalUrl: "https://youtu.be/existing" });
    expect(screen.queryByTestId("bunny-preview")).not.toBeInTheDocument();
    const old = videoAsset({ id: "old", bunnyVideoId: "bunny-old", createdAt: "2026-09-01" });
    const newest = videoAsset({ id: "new", bunnyVideoId: "bunny-new", createdAt: "2026-09-02" });
    act(() => emitAssets([old, newest]));
    const player = screen.getByTestId("bunny-preview");
    expect(player).toHaveTextContent("new");
    expect(screen.queryByTestId("embed-preview")).not.toBeInTheDocument();
    expect(player).toHaveAttribute("data-resume", "undefined");
    act(() => emitAssets([old]));
    expect(player).not.toBeInTheDocument();
    expect(screen.getByTestId("bunny-preview")).toHaveTextContent("old");
    act(() => emitAssets([]));
    expect(screen.queryByTestId("bunny-preview")).not.toBeInTheDocument();
  });

  it("previews the draft embed and falls back to protected Storage when the link becomes invalid", () => {
    currentAssets = [videoAsset()];
    const { rerenderLesson } = renderModal({ videoSource: "youtube", externalUrl: "https://youtu.be/draft-one" });
    expect(screen.getByTestId("embed-preview")).toHaveTextContent("/embed/draft-one");
    expect(screen.queryByTestId("storage-preview")).not.toBeInTheDocument();
    rerenderLesson({ videoSource: "youtube", externalUrl: "https://youtu.be/draft-two" });
    expect(screen.getByTestId("embed-preview")).toHaveTextContent("/embed/draft-two");
    rerenderLesson({ videoSource: "youtube", externalUrl: "not a video URL" });
    expect(screen.queryByTestId("embed-preview")).not.toBeInTheDocument();
    expect(screen.getByTestId("storage-preview")).toHaveAttribute("data-resume", "undefined");
    act(() => emitAssets([]));
    expect(screen.queryByTestId("storage-preview")).not.toBeInTheDocument();
  });

  it("shows the uploaded thumbnail beside lesson details, not release settings", () => {
    currentAssets = [videoAsset({ kind: "lesson_thumbnail", contentType: "image/png", fileName: "thumbnail.png", downloadUrl: "https://example.supabase.co/storage/v1/object/public/public-media/thumbnail.png" })];
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /^Description/ }));
    expect(screen.getByRole("img", { name: "Lesson thumbnail: thumbnail.png" })).toHaveAttribute("src", currentAssets[0].downloadUrl);
  });

  it.each(["success", "failure", "cancel"] as const)(
    "keeps upload progress and cancellation visible until %s, then unlocks tabs",
    async (outcome) => {
      bunnyConfig.isBunnyConfigured = true;
      const { CourseAssetUploadCancelled } = await import("@/lib/data/course-assets");
      let finish!: () => void;
      let fail!: (error: Error) => void;
      const cancel = vi.fn(() => fail(new CourseAssetUploadCancelled()));
      uploadLessonVideoToBunny.mockImplementationOnce((input) => {
        const callbacks = input as {
          onProgress: (progress: { bytesTransferred: number; totalBytes: number; percent: number; state: "running" }) => void;
          onCancelAvailable: (cancel: () => void) => void;
        };
        callbacks.onProgress({ bytesTransferred: 512, totalBytes: 1024, percent: 50, state: "running" });
        callbacks.onCancelAvailable(cancel);
        return new Promise<void>((resolve, reject) => {
          finish = resolve;
          fail = reject;
        });
      });
      const { onUpdateLesson } = renderModal();
      chooseVideoFile();
      fireEvent.click(screen.getByRole("button", { name: /upload file/i }));
      const progress = await screen.findByText(/^50% - /);

      for (const name of [/^Video/, /^Description/, /^Materials/, /^Settings/]) {
        fireEvent.click(screen.getByRole("button", { name }));
        expect(progress).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Cancel upload" })).toBeEnabled();
        expect(screen.getByRole("button", { name })).toBeDisabled();
      }

      if (outcome === "cancel") {
        fireEvent.click(screen.getByRole("button", { name: "Cancel upload" }));
        expect(cancel).toHaveBeenCalledOnce();
      } else if (outcome === "failure") {
        fail(new Error("Upload failed"));
      } else {
        finish();
      }
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /^Description/ })).toBeEnabled();
      });
      expect(screen.queryByRole("button", { name: "Cancel upload" })).not.toBeInTheDocument();
      if (outcome === "success") {
        expect(onUpdateLesson).toHaveBeenCalledWith({ videoSource: "upload" });
      } else {
        expect(onUpdateLesson).not.toHaveBeenCalled();
      }
      fireEvent.click(screen.getByRole("button", { name: /^Description/ }));
      expect(screen.getByLabelText("Lesson title")).toBeInTheDocument();
    },
  );

  // O mesmo buraco entrando pela porta dos fundos: apagar o último vídeo
  // deixava `videoSource` prometendo um arquivo que não existe mais.
  it("clears the declared upload source when the last video asset is deleted", async () => {
    currentAssets = [videoAsset()];
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { onUpdateLesson } = renderModal({
      videoSource: "upload",
      externalUrl: "https://www.youtube.com/watch?v=abc",
    });

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));

    await waitFor(() => {
      expect(deleteCourseAsset).toHaveBeenCalledTimes(1);
    });

    expect(onUpdateLesson).toHaveBeenCalledWith({ videoSource: null });
  });

  it("keeps the source when another video asset survives the delete", async () => {
    currentAssets = [videoAsset(), videoAsset({ id: "asset-2" })];
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { onUpdateLesson } = renderModal({ videoSource: "upload" });

    fireEvent.click(screen.getAllByRole("button", { name: /delete/i })[0]);

    await waitFor(() => {
      expect(deleteCourseAsset).toHaveBeenCalledTimes(1);
    });

    expect(onUpdateLesson).not.toHaveBeenCalled();
  });

  // Sem Bunny, o vídeo vai para o Supabase Storage, cujo teto do plano é
  // ~50 MB. O validador recusa antes de qualquer byte sair — este é o único
  // caminho de recusa por tamanho aqui; um segundo ramo, inalcançável, foi
  // removido. Se o validador voltar a aceitar o teto do bucket (500 MB), o
  // arquivo chega ao envio e este teste fica vermelho.
  it("recusa um vídeo acima do teto do plano antes de enviar", async () => {
    renderModal();

    const big = new File(["video-bytes"], "aula.mp4", { type: "video/mp4" });
    Object.defineProperty(big, "size", { value: 51 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText("Upload a lesson video"), {
      target: { files: [big] },
    });
    fireEvent.click(screen.getByRole("button", { name: /upload file/i }));

    expect(
      await screen.findByText("Use a valid lesson video file under 50.0 MB."),
    ).toBeInTheDocument();
    expect(uploadCourseAsset).not.toHaveBeenCalled();
  });
});

// Video on Bunny: the studio asks for the processing state every 10 s until it
// is ready or failed, and writes the duration once when it is ready. fetch is
// mocked: nothing reaches the app route or Bunny.
describe("LessonContentModal — processamento na Bunny", () => {
  type Reply = { status: number | null; encodeProgress: number | null; lengthSeconds: number | null };
  const fetchMock = vi.fn();
  const replyWith = (...replies: Reply[]) => {
    fetchMock.mockReset();
    for (const reply of replies) {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => reply });
    }
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => replies[replies.length - 1] });
  };
  const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const tenSeconds = () => act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

  beforeEach(() => {
    currentAssets = [videoAsset({ bunnyVideoId: "bunny-1" })];
    bunnyConfig.isBunnyConfigured = false;
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows Processing then Ready, stops polling and writes the duration once", async () => {
    replyWith(
      { status: 3, encodeProgress: 40, lengthSeconds: null },
      { status: 4, encodeProgress: 100, lengthSeconds: 125 },
    );
    const { onUpdateLesson } = renderModal({ videoSource: "upload", durationMinutes: 1 }, "Módulo 1", true);

    await flush();
    expect(screen.getByText("Processing 40%")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/teach/video/status?assetId=asset-1");
    expect(onUpdateLesson).not.toHaveBeenCalled();

    await tenSeconds();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onUpdateLesson).toHaveBeenCalledExactlyOnceWith({ durationMinutes: 3 });

    await tenSeconds();
    await tenSeconds();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onUpdateLesson).toHaveBeenCalledOnce();
  });

  it("shows the failure text on a failed status and stops polling, without a duration", async () => {
    replyWith({ status: 5, encodeProgress: 0, lengthSeconds: null });
    const { onUpdateLesson } = renderModal({ videoSource: "upload" });

    await flush();
    expect(screen.getByText("Failed — upload again")).toBeInTheDocument();
    await tenSeconds();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onUpdateLesson).not.toHaveBeenCalled();
  });

  it("closing the studio stops polling, and a duration that already matches is not written", async () => {
    replyWith({ status: 2, encodeProgress: 10, lengthSeconds: null });
    const first = renderModal({ videoSource: "upload" });
    await flush();
    expect(fetchMock).toHaveBeenCalledOnce();
    first.unmount();
    await tenSeconds();
    await tenSeconds();
    expect(fetchMock).toHaveBeenCalledOnce();

    replyWith({ status: 4, encodeProgress: 100, lengthSeconds: 180 });
    const second = renderModal({ videoSource: "upload", durationMinutes: 3 });
    await flush();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(second.onUpdateLesson).not.toHaveBeenCalled();
  });

  it("does not poll for a video that is not on Bunny", async () => {
    currentAssets = [videoAsset()];
    renderModal({ videoSource: "upload" });

    await flush();
    await tenSeconds();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
