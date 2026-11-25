import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import type { TeacherCourse } from "@/domain/teacher-course";
import { uploadCourseAsset } from "@/lib/data/course-assets";
import { updateTeacherCourseBuilder } from "@/lib/data/teacher-courses";

// What the person suffered: the Curriculum tab opened with two big forms,
// always expanded - "Add module" and "Add lesson" (the latter with a "Choose
// module" select they had to get right every time) - and only AFTER them came the list
// of modules, which is what they came to see. At the end of the same tab came the
// whole media library: 3,138 px of scrolling.

const mocks = vi.hoisted(() => {
  const course: TeacherCourse = {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Clinical performance foundations",
    summary: "Build a repeatable practice for evidence-informed performance work.",
    category: "Applied Psychology & Behavior",
    categories: ["Applied Psychology & Behavior"],
    status: "draft",
    modules: [
      { id: "m1", title: "Start here", lessons: [] },
      { id: "m2", title: "Deep work", lessons: [] },
    ],
    lessonCount: 0,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
  };

  return {
    course,
    // The SAME object on every render: a new user per render resubscribes the
    // effects and enters a loop.
    user: { uid: "teacher-1" },
    router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
    searchParams: new URLSearchParams("courseId=course-1&tab=content"),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourse: vi.fn((_id: string, onData: (course: TeacherCourse) => void) => {
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
  fetchCreatorActivationBlocked: () => Promise.resolve(false),
}));

vi.mock("@/lib/data/course-assets", () => ({
  fetchCourseAssets: () => Promise.resolve([]),
  subscribeToCourseAssets: vi.fn(() => () => undefined),
  syncLessonPreviewAssets: () => Promise.resolve(),
  uploadCourseAsset: vi.fn(),
}));

// A marker in place of the library: what is proven here is WHEN it enters the
// screen, not what it does inside (that is course-asset-uploader.test.tsx).
vi.mock("@/components/teacher/course-asset-uploader", () => ({
  CourseAssetUploader: () => <div>BIBLIOTECA DE MIDIA</div>,
}));

function tree() {
  return (
    <I18nProvider initialLocale="en">
      <CourseBuilderStudio />
    </I18nProvider>
  );
}

function renderBuilder() {
  return render(tree());
}

// Slice 4: cover, description and lessons live on the module page (?module=M).
function abrirModulo(id: string) {
  mocks.searchParams = new URLSearchParams(`courseId=course-1&tab=content&module=${id}`);
}

function curriculumCard() {
  const card = document.querySelector("#builder-sec-modules");
  if (!card) throw new Error("the module list is not on the content tab");
  return card as HTMLElement;
}

describe("Curriculum tab: the module list comes first", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams("courseId=course-1&tab=content");
  });

  afterEach(() => {
    cleanup();
  });

  it("opens with the module list and no form open", async () => {
    renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });

    const card = curriculumCard();
    expect(card.querySelectorAll("form")).toHaveLength(0);
    expect(card.querySelectorAll("article")).toHaveLength(2);
    // One row per module; the name is edited on its page.
    expect(within(card).getByRole("link", { name: /Start here/ })).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /Deep work/ })).toBeInTheDocument();
    // The select the person had to get right on every lesson no longer exists.
    expect(screen.queryByRole("combobox", { name: "Module for this lesson" })).not.toBeInTheDocument();
    // The list is the first thing on the tab, not the third.
    expect(card.previousElementSibling).toBeNull();
  });

  it("opens title and description together when creating a module", async () => {
    renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });

    fireEvent.click(screen.getByRole("button", { name: "Add module" }));
    const form = curriculumCard().querySelector("form");
    expect(form).not.toBeNull();
    expect(within(form as HTMLElement).getByRole("textbox", { name: "Module title" })).toHaveValue("");
    expect(within(form as HTMLElement).getByRole("textbox", { name: "Module description" })).toBeVisible();
    expect((form as HTMLElement).querySelector("details")).toBeNull();

    // The validation that already existed still stands.
    fireEvent.click(screen.getByRole("button", { name: "Create module" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add a module title before creating the module.");

    fireEvent.change(screen.getByRole("textbox", { name: "Module title" }), {
      target: { value: "Recovery" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create module" }));
    expect(within(curriculumCard()).getByRole("link", { name: /Recovery/ })).toBeInTheDocument();
    expect(curriculumCard().querySelectorAll("form")).toHaveLength(0);
    // The new module opens on its page.
    expect(mocks.router.push).toHaveBeenLastCalledWith(
      expect.stringMatching(/[?&]module=module-/),
      { scroll: false },
    );
  });

  it("creates the lesson inside the open module, with no module select", async () => {
    abrirModulo("m2");
    renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });

    fireEvent.click(screen.getByRole("button", { name: "Add lesson to module 2" }));
    expect(screen.queryByRole("combobox", { name: "Module for this lesson" })).not.toBeInTheDocument();
    expect(screen.queryByText("Choose module")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Lesson title" }), {
      target: { value: "Focus blocks" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add lesson" }));

    expect(within(curriculumCard()).getByText("1 lesson")).toBeInTheDocument();
    // The form lives at the end of the list: the new row comes before it.
    const [row, formInput] = within(curriculumCard()).getAllByRole("textbox", { name: "Lesson title" });
    expect(row).toHaveValue("Focus blocks");
    expect(row.compareDocumentPosition(formInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(formInput.closest("form")).not.toBeNull();
    expect(within(curriculumCard()).getByRole("status")).toHaveTextContent("Lesson added — opening the lesson studio once it autosaves...");
    fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalled());
    const saved = vi.mocked(updateTeacherCourseBuilder).mock.calls.at(-1)?.[1].modules;
    expect(saved?.[0].lessons).toEqual([]);
    expect(saved?.[1].lessons).toEqual([expect.objectContaining({ title: "Focus blocks" })]);
  });

  // The curriculum header said "1 modules / 1 lessons" and the structure,
  // "1 modules, 1 lessons" — in EN and in ES (visual QA in production, Sept 8).
  it("counts in the singular: 1 module, 1 lesson", async () => {
    const modulesOriginais = mocks.course.modules;
    mocks.course.modules = [
      {
        id: "m1",
        title: "Start here",
        lessons: [{ id: "l1", title: "Welcome", type: "text", description: "" }],
      },
    ];
    try {
      renderBuilder();
      await screen.findByRole("heading", { name: mocks.course.title });

      // The count lives in the tab header; the "Course structure" card at the
      // footer, which repeated it ("1 module, 1 lesson"), is gone.
      expect(screen.getByText("1 module")).toBeInTheDocument();
      // Tab header and the module row.
      expect(screen.getAllByText("1 lesson").length).toBeGreaterThan(0);
      expect(screen.queryByText("1 modules")).not.toBeInTheDocument();
      expect(screen.queryByText("1 lessons")).not.toBeInTheDocument();
    } finally {
      mocks.course.modules = modulesOriginais;
    }
  });

  it("does not render the media library until someone opens it", async () => {
    renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });

    expect(screen.queryByText("BIBLIOTECA DE MIDIA")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open media library" }));
    expect(screen.getByText("BIBLIOTECA DE MIDIA")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide media library" }));
    expect(screen.queryByText("BIBLIOTECA DE MIDIA")).not.toBeInTheDocument();
  });

  it("uploads the cover through the right module and saves the asset without touching the lessons", async () => {
    vi.mocked(uploadCourseAsset).mockResolvedValueOnce("poster-new");
    abrirModulo("m2");
    renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });
    const poster = screen.getByRole("region", { name: "Module cover" });
    expect(poster.querySelector('.aspect-\\[2\\/3\\]')).not.toBeNull();
    const description = screen.getByRole("textbox", { name: "Module 2 description" });
    expect(description.closest("details")).toBeNull();
    const file = new File(["png"], "module.png", { type: "image/png" });
    fireEvent.change(within(poster).getByLabelText("Module cover"), { target: { files: [file] } });
    await waitFor(() => expect(uploadCourseAsset).toHaveBeenCalledWith(expect.objectContaining({
      courseId: "course-1", ownerId: "teacher-1", moduleId: "m2", kind: "module_cover", file,
    })));
    fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalled());
    expect(vi.mocked(updateTeacherCourseBuilder).mock.calls.at(-1)?.[1].modules).toEqual([
      expect.objectContaining({ id: "m1", title: "Start here", lessons: [] }),
      expect.objectContaining({ id: "m2", title: "Deep work", coverAssetId: "poster-new", lessons: [] }),
    ]);
  });

  it("does not allow a cover on a module not yet saved nor ask for lesson minutes", async () => {
    const { rerender } = renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });
    fireEvent.click(screen.getByRole("button", { name: "Add module" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Module title" }), { target: { value: "New module" } });
    fireEvent.click(screen.getByRole("button", { name: "Create module" }));
    // The new module opens on its page: it follows the URL the builder pushed.
    const destino = String(mocks.router.push.mock.calls.at(-1)?.[0]);
    mocks.searchParams = new URL(destino, "https://example.test").searchParams;
    rerender(tree());
    expect(screen.getByLabelText("Module cover", { selector: "input" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add lesson to module 3" }));
    expect(screen.queryByRole("textbox", { name: "Lesson duration" })).not.toBeInTheDocument();
    expect(screen.queryByText("Minutes", { exact: true })).not.toBeInTheDocument();
  });

  it("refuses an invalid file and allows repeating a cover whose upload failed", async () => {
    vi.mocked(uploadCourseAsset).mockRejectedValueOnce(new Error("network"));
    abrirModulo("m1");
    renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });
    fireEvent.change(screen.getByLabelText("Module cover", { selector: "input" }), {
      target: { files: [new File(["video"], "lesson.mp4", { type: "video/mp4" })] },
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(uploadCourseAsset).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Module cover", { selector: "input" }), {
      target: { files: [new File(["png"], "poster.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(uploadCourseAsset).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText("Module cover", { selector: "input" })).toBeEnabled());
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  });

  // Decision of Sept 14: the lesson shows only the title and the content button. Type,
  // wait days, grade, text and link left the screen (not the database).
  it("lesson row and form show only the title", async () => {
    const modulesOriginais = mocks.course.modules;
    mocks.course.modules = [
      {
        id: "m1",
        title: "Start here",
        lessons: [{ id: "l1", title: "Welcome", type: "text", description: "" }],
      },
    ];
    try {
      abrirModulo("m1");
      renderBuilder();
      await screen.findByRole("heading", { name: mocks.course.title });

      expect(screen.getByRole("textbox", { name: "Lesson title" })).toHaveValue("Welcome");
      expect(screen.getByRole("button", { name: "Add video" })).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Type" })).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "Delay days" })).not.toBeInTheDocument();
      for (const name of ["Lesson 1 note or outcome", "Lesson 1 text content", "Lesson 1 external link"]) {
        expect(screen.queryByRole("textbox", { name })).not.toBeInTheDocument();
      }

      fireEvent.click(screen.getByRole("button", { name: "Add lesson to module 1" }));
      const form = curriculumCard().querySelector("form") as HTMLElement;
      expect(within(form).queryByRole("combobox")).not.toBeInTheDocument();
      expect(within(form).getAllByRole("textbox")).toHaveLength(1);
    } finally {
      mocks.course.modules = modulesOriginais;
    }
  });

  // Compatibility guard: the RPC writes content_text/external_url with whatever
  // comes in the payload (a missing key becomes NULL). Touching the title of an old
  // lesson must return the six fields intact, even off screen.
  it("editing the title of an old lesson preserves the fields that left the screen", async () => {
    const modulesOriginais = mocks.course.modules;
    const aulaAntiga = {
      id: "l1",
      title: "Old lesson",
      type: "quiz" as const,
      durationMinutes: 12,
      dripDelayDays: 5,
      contentText: "x",
      externalUrl: "https://drive.google.com/x",
      description: "n",
    };
    mocks.course.modules = [{ id: "m1", title: "Start here", lessons: [aulaAntiga] }];
    try {
      abrirModulo("m1");
      renderBuilder();
      await screen.findByRole("heading", { name: mocks.course.title });
      fireEvent.change(screen.getByRole("textbox", { name: "Lesson title" }), {
        target: { value: "Renamed lesson" },
      });

      // Real autosave (1.8 s debounce), without clicking save.
      await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalled(), { timeout: 5000 });
      const lessons = vi.mocked(updateTeacherCourseBuilder).mock.calls.at(-1)?.[1].modules?.[0].lessons;
      expect(lessons).toEqual([
        expect.objectContaining({ ...aulaAntiga, title: "Renamed lesson" }),
      ]);
    } finally {
      mocks.course.modules = modulesOriginais;
    }
  }, 10000);
});
vi.mock("@/lib/data/creator-plan", () => ({ fetchCreatorPlanRequired: async () => false }));
