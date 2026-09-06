import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CourseAsset } from "@/domain/course-asset";
import type { TeacherCourse, TeacherLesson } from "@/domain/teacher-course";

const deleteCourseAsset = vi.fn<(asset: CourseAsset) => Promise<void>>(
  async () => {},
);
const uploadCourseAsset = vi.fn<(input: unknown) => Promise<void>>(async () => {});
const uploadLessonVideoToBunny = vi.fn<(input: unknown) => Promise<void>>(
  async () => {},
);
let currentAssets: CourseAsset[] = [];
let emitAssets: (assets: CourseAsset[]) => void;

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
  ) => {
    emitAssets = onAssets;
    onAssets(currentAssets);
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

function renderModal(lessonOverrides: Partial<TeacherLesson> = {}, moduleTitle = "Módulo 1") {
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

  const modal = (nextLesson: TeacherLesson) => (
    <LessonContentModal
      course={course}
      module={course.modules[0]}
      moduleIndex={0}
      lesson={nextLesson}
      lessonIndex={0}
      isEditable
      isFreePreview={false}
      onClose={vi.fn()}
      onSetFreePreview={vi.fn()}
      onUpdateLesson={onUpdateLesson}
    />
  );
  const view = render(modal(lesson));

  return { onUpdateLesson, lesson, rerenderLesson: (patch: Partial<TeacherLesson>) => view.rerender(modal({ ...lesson, ...patch })) };
}

function chooseVideoFile() {
  const file = new File(["video-bytes"], "aula.mp4", { type: "video/mp4" });

  fireEvent.change(screen.getByLabelText("Upload a lesson video"), {
    target: { files: [file] },
  });

  return file;
}

describe("LessonContentModal — video tab", () => {
  beforeEach(() => {
    currentAssets = [];
    bunnyConfig.isBunnyConfigured = false;
    vi.clearAllMocks();
  });

  it("keeps full lesson identity in the content scroll and preview ahead of setup guidance", () => {
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
    for (const laterContent of [
      screen.getByLabelText("Upload a lesson video"),
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

  it("shows the uploaded thumbnail image in Settings", () => {
    currentAssets = [videoAsset({ kind: "lesson_thumbnail", contentType: "image/png", fileName: "thumbnail.png", downloadUrl: "https://example.supabase.co/storage/v1/object/public/public-media/thumbnail.png" })];
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /^Settings/ }));
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
