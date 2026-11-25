import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CourseAsset } from "@/domain/course-asset";
import type { TeacherCourse } from "@/domain/teacher-course";
import type { UploadCourseAssetProgress } from "@/lib/data/course-assets";
import { deleteCourseAsset, subscribeToCourseAssets } from "@/lib/data/course-assets";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { CONFIRM_GUARD_MS } from "@/components/ui/confirm-dialog";

// Deleting a file asks in the platform dialog (no longer in
// window.confirm). jsdom has no showModal/close: the stub does the minimum the
// browser does.
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

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
    // jsdom does not implement object URLs; the component uses them for the local preview.
    URL.createObjectURL = vi.fn(() => "blob:preview-1");
    URL.revokeObjectURL = vi.fn();
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { if (!this.hasAttribute("open")) return; this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
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
    // The type cards are gone (they repeated the select): the type is chosen in the select.
    expect(screen.queryByRole("list", { name: "Upload type" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Asset type"), { target: { value: "module_cover" } });
    fireEvent.change(screen.getByLabelText("Attach to module"), { target: { value: "m1" } });
    const file = new File(["png"], "portada-$$-$&.png", { type: "image/png" });
    const input = screen.getByLabelText("Choose a module cover file");
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("checkbox"));
    const originalPreview = screen.getByRole("img", { name: "Preview of portada-$$-$&.png" });
    expect(originalPreview).toHaveClass("aspect-[2/3]", "object-cover");
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByLabelText("Elige un archivo para Portada del módulo")).toBe(input);
    expect(screen.getByLabelText("Adjuntar al módulo")).toHaveValue("m1");
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("img", { name: "Vista previa de portada-$$-$&.png" })).toBe(originalPreview);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(mocks.uploadCourseAsset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Subir archivo" }));
    // The module cover goes through compression (async) before the upload.
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("50%"));
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

  it("also links the new cover to the module through the media library", async () => {
    const onModuleCoverUploaded = vi.fn();
    mocks.uploadCourseAsset.mockResolvedValueOnce("poster-library");
    render(<I18nProvider initialLocale="en"><CourseAssetUploader
      course={{ ...course, modules: [{ id: "m1", title: "Module", lessons: [] }] }}
      isEditable onModuleCoverUploaded={onModuleCoverUploaded}
    /></I18nProvider>);
    fireEvent.change(screen.getByLabelText("Asset type"), { target: { value: "module_cover" } });
    fireEvent.change(screen.getByLabelText("Attach to module"), { target: { value: "m1" } });
    fireEvent.change(screen.getByLabelText("Choose a module cover file"), {
      target: { files: [new File(["png"], "cover.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload asset" }));
    await waitFor(() => expect(onModuleCoverUploaded).toHaveBeenCalledWith("m1", "poster-library"));
  });

  it("shows the uploaded file in the list without waiting for a Realtime event", async () => {
    // course_assets is not in the Realtime publication: only the standalone reload
    // brings the new list.
    const uploaded: CourseAsset = { id: "a-new", courseId: course.id, ownerId: course.ownerId, kind: "course_cover", fileName: "capa.png", contentType: "image/png", size: 3, storagePath: "fixture/a-new.png", downloadUrl: "/fixture-new.png", isPreview: false, lessonId: null };
    vi.mocked(subscribeToCourseAssets).mockImplementationOnce((_courseId, onAssets) => {
      onAssets([]);
      return Object.assign(vi.fn(), { reload: vi.fn(async () => onAssets([uploaded])) });
    });
    mocks.uploadCourseAsset.mockResolvedValueOnce("a-new");
    render(<I18nProvider initialLocale="en"><CourseAssetUploader course={course} isEditable /></I18nProvider>);
    chooseCover();
    fireEvent.click(screen.getByRole("button", { name: "Upload asset" }));
    // The list names each thumbnail "<type>: <file>"; the local preview is another one.
    expect(await screen.findByRole("img", { name: /: capa\.png$/ })).toHaveAttribute("src", "/fixture-new.png");
  });

  function chooseModuleCover(file: File) {
    render(<I18nProvider initialLocale="en"><CourseAssetUploader
      course={{ ...course, modules: [{ id: "m1", title: "Module", lessons: [] }] }}
      isEditable
    /></I18nProvider>);
    fireEvent.change(screen.getByLabelText("Asset type"), { target: { value: "module_cover" } });
    fireEvent.change(screen.getByLabelText("Attach to module"), { target: { value: "m1" } });
    fireEvent.change(screen.getByLabelText("Choose a module cover file"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload asset" }));
  }

  it("module cover through the library is also cropped 2:3 and compressed", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 3000, height: 2000, close: vi.fn() })));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      { drawImage: vi.fn(), fillRect: vi.fn() } as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback: BlobCallback, type?: string) => {
      callback(new Blob(["comprimido"], { type }));
    });
    mocks.uploadCourseAsset.mockResolvedValueOnce("poster-library");

    chooseModuleCover(new File(["foto grande"], "cover.png", { type: "image/png" }));

    await waitFor(() => expect(mocks.uploadCourseAsset).toHaveBeenCalledOnce());
    const sent = mocks.uploadCourseAsset.mock.calls[0][0] as UploadInput & { kind: string; file: File };
    expect(sent.kind).toBe("module_cover");
    expect(sent.file.type).toBe("image/webp");
    expect(sent.file.name).toBe("cover.webp");
  });

  it("module cover above 10 MB through the library is refused, without uploading", () => {
    const big = new File(["x"], "enorme.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });

    chooseModuleCover(big);

    expect(screen.getByRole("alert")).toHaveTextContent("This image is over 10 MB. Choose a smaller one.");
    expect(mocks.uploadCourseAsset).not.toHaveBeenCalled();
  });

  it("translates existing upload success and delete confirmation while retaining the filename literally", async () => {
    const asset: CourseAsset = { id: "a1", courseId: course.id, ownerId: course.ownerId, kind: "course_cover", fileName: "Portada $$ $&.png", contentType: "image/png", size: 3, storagePath: "fixture/a1.png", downloadUrl: "/fixture-cover.png", isPreview: false, lessonId: null };
    mocks.assets = [asset];
    mocks.uploadCourseAsset.mockResolvedValueOnce("a2");
    render(<I18nProvider initialLocale="en"><SwitchLanguage /><CourseAssetUploader course={course} isEditable /></I18nProvider>);
    chooseCover();
    fireEvent.click(screen.getByRole("button", { name: "Upload asset" }));
    await screen.findByText("Asset uploaded.");
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByText("Archivo subido.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Portada del curso: Portada $$ $&.png" })).toHaveAttribute("src", "/fixture-cover.png");
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    // The usual sentence, now in the dialog; giving up deletes nothing.
    const dialog = screen.getByRole("dialog", { name: "¿Eliminar este archivo?" });
    expect(dialog).toHaveTextContent('¿Eliminar "Portada $$ $&.png"? El archivo se eliminará de forma permanente.');
    fireEvent.click(within(dialog).getByRole("button", { name: "Mantener el archivo" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
    // Only Date is fake: the confirm ignores clicks in the first 500ms.
    vi.useFakeTimers({ toFake: ["Date"] });
    const onAssetDeleted = vi.fn();
    render(<I18nProvider initialLocale="en"><SwitchLanguage /><CourseAssetUploader course={course} isEditable onAssetDeleted={onAssetDeleted} /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete this file?" });
    expect(dialog).toHaveTextContent('Delete "Portada.png"? This permanently removes the file.');
    vi.advanceTimersByTime(CONFIRM_GUARD_MS);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete file" }));
    await screen.findByText(fails ? /We could not delete this asset/ : "Asset deleted.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Success: the notice is announced (role="status"); failure: only the error.
    if (fails) expect(screen.queryByRole("status")).not.toBeInTheDocument();
    else expect(screen.getByRole("status")).toHaveTextContent("Asset deleted.");
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByText(fails ? "No pudimos eliminar este archivo. Comprueba la propiedad del curso y los permisos actuales." : "Archivo eliminado.")).toBeInTheDocument();
    expect(deleteCourseAsset).toHaveBeenCalledExactlyOnceWith(asset);
    expect(onAssetDeleted).toHaveBeenCalledTimes(fails ? 0 : 1);
    expect(subscribeToCourseAssets).toHaveBeenCalledOnce();
    expect(mocks.uploadCourseAsset).not.toHaveBeenCalled();
  });

  // The only limit written on the screen was the bucket's (500 MB), ten times the real
  // plan cap. The teacher prepared the file within it and was refused.
  it("shows the real cap before the teacher chooses the file", () => {
    render(<CourseAssetUploader course={course} isEditable />);

    expect(screen.getByText(/Image up to 50\.0 MB\./)).toBeInTheDocument();
    expect(screen.queryByText(/500\.0 MB/)).not.toBeInTheDocument();
  });

  it("shows a preview of the chosen image before uploading", () => {
    render(<CourseAssetUploader course={course} isEditable />);

    chooseCover();

    expect(screen.getByRole("img", { name: "Preview of capa.png" })).toHaveAttribute(
      "src",
      "blob:preview-1",
    );
  });

  it("shows the thumbnail of the covers already uploaded", () => {
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

  // The catch discarded the error without reading it and blamed "permissions" — even for
  // the 413 size cap, whose right message already came ready from the domain.
  it("shows the real reason when the upload fails, not the permission accusation", async () => {
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

  // The bar stayed at 0% for the whole upload (Storage does not report progress) and
  // that read as "stuck". Without a number from the transport, there is no number on screen.
  it("does not invent a percentage when the transport does not report progress", async () => {
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

  it("shows the bar when the transport really reports a percentage", async () => {
    mocks.uploadCourseAsset.mockImplementation((input) => {
      input.onProgress?.(running(42));
      return new Promise(() => undefined);
    });

    render(<CourseAssetUploader course={course} isEditable />);
    chooseCover();
    fireEvent.click(screen.getByRole("button", { name: "Upload asset" }));

    expect(await screen.findByRole("status")).toHaveTextContent("42%");
    // Fixed label: the button does not become "Uploading..."; the progress is only the note.
    expect(screen.getByRole("button", { name: "Upload asset" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Uploading...")).toBeNull();
    // The ring takes the place that the waiting face already reserved: same width.
    expect(screen.getByRole("button", { name: "Upload asset" }).querySelectorAll('[class*="grid-area"]')).toHaveLength(2);
  });

  // Failed after starting: the old progress must not stay on screen next to
  // the red box saying it was not possible to upload.
  it("clears the progress when the upload fails", async () => {
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
