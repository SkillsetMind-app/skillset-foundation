import { act, cleanup, fireEvent, render, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import { clickConfirm, stubDialogs } from "@/components/teacher/confirm-test-helpers";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToTeacherCourse, updateTeacherCourseBuilder } from "@/lib/data/teacher-courses";

// Slice 4 of the editor (decision of Sep 14): clicking a module opens its page
// INSIDE the builder (?module=M), with "Course > Module", vertical 2:3 cover, name,
// description and the lessons. The course list becomes one row per module.

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
      {
        id: "m2",
        title: "Deep work",
        summary: "Protect the hours that matter.",
        coverAssetId: "cover-m2",
        lessons: [{ id: "l1", title: "Focus blocks", type: "video", description: "" }],
      },
    ],
    lessonCount: 1,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
  };

  return {
    course,
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

vi.mock("@/components/teacher/course-asset-uploader", () => ({
  CourseAssetUploader: () => null,
}));

// Lesson studio marker: what matters here is WHICH module and lesson it
// opens, not what it does inside (that is lesson-content-modal.test.tsx).
vi.mock("@/components/teacher/lesson-content-modal", () => ({
  LessonContentModal: (props: {
    module: { id: string };
    lesson: { title: string };
    onClose: () => void;
  }) => (
    <div role="dialog">
      {`${props.module.id}:${props.lesson.title}`}
      <button type="button" onClick={props.onClose}>Close studio</button>
    </div>
  ),
}));

function openAt(query: string) {
  mocks.searchParams = new URLSearchParams(query);
}

function tree() {
  return (
    <I18nProvider initialLocale="en">
      <CourseBuilderStudio />
    </I18nProvider>
  );
}

let view: RenderResult;

// The lesson opens as a page (?lesson=L) and goes back to the module through the router: it follows the
// last URL the builder asked for, as the browser would.
function followPush(kind: "push" | "replace" = "push") {
  const href = String(mocks.router[kind].mock.calls.at(-1)?.[0]);
  openAt(href.slice(href.indexOf("?") + 1));
  view.rerender(tree());
}

async function renderBuilder() {
  view = render(tree());
  await screen.findByRole("heading", { name: mocks.course.title });
  const card = document.querySelector("#builder-sec-modules");
  if (!card) throw new Error("the content tab did not open");
  return card as HTMLElement;
}

describe("module page inside the builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openAt("courseId=course-1&tab=content");
  });

  afterEach(() => {
    cleanup();
  });

  it("with ?module=M it opens the module page: title, trail, 2:3 cover and the lessons", async () => {
    openAt("courseId=course-1&tab=content&module=m2");
    const card = await renderBuilder();

    expect(within(card).getByRole("heading", { name: "Deep work" })).toBeInTheDocument();
    const trail = within(card).getByRole("navigation", { name: "Breadcrumb" });
    expect(within(trail).getByRole("link", { name: mocks.course.title })).toHaveAttribute(
      "href",
      "/teach/builder?courseId=course-1&tab=content",
    );
    const cover = within(card).getByRole("region", { name: "Module cover" });
    expect(cover.querySelector(".aspect-\\[2\\/3\\]")).not.toBeNull();
    expect(within(card).getByRole("textbox", { name: "Module 2 description" })).toHaveValue(
      "Protect the hours that matter.",
    );

    // The actions that already existed on the lesson stay on the module page: on the
    // row, the main one (outlined) and move up/down; the rest in "More actions".
    expect(within(card).getByRole("textbox", { name: "Lesson title" })).toHaveValue("Focus blocks");
    for (const name of ["Add video", "Up", "Down"]) {
      expect(within(card).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(within(card).getByRole("button", { name: "Add video" })).toHaveClass("button-outline");
    expect(within(card).queryByRole("button", { name: "Delete lesson" })).toBeNull();
    const more = within(card).getByRole("button", { name: 'More actions for "Focus blocks"' });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    for (const name of ["Mark free preview", "Delete lesson"]) {
      expect(within(card).getByRole("button", { name })).toBeInTheDocument();
    }
    // The marked free preview shows up on the row itself.
    fireEvent.click(within(card).getByRole("button", { name: "Mark free preview" }));
    expect(within(card).getByText("Free preview")).toBeInTheDocument();
    // Only this module: the other one stays in the course list.
    expect(within(card).queryByText("Start here")).not.toBeInTheDocument();
    // Opening the builder already on a module (direct link, reload) does not steal focus.
    expect(document.activeElement).toBe(document.body);
  });

  it("renaming the module on its page preserves description, cover and lessons in the autosave", async () => {
    openAt("courseId=course-1&tab=content&module=m2");
    const card = await renderBuilder();
    within(card).getByRole("navigation", { name: "Breadcrumb" });

    fireEvent.change(within(card).getByRole("textbox", { name: "Module 2" }), {
      target: { value: "Deep work, renamed" },
    });
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalled(), { timeout: 5000 });
    expect(vi.mocked(updateTeacherCourseBuilder).mock.calls.at(-1)?.[1].modules?.[1]).toEqual(
      expect.objectContaining({
        id: "m2",
        title: "Deep work, renamed",
        summary: "Protect the hours that matter.",
        coverAssetId: "cover-m2",
        lessons: [expect.objectContaining({ id: "l1", title: "Focus blocks", type: "video" })],
      }),
    );
  }, 10000);

  // Data bug: every snapshot (including the echo of our own autosave) returned the lesson's
  // module to the 1st. With the form still open on m2, the second
  // lesson was saved in m1, and the studio and the video upload went along with it.
  it("a lesson added after the autosave echo stays in the open module", async () => {
    let emitCourse: (course: TeacherCourse | null) => void = () => {};
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emitCourse = emit;
      emit(mocks.course);
      return Object.assign(() => {}, { reload: async () => {} });
    });
    openAt("courseId=course-1&tab=content&module=m2");
    const card = await renderBuilder();
    const form = () => card.querySelector("form") as HTMLElement;

    fireEvent.click(within(card).getByRole("button", { name: "Add lesson to module 2" }));
    fireEvent.change(within(form()).getByRole("textbox", { name: "Lesson title" }), {
      target: { value: "Lesson A" },
    });
    fireEvent.click(within(form()).getByRole("button", { name: "Add lesson" }));
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1), { timeout: 5000 });
    const first = vi.mocked(updateTeacherCourseBuilder).mock.calls[0][1];
    act(() => emitCourse({ ...mocks.course, ...first }));
    followPush();
    expect(screen.getByRole("dialog")).toHaveTextContent("m2:Lesson A");
    fireEvent.click(screen.getByRole("button", { name: "Close studio" }));
    // Done/close replaces the history entry (router.replace).
    followPush("replace");

    // Same page, same form open, after the echo.
    fireEvent.change(within(form()).getByRole("textbox", { name: "Lesson title" }), {
      target: { value: "Lesson B" },
    });
    fireEvent.click(within(form()).getByRole("button", { name: "Add lesson" }));
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(2), { timeout: 5000 });
    const second = vi.mocked(updateTeacherCourseBuilder).mock.calls[1][1];
    expect(second.modules?.[0].lessons).toEqual([]);
    expect(second.modules?.[1].lessons.map((lesson) => lesson.title)).toEqual([
      "Focus blocks",
      "Lesson A",
      "Lesson B",
    ]);
    act(() => emitCourse({ ...mocks.course, ...second }));
    followPush();
    expect(screen.getByRole("dialog")).toHaveTextContent("m2:Lesson B");
  }, 15000);

  it("opening and going back from the module moves focus to the title and then to the row it came from", async () => {
    const { rerender } = render(tree());
    await screen.findByRole("heading", { name: mocks.course.title });
    const card = () => document.querySelector("#builder-sec-modules") as HTMLElement;

    fireEvent.click(within(card()).getByRole("link", { name: /Deep work/ }));
    openAt("courseId=course-1&tab=content&module=m2");
    rerender(tree());
    expect(document.activeElement).toBe(within(card()).getByRole("heading", { name: "Deep work" }));

    fireEvent.click(within(card()).getByRole("link", { name: mocks.course.title }));
    openAt("courseId=course-1&tab=content");
    rerender(tree());
    expect(document.activeElement).toBe(within(card()).getByRole("link", { name: /Deep work/ }));
  });

  // Content loss: the realtime snapshot (the echo of an EARLIER save)
  // overwrote the local draft with an edit not yet saved, and the autosave
  // never saved it again. The lesson vanished from the screen and the studio never opened.
  it("the echo of an earlier save does not erase a local edit not yet saved", async () => {
    let emitCourse: (course: TeacherCourse | null) => void = () => {};
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emitCourse = emit;
      emit(mocks.course);
      return Object.assign(() => {}, { reload: async () => {} });
    });
    let finishFirst = () => {};
    vi.mocked(updateTeacherCourseBuilder).mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishFirst = resolve; }),
    );
    openAt("courseId=course-1&tab=content&module=m1");
    const card = await renderBuilder();

    // 1) Autosave of a title goes out and stays in flight.
    fireEvent.change(within(card).getByRole("textbox", { name: "Module 1" }), {
      target: { value: "Start here, renamed" },
    });
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1), { timeout: 5000 });
    const first = vi.mocked(updateTeacherCourseBuilder).mock.calls[0][1];

    // 2) New edit while it is in flight: a lesson.
    fireEvent.click(within(card).getByRole("button", { name: "Add lesson to module 1" }));
    const form = card.querySelector("form") as HTMLElement;
    fireEvent.change(within(form).getByRole("textbox", { name: "Lesson title" }), {
      target: { value: "Fresh lesson" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Add lesson" }));

    // 3) The echo of the 1st save arrives (without the lesson) and then the save returns.
    act(() => emitCourse({ ...mocks.course, ...first }));
    await act(async () => finishFirst());

    // The lesson stays on screen, on the module page...
    expect(within(card).getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(within(card).getAllByRole("textbox", { name: "Lesson title" }).map((input) => (input as HTMLInputElement).value))
      .toContain("Fresh lesson");
    // ...e no autosave seguinte.
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(2), { timeout: 5000 });
    const second = vi.mocked(updateTeacherCourseBuilder).mock.calls[1][1];
    expect(second.modules?.[0]).toEqual(expect.objectContaining({
      title: "Start here, renamed",
      lessons: [expect.objectContaining({ title: "Fresh lesson" })],
    }));
    // The echo of that save confirms the lesson and opens the studio on it.
    act(() => emitCourse({ ...mocks.course, ...second }));
    followPush();
    expect(screen.getByRole("dialog")).toHaveTextContent("m1:Fresh lesson");
  }, 15000);

  // Ctrl/Cmd/Shift/Alt+click or middle button open another tab: this tab does not
  // navigate, so a focus request must not be left over for the next back/forward.
  it("a click that opens another tab does not leave a focus request hanging", async () => {
    const { rerender } = render(tree());
    await screen.findByRole("heading", { name: mocks.course.title });
    const card = () => document.querySelector("#builder-sec-modules") as HTMLElement;

    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      fireEvent.click(within(card()).getByRole("link", { name: /Deep work/ }), init);
    }
    // Afterwards, the browser's back/forward changes the URL with no click in this tab.
    openAt("courseId=course-1&tab=content&module=m2");
    rerender(tree());
    expect(document.activeElement).toBe(document.body);

    fireEvent.click(within(card()).getByRole("link", { name: mocks.course.title }), { ctrlKey: true });
    openAt("courseId=course-1&tab=content");
    rerender(tree());
    expect(document.activeElement).toBe(document.body);
  });

  // Lesson L goes out in the autosave and is deleted before the echo. The echo (with L) opened a
  // "ghost" studio for L, with no modal, and the next new lesson never opened.
  it("a lesson deleted before the echo does not open a ghost studio or block the next one", async () => {
    let emitCourse: (course: TeacherCourse | null) => void = () => {};
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emitCourse = emit;
      emit(mocks.course);
      return Object.assign(() => {}, { reload: async () => {} });
    });
    const restoreDialogs = stubDialogs();
    try {
      openAt("courseId=course-1&tab=content&module=m1");
      const card = await renderBuilder();
      const form = () => card.querySelector("form") as HTMLElement;

      fireEvent.click(within(card).getByRole("button", { name: "Add lesson to module 1" }));
      fireEvent.change(within(form()).getByRole("textbox", { name: "Lesson title" }), {
        target: { value: "Lesson L" },
      });
      fireEvent.click(within(form()).getByRole("button", { name: "Add lesson" }));
      await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1), { timeout: 5000 });
      const first = vi.mocked(updateTeacherCourseBuilder).mock.calls[0][1];

      fireEvent.click(within(card).getByRole("button", { name: 'More actions for "Lesson L"' }));
      fireEvent.click(within(card).getByRole("button", { name: "Delete lesson" }));
      const asking = screen.getByRole("dialog", { name: "Delete this lesson?" });
      expect(asking).toHaveAccessibleDescription('Delete lesson "Lesson L"? This cannot be undone after autosave.');
      clickConfirm(asking, "Delete lesson");
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Delete this lesson?" })).toBeNull());
      act(() => emitCourse({ ...mocks.course, ...first }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      // The next new lesson still opens the studio by itself.
      fireEvent.change(within(form()).getByRole("textbox", { name: "Lesson title" }), {
        target: { value: "Lesson M" },
      });
      fireEvent.click(within(form()).getByRole("button", { name: "Add lesson" }));
      await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(2), { timeout: 5000 });
      const second = vi.mocked(updateTeacherCourseBuilder).mock.calls[1][1];
      expect(second.modules?.[0].lessons.map((lesson) => lesson.title)).toEqual(["Lesson M"]);
      act(() => emitCourse({ ...mocks.course, ...second }));
      followPush();
      expect(screen.getByRole("dialog")).toHaveTextContent("m1:Lesson M");
    } finally {
      restoreDialogs();
    }
  }, 15000);

  // A new snapshot (another tab, or the sales page in Manage) arrives with the
  // draft dirty and is left out. If the person undoes the edit, the draft stays
  // clean with the old copy, and the next edit of any kind saved it over.
  it("a snapshot skipped while the draft was dirty applies once the draft is clean again", async () => {
    let emitCourse: (course: TeacherCourse | null) => void = () => {};
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emitCourse = emit;
      emit(mocks.course);
      return Object.assign(() => {}, { reload: async () => {} });
    });
    openAt("courseId=course-1&tab=content&module=m1");
    const card = await renderBuilder();
    const name = () => within(card).getByRole("textbox", { name: "Module 1" });

    fireEvent.change(name(), { target: { value: "Start here, draft" } });
    act(() => emitCourse({ ...mocks.course, title: "Renamed in another tab" }));
    // Undo: the draft matches the last save again.
    fireEvent.change(name(), { target: { value: "Start here" } });

    expect(await screen.findByRole("heading", { name: "Renamed in another tab" })).toBeInTheDocument();
    // No autosave of the old copy.
    await new Promise((resolve) => setTimeout(resolve, 2200));
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();

    // The next edit of any kind saves over the new copy, not the old one.
    fireEvent.change(within(card).getByRole("textbox", { name: "Module 1 description" }), {
      target: { value: "Fresh summary" },
    });
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(vi.mocked(updateTeacherCourseBuilder).mock.calls[0][1].title).toBe("Renamed in another tab");
  }, 15000);

  // The echo of the in-flight save arrives before the HTTP response and is held; before the
  // response, the person goes back exactly to the previous state. Applying the held one
  // then resurrected the save, and the return was never saved.
  it("going back to the previous state during an in-flight save does not resurrect its echo", async () => {
    let emitCourse: (course: TeacherCourse | null) => void = () => {};
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emitCourse = emit;
      emit(mocks.course);
      return Object.assign(() => {}, { reload: async () => {} });
    });
    let finishFirst = () => {};
    vi.mocked(updateTeacherCourseBuilder).mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishFirst = resolve; }),
    );
    openAt("courseId=course-1&tab=content&module=m1");
    const card = await renderBuilder();
    const name = () => within(card).getByRole("textbox", { name: "Module 1" });

    fireEvent.change(name(), { target: { value: "Start here, v1" } });
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1), { timeout: 5000 });
    const first = vi.mocked(updateTeacherCourseBuilder).mock.calls[0][1];
    act(() => emitCourse({ ...mocks.course, ...first }));
    fireEvent.change(name(), { target: { value: "Start here" } });
    await act(async () => {});
    expect(name()).toHaveValue("Start here");

    await act(async () => finishFirst());
    expect(name()).toHaveValue("Start here");
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(2), { timeout: 5000 });
    expect(vi.mocked(updateTeacherCourseBuilder).mock.calls[1][1].modules?.[0].title).toBe("Start here");
  }, 15000);

  it("if the in-flight save fails with a clean draft, the held snapshot applies", async () => {
    let emitCourse: (course: TeacherCourse | null) => void = () => {};
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emitCourse = emit;
      emit(mocks.course);
      return Object.assign(() => {}, { reload: async () => {} });
    });
    let failFirst: (error: Error) => void = () => {};
    vi.mocked(updateTeacherCourseBuilder).mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => { failFirst = reject; }),
    );
    openAt("courseId=course-1&tab=content&module=m1");
    const card = await renderBuilder();
    const name = () => within(card).getByRole("textbox", { name: "Module 1" });

    fireEvent.change(name(), { target: { value: "Start here, v1" } });
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1), { timeout: 5000 });
    const first = vi.mocked(updateTeacherCourseBuilder).mock.calls[0][1];
    act(() => emitCourse({ ...mocks.course, ...first }));
    fireEvent.change(name(), { target: { value: "Start here" } });
    await act(async () => {});
    // With the save in flight, the person's return stays on screen.
    expect(name()).toHaveValue("Start here");

    // It fails, but the echo already showed what the server saved.
    await act(async () => failFirst(new Error("network")));
    expect(name()).toHaveValue("Start here, v1");
  }, 15000);

  // Real loss (from #376), previously seen as an intermittent test. Forced order:
  // the save returns but its commit has not happened yet; the echo arrives in between,
  // reads the draft still "dirty" and goes to the held slot; the commit leaves the draft
  // clean and schedules applying the held one in a microtask; the person types before
  // the microtask runs. Applying blindly swapped the typing for the old echo and
  // marked it as saved: the edit never reached the server.
  it("a held snapshot does not erase an edit made right after the save returns", async () => {
    let emitCourse: (course: TeacherCourse | null) => void = () => {};
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emitCourse = emit;
      emit(mocks.course);
      return Object.assign(() => {}, { reload: async () => {} });
    });
    let finishFirst = () => {};
    vi.mocked(updateTeacherCourseBuilder).mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishFirst = resolve; }),
    );
    openAt("courseId=course-1&tab=content&module=m1");
    const card = await renderBuilder();
    const name = () => within(card).getByRole("textbox", { name: "Module 1" });

    fireEvent.change(name(), { target: { value: "Start here, v1" } });
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1), { timeout: 5000 });
    const first = vi.mocked(updateTeacherCourseBuilder).mock.calls[0][1];

    // 1) The save returns: only microtasks run, React has not committed yet.
    finishFirst();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // 2) The echo arrives before the commit and goes to the held slot; the commit, at the end
    //    of the same act, leaves the draft clean and schedules applying the held one.
    act(() => emitCourse({ ...mocks.course, ...first }));
    // 3) The person types before the microtask runs (no await in between).
    fireEvent.change(name(), { target: { value: "Start here, v2" } });
    // 4) Now the microtask runs.
    await act(async () => {});

    expect(name()).toHaveValue("Start here, v2");
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(2), { timeout: 5000 });
    expect(vi.mocked(updateTeacherCourseBuilder).mock.calls[1][1].modules?.[0].title).toBe("Start here, v2");
  }, 15000);

  it("without ?module it shows one row per module, with a bold name and the number of lessons", async () => {
    const card = await renderBuilder();

    const rows = Array.from(card.querySelectorAll("article")) as HTMLElement[];
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole("link", { name: /Start here/ })).toHaveAttribute(
      "href",
      "/teach/builder?courseId=course-1&tab=content&module=m1",
    );
    expect(rows[1].querySelector("strong")).toHaveTextContent("Deep work");
    expect(within(rows[1]).getByText("1 lesson")).toBeInTheDocument();
    // The list no longer edits the name in place: that lives on the module page.
    expect(within(card).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(card).queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Add module" })).toBeInTheDocument();
  });

  // The notice landed on the footer card, screens below the button: "Add lesson" with no
  // title seemed to do nothing.
  it("new lesson with no title: the notice appears in its form, only once", async () => {
    openAt("courseId=course-1&tab=content&module=m1");
    const card = await renderBuilder();

    fireEvent.click(within(card).getByRole("button", { name: "Add lesson to module 1" }));
    const form = card.querySelector("form") as HTMLElement;
    fireEvent.click(within(form).getByRole("button", { name: "Add lesson" }));

    const title = within(form).getByRole("textbox", { name: "Lesson title" });
    expect(within(form).getByRole("alert")).toHaveTextContent("Add a lesson title before creating the lesson.");
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(title).toHaveAccessibleDescription("Add a lesson title before creating the lesson.");
    expect(screen.getAllByRole("alert")).toHaveLength(1);

    // Typed the title: the notice goes away without waiting for another click.
    fireEvent.change(title, { target: { value: "Primeira aula" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(title).not.toHaveAttribute("aria-invalid");

    fireEvent.change(title, { target: { value: "" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add lesson" }));
    expect(within(form).getByRole("alert")).toBeInTheDocument();
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("an unknown or deleted module id falls back to the list, not an empty screen", async () => {
    openAt("courseId=course-1&tab=content&module=ghost");
    const card = await renderBuilder();

    expect(within(card).queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
    expect(card.querySelectorAll("article")).toHaveLength(2);
    expect(within(card).getByRole("link", { name: /Deep work/ })).toBeInTheDocument();
  });

  it("the badge stays on Saving while any write is pending", async () => {
    const pending: Array<() => void> = [];
    const hold = () => new Promise<void>((resolve) => pending.push(resolve));
    // Once, not mockImplementation: clearAllMocks does not undo an implementation, and
    // a write that never returns would leak into the following tests.
    vi.mocked(updateTeacherCourseBuilder).mockImplementationOnce(hold).mockImplementationOnce(hold);
    openAt("courseId=course-1&tab=content&module=m1");
    const card = await renderBuilder();
    within(card).getByRole("navigation", { name: "Breadcrumb" });

    fireEvent.change(within(card).getByRole("textbox", { name: "Module 1" }), {
      target: { value: "Start here, renamed" },
    });
    // Real autosave (1.8 s debounce) goes out and stays pending.
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(screen.getByText("Saving")).toBeInTheDocument();

    // The teacher clicks Save with the autosave still in flight.
    fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(2);

    // The first returns; the second does not yet. "Saved" here would be a lie.
    await act(async () => pending[0]());
    expect(screen.getByText("Saving")).toBeInTheDocument();
    expect(screen.queryByText("All changes saved")).not.toBeInTheDocument();

    await act(async () => pending[1]());
    expect(await screen.findByText("All changes saved")).toBeInTheDocument();
    expect(screen.queryByText("Saving")).not.toBeInTheDocument();
  }, 10000);
});
vi.mock("@/lib/data/creator-plan", () => ({ fetchCreatorPlanRequired: async () => false }));
