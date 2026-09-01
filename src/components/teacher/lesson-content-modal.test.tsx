import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    onAssets(currentAssets);
    return () => {};
  },
}));

// Sem Bunny no teste: o envio segue pelo Supabase Storage, que é o caminho que
// roda quando a integração de vídeo ainda não foi ligada num ambiente.
vi.mock("@/lib/bunny/config", () => ({ isBunnyConfigured: false }));

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

function renderModal(lessonOverrides: Partial<TeacherLesson> = {}) {
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
    modules: [{ id: "module-1", title: "Módulo 1", lessons: [lesson] }],
  };

  const onUpdateLesson = vi.fn();

  render(
    <LessonContentModal
      course={course}
      module={course.modules[0]}
      moduleIndex={0}
      lesson={lesson}
      lessonIndex={0}
      isEditable
      isFreePreview={false}
      onClose={vi.fn()}
      onSetFreePreview={vi.fn()}
      onUpdateLesson={onUpdateLesson}
    />,
  );

  return { onUpdateLesson, lesson };
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
    vi.clearAllMocks();
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
});
