import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import type { CourseAsset } from "@/domain/course-asset";
import type { TeacherCourse, TeacherLesson } from "@/domain/teacher-course";

/**
 * Lesson studio, Materials tab (and the e-book screen, which is the same list):
 *   - the teacher names the file and changes the order;
 *   - the "Allow this file in the public preview" box is gone (it did nothing);
 *   - .epub, .xmind and .mm come in through the picker.
 */
const mocks = vi.hoisted(() => ({
  assets: [] as CourseAsset[],
  rename: vi.fn(),
  saveOrder: vi.fn(),
  upload: vi.fn(),
  reload: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/courses/bunny-video-player", () => ({ BunnyVideoPlayer: () => null }));
vi.mock("@/components/shared/protected-asset-preview", () => ({ ProtectedAssetPreview: () => null }));
vi.mock("@/components/learn/trusted-embed-player", () => ({ TrustedEmbedPlayer: () => null }));
vi.mock("@/lib/bunny/config", () => ({ isBunnyConfigured: false }));
vi.mock("@/lib/data/course-assets", () => ({
  CourseAssetUploadCancelled: class extends Error {},
  deleteCourseAsset: vi.fn(),
  renameCourseAsset: mocks.rename,
  saveCourseAssetOrder: mocks.saveOrder,
  uploadCourseAsset: mocks.upload,
  uploadLessonVideoToBunny: vi.fn(),
  subscribeToCourseAssets: (_courseId: string, onAssets: (assets: CourseAsset[]) => void) => {
    onAssets(mocks.assets);
    return Object.assign(() => {}, { reload: mocks.reload });
  },
}));

const { LessonContentModal } = await import("@/components/teacher/lesson-content-modal");

const lesson: TeacherLesson = { id: "lesson-1", title: "Aula", type: "video", description: "" };
const course: TeacherCourse = {
  id: "course-1", ownerId: "owner-1", title: "Curso", summary: "", category: "geral",
  status: "draft", lessonCount: 1, modules: [{ id: "module-1", title: "Módulo", lessons: [lesson] }],
};

function material(id: string, fileName: string, title: string | null, position: number): CourseAsset {
  return {
    id, courseId: "course-1", ownerId: "owner-1", kind: "lesson_material", fileName,
    contentType: "application/pdf", size: 1024, storagePath: `courses/course-1/${id}`,
    isPreview: false, lessonId: "lesson-1", title, position,
  };
}

function renderModal(filesOnly = false) {
  return render(
    <I18nProvider initialLocale="en">
      <LessonContentModal
        course={course} module={course.modules[0]} moduleIndex={0} lesson={lesson} lessonIndex={0}
        isEditable isFreePreview={false} dripStrategy="instant" filesOnly={filesOnly}
        onClose={vi.fn()} onSetFreePreview={vi.fn()} onUpdateLesson={vi.fn()}
      />
    </I18nProvider>,
  );
}

beforeEach(() => {
  mocks.assets = [material("slides", "slides-v3.pdf", null, 0), material("workbook", "wb.pdf", "Workbook", 1)];
  for (const fn of [mocks.rename, mocks.saveOrder, mocks.upload, mocks.reload]) fn.mockReset();
  mocks.rename.mockResolvedValue(undefined);
  mocks.saveOrder.mockResolvedValue(undefined);
  mocks.upload.mockResolvedValue("new-asset");
  mocks.reload.mockResolvedValue(undefined);
});

describe("name and order of materials", () => {
  it("the teacher renames the file; the original name stays visible", async () => {
    renderModal(true);

    const fields = screen.getAllByLabelText("Name students see");
    expect(fields.map((field) => (field as HTMLInputElement).value)).toEqual(["slides-v3.pdf", "Workbook"]);
    expect(screen.getByText("File: wb.pdf")).toBeInTheDocument();

    fireEvent.change(fields[0], { target: { value: "  Slides  " } });
    await act(async () => {
      fireEvent.blur(fields[0]);
    });

    expect(mocks.rename).toHaveBeenCalledExactlyOnceWith("slides", "Slides");
    expect(mocks.reload).toHaveBeenCalled();
    expect(screen.getByText("Name saved.")).toBeInTheDocument();
    // Below the renamed field, not in the upload box above the list.
    expect(screen.getByText("Name saved.").closest("article")).toBe(fields[0].closest("article"));
    expect(screen.getByText("Name saved.")).toHaveAttribute("role", "status");
    // Typing again: the "saved" no longer applies.
    fireEvent.change(screen.getAllByLabelText("Name students see")[0], { target: { value: "Slides 2" } });
    expect(screen.queryByText("Name saved.")).toBeNull();
  });

  it("leaving the field without changing anything does not save", () => {
    renderModal(true);

    fireEvent.blur(screen.getAllByLabelText("Name students see")[1]);

    expect(mocks.rename).not.toHaveBeenCalled();
  });

  it("the teacher moves the file up the list; only the new order goes to the database", async () => {
    renderModal(true);

    expect(screen.getByRole("button", { name: 'Move "slides-v3.pdf" up' })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: 'Move "Workbook" down' })).toHaveAttribute("aria-disabled", "true");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: 'Move "Workbook" up' }));
    });

    expect(mocks.saveOrder).toHaveBeenCalledOnce();
    expect(mocks.saveOrder.mock.calls[0][0].map((asset: CourseAsset) => asset.id)).toEqual(["workbook", "slides"]);
    expect(screen.getByText("Order saved.")).toBeInTheDocument();
  });

  // Keyboard users: the focused button must not become `disabled` during
  // saving (focus used to jump to the top of the page). It stays marked and ignores the click.
  it("while saving, the arrows stay focusable and ignore another click", async () => {
    let finish!: () => void;
    mocks.saveOrder.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderModal(true);
    const up = screen.getByRole("button", { name: 'Move "Workbook" up' });
    up.focus();

    await act(async () => {
      fireEvent.click(up);
    });
    expect(up).not.toBeDisabled();
    expect(up).toHaveAttribute("aria-disabled", "true");
    expect(document.activeElement).toBe(up);
    await act(async () => {
      fireEvent.click(up);
      fireEvent.click(screen.getByRole("button", { name: 'Move "slides-v3.pdf" down' }));
    });
    expect(mocks.saveOrder).toHaveBeenCalledOnce();

    await act(async () => finish());
    expect(screen.getByText("Order saved.")).toBeInTheDocument();
    expect(document.activeElement).toBe(up);
  });

  it("clicking the arrow at the end of the list does nothing", async () => {
    renderModal(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: 'Move "slides-v3.pdf" up' }));
    });

    expect(mocks.saveOrder).not.toHaveBeenCalled();
  });

  it("a name that was not saved (no row changed) warns, without saying 'saved'", async () => {
    mocks.rename.mockRejectedValueOnce(new Error("course-asset-not-updated"));
    renderModal(true);
    const field = screen.getAllByLabelText("Name students see")[0];

    fireEvent.change(field, { target: { value: "Slides" } });
    await act(async () => {
      fireEvent.blur(field);
    });

    expect(screen.getByText("We could not save this change. Try again.")).toBeInTheDocument();
    expect(screen.getByText("We could not save this change. Try again.").closest("article")).toBe(field.closest("article"));
    expect(screen.queryByText("Name saved.")).toBeNull();
  });

  it("a failure saving the order warns, without pretending it saved", async () => {
    mocks.saveOrder.mockRejectedValueOnce(new Error("denied"));
    renderModal(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: 'Move "slides-v3.pdf" down' }));
    });

    expect(screen.getByText("We could not save this change. Try again.")).toBeInTheDocument();
    expect(screen.queryByText("Order saved.")).toBeNull();
  });
});

describe("material upload", () => {
  it("the public preview box is gone, in every tab", () => {
    renderModal();
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /^Materials/ }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/public preview/i)).toBeNull();
  });

  it.each(["mapa.xmind", "mapa.mm", "livro.epub"])("accepts %s and uploads it as an enrolled-only material", async (name) => {
    renderModal(true);
    const input = screen.getByLabelText("Lesson material");
    expect(input.getAttribute("accept")).toEqual(expect.stringContaining(`.${name.split(".").pop()}`));

    fireEvent.change(input, { target: { files: [new File(["x"], name, { type: "" })] } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
    });

    expect(mocks.upload).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      kind: "lesson_material", isPreview: false, file: expect.objectContaining({ name }),
    }));
    expect(within(document.body).queryByText(/Use a valid/)).toBeNull();
  });
});
