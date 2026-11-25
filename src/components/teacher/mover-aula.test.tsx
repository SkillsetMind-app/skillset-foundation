import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import { clickConfirm, stubDialogs } from "@/components/teacher/confirm-test-helpers";
import type { DripStrategy } from "@/domain/drip-policy";
import type { TeacherCourse, TeacherLesson } from "@/domain/teacher-course";
import { updateTeacherCourseBuilder } from "@/lib/data/teacher-courses";

// Editor decision: move the lesson between modules, with a keyboard alternative,
// without changing the id (video, materials, progress and comments go along).

const mocks = vi.hoisted(() => ({
  course: null as TeacherCourse | null,
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
  fetchCreatorActivationBlocked: () => Promise.resolve(false),
}));

vi.mock("@/lib/data/course-assets", () => ({
  fetchCourseAssets: () => Promise.resolve([]),
  subscribeToCourseAssets: vi.fn(() => () => undefined),
  syncLessonPreviewAssets: () => Promise.resolve(),
  uploadCourseAsset: vi.fn(),
}));

vi.mock("@/components/teacher/course-asset-uploader", () => ({ CourseAssetUploader: () => null }));

// Studio marker: what matters is WHICH module and lesson it opens.
vi.mock("@/components/teacher/lesson-content-modal", () => ({
  LessonContentModal: (props: { module: { id: string }; lesson: { title: string } }) => (
    <div role="dialog">{`${props.module.id}:${props.lesson.title}`}</div>
  ),
}));

// Fields that left the screen must travel along: the full-replace RPC zeroes
// whatever is not in the payload.
function lesson(id: string, title: string): TeacherLesson {
  return {
    id,
    title,
    type: "video",
    description: "nota antiga",
    durationMinutes: 7,
    dripDelayDays: 3,
    contentText: "corpo",
    externalUrl: null,
  };
}

function courseWith(dripStrategy: DripStrategy = "instant"): TeacherCourse {
  return {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Clinical performance foundations",
    summary: "Build a repeatable practice for evidence-informed performance work.",
    category: "Applied Psychology & Behavior",
    categories: ["Applied Psychology & Behavior"],
    status: "draft",
    modules: [
      { id: "m1", title: "Start here", lessons: [lesson("l1", "Welcome"), lesson("l2", "Second")] },
      { id: "m2", title: "Deep work", lessons: [lesson("l3", "Focus")] },
    ],
    lessonCount: 3,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
    freePreviewLessonId: "l2",
    dripStrategy,
  };
}

const positional: DripStrategy[] = ["sequential_progress", "time_drip_module", "time_drip_lesson"];
const confirmText =
  "Students who already opened this lesson may lose access until they reach it again in the new order. Move anyway?";

function tree() {
  return (
    <I18nProvider initialLocale="en">
      <CourseBuilderStudio />
    </I18nProvider>
  );
}

function openAt(query: string) {
  mocks.searchParams = new URLSearchParams(query);
}

async function renderBuilder() {
  const view = render(tree());
  await screen.findByRole("heading", { name: "Clinical performance foundations" });
  return view;
}

const card = () => document.querySelector("#builder-sec-modules") as HTMLElement;
const lastPayload = () => vi.mocked(updateTeacherCourseBuilder).mock.calls.at(-1)?.[1];
const idsOf = (index: number) => lastPayload()?.modules?.[index].lessons.map((item) => item.id);
const titlesOnPage = () =>
  within(card()).getAllByRole("textbox", { name: "Lesson title" }).map((input) => (input as HTMLInputElement).value);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Fake DataTransfer: it stores what was put in and exposes the types, as the
// browser does on dragover (where the content cannot be read yet).
function fakeDataTransfer() {
  const data = new Map<string, string>();
  return {
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
    get types() {
      return Array.from(data.keys());
    },
    effectAllowed: "all",
    dropEffect: "move",
  };
}

function rowOf(moduleId: string) {
  return card().querySelector(`[data-module-row="${moduleId}"]`)?.closest("article") as HTMLElement;
}

// Move, free preview and delete live in "More actions" on the lesson row.
function openMore(title: string) {
  const more = screen.getByRole("button", { name: `More actions for "${title}"` });
  if (more.getAttribute("aria-expanded") !== "true") fireEvent.click(more);
}

function chooseAndMove(title: string, moduleId: string) {
  openMore(title);
  fireEvent.change(screen.getByRole("combobox", { name: `Move "${title}" to another module` }), {
    target: { value: moduleId },
  });
  fireEvent.click(screen.getByRole("button", { name: `Move "${title}"` }));
}

describe("moving a lesson between modules", () => {
  let restoreDialogs = () => {};
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.course = courseWith();
    openAt("courseId=course-1&tab=content");
    restoreDialogs = stubDialogs();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    restoreDialogs();
  });

  const moveDialog = () => screen.queryByRole("dialog", { name: "Move this lesson?" });

  it("the selector and the Move button take L2 to the end of M2 with the same id, and the form and the studio stay on the right module", async () => {
    openAt("courseId=course-1&tab=content&module=m1");
    const { rerender } = await renderBuilder();

    chooseAndMove("Second", "m2");
    expect(titlesOnPage()).toEqual(["Welcome"]);
    // The row left the page: focus on the module title and a notice of what changed.
    expect(document.activeElement).toBe(within(card()).getByRole("heading", { name: "Start here" }));
    expect(within(card()).getByRole("status")).toHaveTextContent('"Second" moved to Deep work.');

    // The lesson form still targets the open module (M1).
    fireEvent.click(screen.getByRole("button", { name: "Add lesson to module 1" }));
    const form = card().querySelector("form") as HTMLElement;
    fireEvent.change(within(form).getByRole("textbox", { name: "Lesson title" }), { target: { value: "Third" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add lesson" }));

    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalled(), { timeout: 5000 });
    expect(lastPayload()?.modules?.[0].lessons.map((item) => item.title)).toEqual(["Welcome", "Third"]);
    expect(idsOf(1)).toEqual(["l3", "l2"]);
    expect(lastPayload()?.modules?.[1].lessons[1]).toEqual(expect.objectContaining(lesson("l2", "Second")));
    expect(lastPayload()?.freePreviewLessonId).toBe("l2");

    // On M2's page, L2's studio opens targeting M2.
    openAt("courseId=course-1&tab=content&module=m2");
    rerender(tree());
    fireEvent.click(within(card()).getAllByRole("button", { name: "Add video" })[1]);
    // The lesson opens as a page (?lesson=L): it follows the URL the builder asked for.
    const opened = String(mocks.router.push.mock.calls.at(-1)?.[0]);
    openAt(opened.slice(opened.indexOf("?") + 1));
    rerender(tree());
    expect(screen.getByRole("dialog")).toHaveTextContent("m2:Second");
  }, 10000);

  // In Chrome/Edge, going through the options with the arrow keys fires change right away:
  // whoever navigates by keyboard moved the lesson by accident.
  it("choosing in the selector (arrow keys) moves nothing until the Move button", async () => {
    openAt("courseId=course-1&tab=content&module=m1");
    await renderBuilder();

    openMore("Second");
    fireEvent.change(screen.getByRole("combobox", { name: 'Move "Second" to another module' }), {
      target: { value: "m2" },
    });
    expect(titlesOnPage()).toEqual(["Welcome", "Second"]);

    fireEvent.click(screen.getByRole("button", { name: 'Move "Second"' }));
    expect(titlesOnPage()).toEqual(["Welcome"]);
  });

  it.each(positional)("with position-based release (%s), it asks for confirmation on both paths and canceling keeps the order", async (strategy) => {
    mocks.course = courseWith(strategy);
    openAt("courseId=course-1&tab=content&module=m1");
    const { rerender } = await renderBuilder();

    chooseAndMove("Second", "m2");
    expect(moveDialog()).toHaveAccessibleDescription(confirmText);
    fireEvent.click(within(moveDialog()!).getByRole("button", { name: "Cancel" }));
    expect(moveDialog()).toBeNull();
    expect(titlesOnPage()).toEqual(["Welcome", "Second"]);

    openAt("courseId=course-1&tab=content");
    rerender(tree());
    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(within(rowOf("m1")).getByText("Second"), { dataTransfer });
    fireEvent.dragOver(rowOf("m2"), { dataTransfer });
    fireEvent.drop(rowOf("m2"), { dataTransfer });
    expect(moveDialog()).toHaveAccessibleDescription(confirmText);
    fireEvent.click(within(moveDialog()!).getByRole("button", { name: "Cancel" }));
    expect(within(rowOf("m1")).getByText("Second")).toBeInTheDocument();
    expect(within(rowOf("m2")).queryByText("Second")).not.toBeInTheDocument();
  });

  // Confirming runs the same mover as before, once: the lesson goes to the end of the
  // destination, the notice appears and focus goes to the module title.
  it("with position-based release, confirming in the dialog moves once and notifies", async () => {
    mocks.course = courseWith("sequential_progress");
    openAt("courseId=course-1&tab=content&module=m1");
    await renderBuilder();

    chooseAndMove("Second", "m2");
    expect(titlesOnPage()).toEqual(["Welcome", "Second"]);
    clickConfirm(moveDialog()!, "Move lesson");
    expect(titlesOnPage()).toEqual(["Welcome"]);
    await waitFor(() => expect(within(card()).getByRole("status")).toHaveTextContent('"Second" moved to Deep work.'));
    expect(moveDialog()).toBeNull();
    expect(document.activeElement).toBe(within(card()).getByRole("heading", { name: "Start here" }));

    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalled(), { timeout: 5000 });
    expect(idsOf(0)).toEqual(["l1"]);
    expect(idsOf(1)).toEqual(["l3", "l2"]);
  }, 10000);

  it.each(["time_drip_custom", "instant"] as DripStrategy[])("with %s, it moves without asking", async (strategy) => {
    mocks.course = courseWith(strategy);
    openAt("courseId=course-1&tab=content&module=m1");
    await renderBuilder();

    chooseAndMove("Second", "m2");
    expect(moveDialog()).toBeNull();
    expect(titlesOnPage()).toEqual(["Welcome"]);
  });

  it("the release notice only appears with position-based release", async () => {
    for (const strategy of positional) {
      mocks.course = courseWith(strategy);
      openAt("courseId=course-1&tab=content&module=m1");
      await renderBuilder();
      expect(within(card()).getByText(/changes when it opens/)).toBeInTheDocument();
      cleanup();
    }
    for (const strategy of ["time_drip_custom", "instant"] as DripStrategy[]) {
      mocks.course = courseWith(strategy);
      openAt("courseId=course-1&tab=content&module=m1");
      await renderBuilder();
      expect(within(card()).queryByText(/changes when it opens/)).not.toBeInTheDocument();
      cleanup();
    }
  });

  it("dragging the lesson to another module in the course list uses the same path", async () => {
    await renderBuilder();
    const dataTransfer = fakeDataTransfer();

    fireEvent.dragStart(within(rowOf("m1")).getByText("Second"), { dataTransfer });
    fireEvent.dragOver(rowOf("m2"), { dataTransfer });
    fireEvent.drop(rowOf("m2"), { dataTransfer });

    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalled(), { timeout: 5000 });
    expect(idsOf(0)).toEqual(["l1"]);
    expect(idsOf(1)).toEqual(["l3", "l2"]);
    expect(lastPayload()?.modules?.[1].lessons[1]).toEqual(expect.objectContaining(lesson("l2", "Second")));
  }, 10000);

  it("dropping the lesson in its own module changes nothing (and does not ask)", async () => {
    mocks.course = courseWith("sequential_progress");
    await renderBuilder();
    const dataTransfer = fakeDataTransfer();

    fireEvent.dragStart(within(rowOf("m1")).getByText("Welcome"), { dataTransfer });
    fireEvent.dragOver(rowOf("m1"), { dataTransfer });
    fireEvent.drop(rowOf("m1"), { dataTransfer });

    expect(moveDialog()).toBeNull();
    await wait(2200);
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  }, 10000);

  it("dragging arbitrary text is not accepted by the module row", async () => {
    await renderBuilder();
    const text = { types: ["text/plain"], getData: (type: string) => (type === "text/plain" ? "l2" : "") };

    // dragOver without preventDefault = drop refused by the browser.
    expect(fireEvent.dragOver(rowOf("m2"), { dataTransfer: text })).toBe(true);
    fireEvent.drop(rowOf("m2"), { dataTransfer: text });
    expect(within(rowOf("m1")).getByText("Second")).toBeInTheDocument();

    // Dragging a lesson is accepted.
    const lessonDrag = fakeDataTransfer();
    fireEvent.dragStart(within(rowOf("m1")).getByText("Second"), { dataTransfer: lessonDrag });
    expect(fireEvent.dragOver(rowOf("m2"), { dataTransfer: lessonDrag })).toBe(false);
  });

  // The screen reader only announces a change in a region that already existed.
  it("the notice region exists before the first move, and only the text changes", async () => {
    openAt("courseId=course-1&tab=content&module=m1");
    await renderBuilder();
    const status = within(card()).getByRole("status");
    expect(status).toHaveTextContent("");

    chooseAndMove("Second", "m2");
    expect(within(card()).getByRole("status")).toBe(status);
    expect(status).toHaveTextContent('"Second" moved to Deep work.');
  });

  it("switching modules clears the notice, and Move only works for a destination that still exists", async () => {
    mocks.course = {
      ...courseWith(),
      modules: [...courseWith().modules, { id: "m3", title: "Wrap up", lessons: [] }],
    };
    openAt("courseId=course-1&tab=content&module=m1");
    const { rerender } = await renderBuilder();

    chooseAndMove("Welcome", "m3");
    expect(within(card()).getByRole("status")).toHaveTextContent('"Welcome" moved to Wrap up.');
    openAt("courseId=course-1&tab=content&module=m2");
    rerender(tree());
    openAt("courseId=course-1&tab=content&module=m1");
    rerender(tree());
    expect(within(card()).getByRole("status")).toHaveTextContent("");

    // Destination marked and then deleted: Move does not stay active for it.
    openMore("Second");
    fireEvent.change(screen.getByRole("combobox", { name: 'Move "Second" to another module' }), {
      target: { value: "m2" },
    });
    expect(screen.getByRole("button", { name: 'Move "Second"' })).toBeEnabled();
    openAt("courseId=course-1&tab=content");
    rerender(tree());
    fireEvent.click(within(rowOf("m2")).getByRole("button", { name: "Delete" }));
    clickConfirm(screen.getByRole("dialog", { name: "Delete this module?" }), "Delete module");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Delete this module?" })).toBeNull());
    openAt("courseId=course-1&tab=content&module=m1");
    rerender(tree());
    expect(screen.getByRole("button", { name: 'Move "Second"' })).toBeDisabled();
  });

  it("a lesson from another course (dragged from another tab) neither asks for confirmation nor moves", async () => {
    mocks.course = courseWith("sequential_progress");
    await renderBuilder();
    const foreign = fakeDataTransfer();
    foreign.setData("application/x-skillset-lesson", "lesson-from-another-course");

    fireEvent.dragOver(rowOf("m2"), { dataTransfer: foreign });
    fireEvent.drop(rowOf("m2"), { dataTransfer: foreign });

    expect(moveDialog()).toBeNull();
    await wait(2200);
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  }, 10000);
});
vi.mock("@/lib/data/creator-plan", () => ({ fetchCreatorPlanRequired: async () => false }));

// Up/Down swapped the rows silently and the row that received the dragged
// lesson was not marked. Now: announcement of the new position and a mark on the target.
describe("reordering: announcement and drop mark", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.course = courseWith();
    openAt("courseId=course-1&tab=content");
  });
  afterEach(() => cleanup());

  // "Lesson added" and the move notice share the list row: the newest
  // wins, and "Lesson added" only on the page of the module the lesson went into.
  it("new lesson and then Up: the row shows the newest, and only in the lesson's module", async () => {
    openAt("courseId=course-1&tab=content&module=m1");
    const view = await renderBuilder();
    fireEvent.click(within(card()).getByRole("button", { name: "Add lesson to module 1" }));
    const form = card().querySelector("form") as HTMLElement;
    fireEvent.change(within(form).getByRole("textbox", { name: "Lesson title" }), { target: { value: "Fresh" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add lesson" }));
    expect(within(card()).getByRole("status")).toHaveTextContent("Lesson added");

    const ups = within(card()).getAllByRole("button", { name: "Up" });
    fireEvent.click(ups[ups.length - 1]);
    expect(within(card()).getByRole("status")).toHaveTextContent('"Fresh" moved to position 2.');

    // Again a new lesson, and the person opens another module: it does not appear there.
    fireEvent.change(within(form).getByRole("textbox", { name: "Lesson title" }), { target: { value: "Another" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add lesson" }));
    expect(within(card()).getByRole("status")).toHaveTextContent("Lesson added");
    openAt("courseId=course-1&tab=content&module=m2");
    view.rerender(tree());
    expect(within(card()).getByRole("heading", { name: "Deep work" })).toBeInTheDocument();
    expect(within(card()).getByRole("status")).toHaveTextContent("");
  });

  it("Up/Down announce the new position, in the list and on the module page", async () => {
    await renderBuilder();
    fireEvent.click(within(rowOf("m1")).getByRole("button", { name: "Down" }));
    expect(screen.getByText('"Start here" moved to position 2.')).toHaveAttribute("role", "status");
    cleanup();

    openAt("courseId=course-1&tab=content&module=m1");
    await renderBuilder();
    fireEvent.click(within(card()).getAllByRole("button", { name: "Up" })[1]);
    expect(within(card()).getByRole("status")).toHaveTextContent('"Second" moved to position 1.');
  });

  it("the row about to receive the dragged lesson is marked, and unmarked on drop", async () => {
    await renderBuilder();
    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(within(rowOf("m1")).getByText("Second"), { dataTransfer });
    fireEvent.dragOver(rowOf("m2"), { dataTransfer });
    expect(rowOf("m2").className).toContain("outline-dashed");
    expect(rowOf("m1").className).not.toContain("outline-dashed");
    fireEvent.drop(rowOf("m2"), { dataTransfer });
    expect(rowOf("m2").className).not.toContain("outline-dashed");
  });
});

