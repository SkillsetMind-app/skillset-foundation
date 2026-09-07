import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CourseAsset } from "@/domain/course-asset";
import type { TeacherCourse } from "@/domain/teacher-course";
import type { UploadCourseAssetProgress } from "@/lib/data/course-assets";
import { deleteCourseAsset, subscribeToCourseAssets } from "@/lib/data/course-assets";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";

type UploadInput = {
  onProgress?: (progress: UploadCourseAssetProgress) => void;
};

const mocks = vi.hoisted(() => ({
  assets: [] as CourseAsset[],
  uploadCourseAsset: vi.fn<(input: UploadInput) => Promise<string>>(),
  unsubscribe: vi.fn(),
  router: { refresh: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));

vi.mock("@/lib/data/course-assets", () => ({
  deleteCourseAsset: vi.fn(),
  uploadCourseAsset: (input: UploadInput) => mocks.uploadCourseAsset(input),
  subscribeToCourseAssets: vi.fn((
    _courseId: string,
    onAssets: (assets: CourseAsset[]) => void,
  ) => {
    onAssets(mocks.assets);
    return mocks.unsubscribe;
  }),
}));

const { CourseAssetUploader } = await import(
  "@/components/teacher/course-asset-uploader"
);

const course: TeacherCourse = {
  id: "course-1",
  ownerId: "owner-1",
  title: "Curso",
  summary: "",
  category: "geral",
  status: "draft",
  lessonCount: 0,
  modules: [],
};

function running(percent: number | null): UploadCourseAssetProgress {
  return { bytesTransferred: 0, totalBytes: 3, percent, state: "running" };
}

function chooseCover() {
  const file = new File(["png"], "capa.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("Choose a course cover file"), {
    target: { files: [file] },
  });
  return file;
}

function SwitchLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Switch language</button>;
}

describe("CourseAssetUploader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assets = [];
    mocks.uploadCourseAsset.mockReset();
    // jsdom não implementa object URLs; o componente usa para a prévia local.
    URL.createObjectURL = vi.fn(() => "blob:preview-1");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("explains the cover-only uploader and directs lesson media to the existing studio in both languages", () => {
    render(<I18nProvider initialLocale="en"><SwitchLanguage /><CourseAssetUploader course={course} isEditable /></I18nProvider>);
    expect(screen.getByRole("heading", { name: "Upload covers and manage course media." })).toBeInTheDocument();
    expect(screen.queryByText("Upload covers, videos, and materials for this course.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("heading", { name: "Sube portadas y gestiona los archivos del curso." })).toBeInTheDocument();
    expect(screen.getByText(/Para los vídeos, materiales y miniaturas de cada lección/)).toHaveTextContent("Contenido");
    expect(screen.getByText("Aún no hay archivos. Empieza por la portada de un curso o módulo.")).toBeInTheDocument();
    expect(screen.getByLabelText("Tipo de archivo")).toHaveValue("course_cover");
    expect(subscribeToCourseAssets).toHaveBeenCalledOnce();
    expect(mocks.uploadCourseAsset).not.toHaveBeenCalled();
  });

  it("retains the selected module, file, preview and object URL through language changes and a pending upload", async () => {
    let rejectUpload: (error: Error) => void = () => {};
    mocks.uploadCourseAsset.mockImplementationOnce((input) => {
      input.onProgress?.({ bytesTransferred: 512, totalBytes: 1024, percent: 50, state: "running" });
      return new Promise<string>((_resolve, reject) => { rejectUpload = reject; });
    });
    const targetCourse = { ...course, modules: [{ id: "m1", title: "Módulo $$ $&", lessons: [] }] };
    const { unmount } = render(<I18nProvider initialLocale="en"><SwitchLanguage /><CourseAssetUploader course={targetCourse} isEditable /></I18nProvider>);
    fireEvent.click(within(screen.getByRole("list", { name: "Upload type" })).getByText("Module cover").closest("button")!);
    fireEvent.change(screen.getByLabelText("Attach to module"), { target: { value: "m1" } });
    const file = new File(["png"], "portada-$$-$&.png", { type: "image/png" });
    const input = screen.getByLabelText("Choose a module cover file");
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("checkbox"));
    const originalPreview = screen.getByRole("img", { name: "Preview of portada-$$-$&.png" });
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByLabelText("Elige un archivo para Portada del módulo")).toBe(input);
    expect(screen.getByLabelText("Adjuntar al módulo")).toHaveValue("m1");
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("img", { name: "Vista previa de portada-$$-$&.png" })).toBe(originalPreview);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(mocks.uploadCourseAsset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Subir archivo" }));
    expect(screen.getByRole("status")).toHaveTextContent("50%");
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("status")).toHaveTextContent("50%");
    expect(input).toBeDisabled();
    expect(mocks.uploadCourseAsset).toHaveBeenCalledOnce();
    expect(mocks.uploadCourseAsset.mock.calls[0][0]).toMatchObject({ kind: "module_cover", moduleId: "m1", isPreview: true, file });
    await act(async () => rejectUpload(Object.assign(new Error("permission"), { status: 403 })));
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("No tienes permiso para subir archivos a este curso.");
    expect(input).not.toBeDisabled();
    expect(screen.getByLabelText("Adjuntar al módulo")).toHaveValue("m1");
    expect(subscribeToCourseAssets).toHaveBeenCalledOnce();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:preview-1");
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it("translates existing upload success and delete confirmation while retaining the filename literally", async () => {
    const asset: CourseAsset = { id: "a1", courseId: course.id, ownerId: course.ownerId, kind: "course_cover", fileName: "Portada $$ $&.png", contentType: "image/png", size: 3, storagePath: "fixture/a1.png", downloadUrl: "/fixture-cover.png", isPreview: false, lessonId: null };
    mocks.assets = [asset];
    mocks.uploadCourseAsset.mockResolvedValueOnce("a2");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<I18nProvider initialLocale="en"><SwitchLanguage /><CourseAssetUploader course={course} isEditable /></I18nProvider>);
    chooseCover();
    fireEvent.click(screen.getByRole("button", { name: "Upload asset" }));
    await screen.findByText("Asset uploaded.");
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByText("Archivo subido.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Portada del curso: Portada $$ $&.png" })).toHaveAttribute("src", "/fixture-cover.png");
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(confirm).toHaveBeenCalledExactlyOnceWith('¿Eliminar "Portada $$ $&.png"? El archivo se eliminará de forma permanente.');
    expect(deleteCourseAsset).not.toHaveBeenCalled();
    expect(mocks.uploadCourseAsset).toHaveBeenCalledOnce();
    expect(subscribeToCourseAssets).toHaveBeenCalledOnce();
  });

  it("keeps the rejected file type in a validation message after changing kind and language", () => {
    render(<I18nProvider initialLocale="en"><SwitchLanguage /><CourseAssetUploader course={course} isEditable /></I18nProvider>);
    fireEvent.change(screen.getByLabelText("Asset type"), { target: { value: "module_cover" } });
    const file = new File(["fixture"], "document.pdf", { type: "application/pdf" });
    const input = screen.getByLabelText("Choose a module cover file");
    fireEvent.change(input, { target: { files: [file] } });
    // Submit the form to exercise its guard even when the native button is disabled.
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent("Use a valid module cover file under 50.0 MB.");
    fireEvent.change(screen.getByLabelText("Asset type"), { target: { value: "course_cover" } });
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Usa un archivo válido de portada del módulo de menos de 50.0 MB.");
    expect(screen.getByLabelText("Tipo de archivo")).toHaveValue("course_cover");
    expect(mocks.uploadCourseAsset).not.toHaveBeenCalled();
    expect(subscribeToCourseAssets).toHaveBeenCalledOnce();
  });

  it.each([false, true])("translates a settled deletion without repeating it (failure=%s)", async (fails) => {
    const asset: CourseAsset = { id: "a1", courseId: course.id, ownerId: course.ownerId, kind: "course_cover", fileName: "Portada.png", contentType: "image/png", size: 3, storagePath: "fixture/a1.png", downloadUrl: "/fixture-cover.png", isPreview: false, lessonId: null };
    mocks.assets = [asset];
    if (fails) vi.mocked(deleteCourseAsset).mockRejectedValueOnce(new Error("Fixture failure"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<I18nProvider initialLocale="en"><SwitchLanguage /><CourseAssetUploader course={course} isEditable /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByText(fails ? /We could not delete this asset/ : "Asset deleted.");
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByText(fails ? "No pudimos eliminar este archivo. Comprueba la propiedad del curso y los permisos actuales." : "Archivo eliminado.")).toBeInTheDocument();
    expect(deleteCourseAsset).toHaveBeenCalledExactlyOnceWith(asset);
    expect(subscribeToCourseAssets).toHaveBeenCalledOnce();
    expect(mocks.uploadCourseAsset).not.toHaveBeenCalled();
  });

  // O único limite escrito na tela era o do bucket (500 MB), dez vezes o teto
  // real do plano. O professor preparava o arquivo dentro dele e era recusado.
  it("mostra o teto real antes de o professor escolher o arquivo", () => {
    render(<CourseAssetUploader course={course} isEditable />);

    expect(screen.getByText(/Image up to 50\.0 MB\./)).toBeInTheDocument();
    expect(screen.queryByText(/500\.0 MB/)).not.toBeInTheDocument();
  });

  it("mostra a prévia da imagem escolhida antes de enviar", () => {
    render(<CourseAssetUploader course={course} isEditable />);

    chooseCover();

    expect(screen.getByRole("img", { name: "Preview of capa.png" })).toHaveAttribute(
      "src",
      "blob:preview-1",
    );
  });

  it("mostra a miniatura das capas já enviadas", () => {
    mocks.assets = [
      {
        id: "asset-1",
        courseId: "course-1",
        ownerId: "owner-1",
        kind: "course_cover",
        fileName: "capa.png",
        contentType: "image/png",
        size: 2048,
        storagePath: "courses/course-1/assets/owner-1/asset-1/capa.png",
        downloadUrl: "https://media.example/public-media/capa.png",
        isPreview: false,
        lessonId: null,
      },
    ];

    render(<CourseAssetUploader course={course} isEditable />);

    expect(
      screen.getByRole("img", { name: "Course cover: capa.png" }),
    ).toHaveAttribute("src", "https://media.example/public-media/capa.png");
  });

  // O catch descartava o erro sem ler e culpava "permissões" — inclusive para
  // o 413 do teto de tamanho, cuja mensagem certa já vinha pronta do domínio.
  it("mostra o motivo real quando o envio falha, não a acusação de permissão", async () => {
    mocks.uploadCourseAsset.mockRejectedValueOnce(
      new Error(
        "This file exceeds the current upload limit (~50.0 MB). Use a YouTube link or a smaller file.",
      ),
    );

    render(<CourseAssetUploader course={course} isEditable />);
    chooseCover();
    fireEvent.click(screen.getByRole("button", { name: "Upload asset" }));

    expect(
      await screen.findByText(/exceeds the current upload limit/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/course ownership/)).not.toBeInTheDocument();
  });

  // A barra ficava em 0% o envio inteiro (o Storage não informa progresso) e
  // isso se lia como "travou". Sem número do transporte, não há número na tela.
  it("não inventa porcentagem quando o transporte não informa progresso", async () => {
    mocks.uploadCourseAsset.mockImplementation((input) => {
      input.onProgress?.(running(null));
      return new Promise(() => undefined);
    });

    render(<CourseAssetUploader course={course} isEditable />);
    chooseCover();
    fireEvent.click(screen.getByRole("button", { name: "Upload asset" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Sending...");
    expect(status).not.toHaveTextContent("%");
  });

  it("mostra a barra quando o transporte informa porcentagem de verdade", async () => {
    mocks.uploadCourseAsset.mockImplementation((input) => {
      input.onProgress?.(running(42));
      return new Promise(() => undefined);
    });

    render(<CourseAssetUploader course={course} isEditable />);
    chooseCover();
    fireEvent.click(screen.getByRole("button", { name: "Upload asset" }));

    expect(await screen.findByRole("status")).toHaveTextContent("42%");
  });

  // Falhou depois de começar: o progresso antigo não pode ficar na tela ao
  // lado da caixa vermelha dizendo que não foi possível enviar.
  it("limpa o progresso quando o envio falha", async () => {
    mocks.uploadCourseAsset.mockImplementation(async (input) => {
      input.onProgress?.(running(null));
      throw new Error("Row-level security policy violation");
    });

    render(<CourseAssetUploader course={course} isEditable />);
    chooseCover();
    fireEvent.click(screen.getByRole("button", { name: "Upload asset" }));

    expect(await screen.findByText(/do not have permission/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });
});
