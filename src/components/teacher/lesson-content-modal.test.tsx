import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { clickConfirm, stubDialogs } from "@/components/teacher/confirm-test-helpers";
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
// "wait" holds the first delivery of the files; "fail" simulates a load error.
let subscribeOutcome: "emit" | "wait" | "fail" = "emit";
// Standalone reload (reload) returning what the server has. Off by default
// so it does not disturb the tests that deliver the list by hand with emitAssets.
let reloadServesCurrentAssets = false;
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
  // The class is used with `instanceof` in the modal's catch to tell
  // cancellation (a normal outcome) from a real failure. Without it in the mock, the access
  // triggers an unhandled rejection and the test passes by luck.
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
    return Object.assign(() => {}, {
      reload: async () => {
        if (reloadServesCurrentAssets) onAssets(currentAssets);
      },
    });
  },
}));

// No Bunny in the test: the upload goes through Supabase Storage, which is the path that
// runs when the video integration has not been turned on in an environment yet.
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
    fileName: "lesson.mp4",
    contentType: "video/mp4",
    size: 1024,
    storagePath: "courses/course-1/lesson.mp4",
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
  moduleTitle = "Module 1",
  localized = false,
  dripStrategy: DripStrategy = "instant",
  isFreePreview = false,
) {
  const lesson: TeacherLesson = {
    id: "lesson-1",
    title: "First lesson",
    type: "video",
    description: "",
    ...lessonOverrides,
  };

  const course: TeacherCourse = {
    id: "course-1",
    ownerId: "owner-1",
    title: "Course",
    summary: "",
    category: "general",
    status: "draft",
    lessonCount: 1,
    modules: [{ id: "module-1", title: moduleTitle, lessons: [lesson] }],
  };

  const onUpdateLesson = vi.fn();
  const onClose = vi.fn();
  const onSetFreePreview = vi.fn();

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
      onSetFreePreview={onSetFreePreview}
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

  return { onClose, onUpdateLesson, onSetFreePreview, lesson, unmount: view.unmount, rerenderLesson: (patch: Partial<TeacherLesson>) => view.rerender(modal({ ...lesson, ...patch })) };
}

function chooseVideoFile(name = "lesson.mp4") {
  const file = new File(["video-bytes"], name, { type: "video/mp4" });

  fireEvent.change(screen.getByLabelText("Upload a lesson video"), {
    target: { files: [file] },
  });

  return file;
}

// Only the "time_drip_custom" strategy reads the wait days per lesson
// (src/domain/drip-policy.ts). In the others the field did nothing.
describe("LessonContentModal — wait days", () => {
  beforeEach(() => {
    currentAssets = [];
    vi.clearAllMocks();
  });

  it("hides the wait days when the course strategy does not use them", () => {
    renderModal({ dripDelayDays: 7 }, "Module 1", false, "instant");
    fireEvent.click(screen.getByRole("tab", { name: /^Settings/ }));
    const toggle = screen.getByRole("switch", { name: "Use this lesson as the free preview" });
    expect(toggle).toBeInTheDocument();
    // B-22 / C-13: the same toggle as in Account, and the whole row (with the text) is the
    // control, so the target goes beyond 44px.
    expect(toggle).toHaveClass("lesson-modal-setting");
    expect(toggle).toHaveTextContent("Free preview");
    expect(toggle).toHaveAccessibleDescription(/Make this lesson visible before purchase/);
    expect(toggle.querySelector(".settings-toggle")).not.toBeNull();
    expect(screen.queryByDisplayValue("7")).not.toBeInTheDocument();
  });

  it("shows the wait days in per-lesson release", () => {
    renderModal({ dripDelayDays: 7 }, "Module 1", false, "time_drip_custom");
    fireEvent.click(screen.getByRole("tab", { name: /^Settings/ }));
    expect(screen.getByDisplayValue("7")).toBeInTheDocument();
  });
});

// C-04: they were buttons with aria-current and no arrows. C-13: only the toggle track
// responded; the text beside it did not.
describe("LessonContentModal — tabs and preview toggle", () => {
  beforeEach(() => {
    currentAssets = [];
    vi.clearAllMocks();
  });

  it("the bar is a tablist: only the open tab enters the Tab order and the panel says which tab it belongs to", () => {
    renderModal();
    const tabs = within(screen.getByRole("tablist", { name: "Lesson setup" })).getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    const [video, ...others] = tabs;
    expect(video).toHaveAttribute("aria-selected", "true");
    expect(video).toHaveAttribute("tabindex", "0");
    for (const tab of others) {
      expect(tab).toHaveAttribute("aria-selected", "false");
      expect(tab).toHaveAttribute("tabindex", "-1");
    }
    const panel = screen.getByRole("tabpanel");
    expect(video).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", video.id);
  });

  it("arrows, Home and End move focus without opening the tab or losing the chosen file", () => {
    renderModal();
    chooseVideoFile();
    const [video, description, materials, settings] = within(screen.getByRole("tablist")).getAllByRole("tab");
    act(() => video.focus());
    fireEvent.keyDown(video, { key: "ArrowRight" });
    expect(description).toHaveFocus();
    fireEvent.keyDown(description, { key: "End" });
    expect(settings).toHaveFocus();
    fireEvent.keyDown(settings, { key: "ArrowRight" });
    expect(video).toHaveFocus();
    fireEvent.keyDown(video, { key: "ArrowLeft" });
    expect(settings).toHaveFocus();
    fireEvent.keyDown(settings, { key: "Home" });
    expect(video).toHaveFocus();
    // Passing through the bar did not switch tabs: the chosen video is still there.
    expect(video).toHaveAttribute("aria-selected", "true");
    expect(video.querySelector(".lesson-modal__tab-dot")).toHaveAttribute("data-tone", "busy");

    fireEvent.click(materials);
    expect(materials).toHaveAttribute("aria-selected", "true");
    expect(materials).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", materials.id);
  });

  it("tapping the free preview text turns on the toggle, as in Account", () => {
    const { onSetFreePreview } = renderModal();
    fireEvent.click(screen.getByRole("tab", { name: /^Settings/ }));
    const toggle = screen.getByRole("switch", { name: "Use this lesson as the free preview" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).not.toHaveAttribute("aria-pressed");
    fireEvent.click(within(toggle).getByText("Free preview"));
    fireEvent.click(within(toggle).getByText(/Make this lesson visible before purchase/));
    expect(onSetFreePreview).toHaveBeenCalledTimes(2);
  });
});

// F-12: "Upload file" was dimmed without saying that a file still had to be chosen.
describe("LessonContentModal — upload with no file", () => {
  beforeEach(() => {
    currentAssets = [];
    vi.clearAllMocks();
  });

  it("the dimmed Upload file says the file is missing, and the sentence goes away when it comes", () => {
    renderModal({}, "Module 1", true);
    fireEvent.click(screen.getByRole("tab", { name: /^Materials/ }));
    const upload = screen.getByRole("button", { name: "Upload file" });
    expect(upload).toBeDisabled();
    expect(upload).toHaveAccessibleDescription("Choose a file first, then upload it.");
    fireEvent.change(screen.getByLabelText("Lesson material"), {
      target: { files: [new File(["pdf"], "handout.pdf", { type: "application/pdf" })] },
    });
    expect(screen.getByRole("button", { name: "Upload file" })).toBeEnabled();
    expect(screen.queryByText("Choose a file first, then upload it.")).not.toBeInTheDocument();
  });
});

// Decision of Sept 14: the lesson description is ONE plain text field, saved in the
// protected field (contentText). The old public note is never deleted.
describe("LessonContentModal — description", () => {
  const oldNoteLabel = "Old public note (shown to students above the description; anyone can read it)";

  beforeEach(() => {
    currentAssets = [];
    vi.clearAllMocks();
  });

  it("the description saves to the protected text and the old public note stays collapsed", () => {
    const { onUpdateLesson } = renderModal({ description: "old", contentText: null });
    fireEvent.click(screen.getByRole("tab", { name: /^Description/ }));

    const oldNote = screen
      .getByText(oldNoteLabel)
      .closest("details") as HTMLElement;
    expect(oldNote).not.toBeNull();
    expect(oldNote).not.toHaveAttribute("open");
    expect(within(oldNote).getByRole("textbox", { hidden: true })).toHaveValue("old");

    fireEvent.change(
      screen.getByPlaceholderText("Explain what the student is about to learn and why it matters."),
      { target: { value: "Read this" } },
    );
    expect(onUpdateLesson).toHaveBeenLastCalledWith({ contentText: "Read this" });
    expect(onUpdateLesson).not.toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.anything() }),
    );
  });

  it("the old note stays editable and goes away when the lesson has no note", () => {
    const { onUpdateLesson, unmount } = renderModal({ description: "old", contentText: "body" });
    fireEvent.click(screen.getByRole("tab", { name: /^Description/ }));

    expect(screen.getByPlaceholderText("Explain what the student is about to learn and why it matters.")).toHaveValue("body");
    fireEvent.change(
      screen.getByRole("textbox", { name: oldNoteLabel, hidden: true }),
      { target: { value: "old!" } },
    );
    expect(onUpdateLesson).toHaveBeenLastCalledWith({ description: "old!" });
    unmount();

    renderModal({ description: "", contentText: "body" });
    fireEvent.click(screen.getByRole("tab", { name: /^Description/ }));
    expect(screen.queryByText(oldNoteLabel)).not.toBeInTheDocument();
  });

  // Deleting the old note unmounted the field on the same tap: the teacher could not
  // retype or undo, and autosave saved "".
  it("deleting the old note does not remove the field", () => {
    const { onUpdateLesson } = renderModal({ description: "old", contentText: null }, "Module 1", true);
    fireEvent.click(screen.getByRole("tab", { name: /^Description/ }));
    const note = () => screen.queryByRole("textbox", { name: oldNoteLabel, hidden: true });

    fireEvent.change(note() as HTMLElement, { target: { value: "" } });
    expect(onUpdateLesson).toHaveBeenLastCalledWith({ description: "" });
    expect(note()).toBeInTheDocument();
    fireEvent.change(note() as HTMLElement, { target: { value: "back again" } });
    expect(onUpdateLesson).toHaveBeenLastCalledWith({ description: "back again" });
  });

  // The text of a free preview lesson is read by anyone on the course page.
  it("on a free preview lesson the help warns that the text is public", () => {
    const { unmount } = renderModal({}, "Module 1", false, "instant", true);
    fireEvent.click(screen.getByRole("tab", { name: /^Description/ }));
    expect(screen.getByText(/anyone can read this text on the course page/)).toBeInTheDocument();
    expect(screen.queryByText(/for enrolled students/)).not.toBeInTheDocument();
    unmount();

    renderModal();
    fireEvent.click(screen.getByRole("tab", { name: /^Description/ }));
    expect(screen.getByText(/for enrolled students/)).toBeInTheDocument();
  });
});

// Decision of Sept 14: one video per lesson, an upload OR a YouTube/Vimeo link, never
// both. Replacing is explicit and never deletes a course_assets.
describe("LessonContentModal — one video per lesson", () => {
  const linkField = () => screen.queryByRole("textbox", { name: "YouTube or Vimeo URL" }) as HTMLElement;
  const drive = "https://drive.example.test/file/d/abc/view";
  const youtube = "https://www.youtube.com/watch?v=abc";
  const vimeo = "https://vimeo.com/123456";

  let restoreDialogs = () => {};
  beforeEach(() => {
    currentAssets = [];
    bunnyConfig.isBunnyConfigured = false;
    vi.clearAllMocks();
    restoreDialogs = stubDialogs();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    subscribeOutcome = "emit";
    restoreDialogs();
  });

  it("with an uploaded video, the link field only appears after Replace with link", () => {
    currentAssets = [videoAsset()];
    renderModal({ videoSource: "upload" });

    expect(linkField()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    expect(linkField()).toBeInTheDocument();
    expect(screen.queryByLabelText("Upload a lesson video")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Lesson video")).not.toBeInTheDocument();
  });

  it("a link that is not YouTube or Vimeo shows an error and does not save", () => {
    const { onUpdateLesson } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));

    fireEvent.change(linkField(), { target: { value: "https://example.test/v.mp4" } });
    fireEvent.blur(linkField());

    expect(screen.getByText("Only YouTube and Vimeo video links are accepted. This link was not saved.")).toBeInTheDocument();
    expect(linkField()).toHaveAttribute("aria-invalid", "true");
    expect(onUpdateLesson).not.toHaveBeenCalled();
  });

  // The host must be YouTube or Vimeo: it is the list that getTrustedLessonEmbed
  // accepts. The player is a mock, nothing is fetched.
  it("switching to a link saves source and link together and never deletes the upload", () => {
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
    // The old upload stays listed, with its own delete button.
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("an old link that is not a video appears read-only as Old link", async () => {
    const { onUpdateLesson } = renderModal({ externalUrl: drive }, "Module 1", true);

    const old = screen.getByRole("region", { name: "Old link" });
    expect(old).toHaveTextContent(drive);
    expect(screen.queryByDisplayValue(drive)).not.toBeInTheDocument();

    // The link field starts empty; typing and deleting does not remove the old link.
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    expect(linkField()).toHaveValue("");
    fireEvent.change(linkField(), { target: { value: "abc" } });
    fireEvent.change(linkField(), { target: { value: "" } });
    fireEvent.blur(linkField());
    expect(onUpdateLesson).not.toHaveBeenCalled();

    fireEvent.click(within(old).getByRole("button", { name: "Remove old link" }));
    const asking = screen.getByRole("dialog", { name: "Remove this link?" });
    expect(asking).toHaveAccessibleDescription("Remove the old link? Students will lose the button that opens it.");
    expect(onUpdateLesson).not.toHaveBeenCalled();
    clickConfirm(asking, "Remove old link");
    expect(onUpdateLesson).toHaveBeenCalledExactlyOnceWith({ externalUrl: null });
    // The section goes away with the link: focus moves to a button that stays and the notice
    // is announced through role="status".
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove this link?" })).toBeNull());
    expect(screen.queryByRole("region", { name: "Old link" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Replace with upload" })).toHaveFocus());
    expect(screen.getByRole("status")).toHaveTextContent("Old link removed.");
  });

  it("declining the confirmation to remove the old link changes nothing", () => {
    const { onUpdateLesson } = renderModal({ externalUrl: drive }, "Module 1", true);

    fireEvent.click(screen.getByRole("button", { name: "Remove old link" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Remove this link?" })).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Remove this link?" })).toBeNull();
    expect(onUpdateLesson).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Old link" })).toHaveTextContent(drive);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  // The first accepted link overwrote the old link without asking: the only
  // confirmation was on the remove button.
  // Replacing with the link asks in the platform dialog (it used to be window.confirm).
  const replaceAsk = () => screen.queryByRole("dialog", { name: "Remove this link?" });
  const declineReplace = () => fireEvent.click(within(replaceAsk()!).getByRole("button", { name: "Cancel" }));

  it("a Vimeo link on a lesson with an old link asks for confirmation before saving", async () => {
    const nativeConfirm = vi.spyOn(window, "confirm");
    const { onUpdateLesson } = renderModal({ externalUrl: drive }, "Module 1", true);
    const notice = "Link not saved. The old link stays.";
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));

    fireEvent.change(linkField(), { target: { value: vimeo } });
    fireEvent.blur(linkField());
    expect(replaceAsk()).toHaveAccessibleDescription("Remove the old link? Students will lose the button that opens it.");
    expect(onUpdateLesson).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Old link" })).toHaveTextContent(drive);
    // With the question open, the "not saved" notice is not announced yet: the screen
    // reader was reading it while the teacher was being asked.
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    declineReplace();
    expect(replaceAsk()).toBeNull();
    expect(onUpdateLesson).not.toHaveBeenCalled();
    // Declined: the field goes back to the saved value and warns. Leaving again (X, tab, switch)
    // does not ask a second time or eat the click.
    expect(linkField()).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent(notice);
    expect(screen.getByRole("region", { name: "Old link" })).toHaveTextContent(drive);
    const firstNotice = screen.getByText(notice);
    fireEvent.blur(linkField());
    expect(replaceAsk()).toBeNull();

    // The second refusal becomes a new node in the status, so it is announced again.
    fireEvent.change(linkField(), { target: { value: vimeo } });
    fireEvent.blur(linkField());
    expect(replaceAsk()).not.toBeNull();
    declineReplace();
    expect(screen.getByText(notice)).not.toBe(firstNotice);

    // Confirmed: saves just once, after the confirmation.
    fireEvent.change(linkField(), { target: { value: vimeo } });
    fireEvent.blur(linkField());
    expect(onUpdateLesson).not.toHaveBeenCalled();
    clickConfirm(replaceAsk()!, "Remove old link");
    expect(onUpdateLesson).toHaveBeenCalledExactlyOnceWith({ videoSource: "youtube", externalUrl: vimeo });
    await waitFor(() => expect(replaceAsk()).toBeNull());
    expect(onUpdateLesson).toHaveBeenCalledOnce();
    expect(screen.queryByRole("region", { name: "Old link" })).not.toBeInTheDocument();
    // The field shows the saved link: the next blur does not erase it.
    expect(linkField()).toHaveValue(vimeo);
    fireEvent.blur(linkField());
    expect(onUpdateLesson).toHaveBeenCalledOnce();
    // Saved: the "not saved" notice goes away.
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it("the unsaved link notice goes away after removing the old link and when switching tabs", () => {
    renderModal({ externalUrl: drive }, "Module 1", true);
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    fireEvent.change(linkField(), { target: { value: vimeo } });
    fireEvent.blur(linkField());
    declineReplace();
    expect(screen.getByRole("status")).toHaveTextContent("Link not saved. The old link stays.");

    fireEvent.click(screen.getByRole("button", { name: "Remove old link" }));
    clickConfirm(screen.getByRole("dialog", { name: "Remove this link?" }), "Remove old link");
    expect(screen.getByRole("status")).toHaveTextContent("Old link removed.");
    fireEvent.click(screen.getByRole("tab", { name: /^Description/ }));
    fireEvent.click(screen.getByRole("tab", { name: /^Video/ }));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  // The swap only touched the screen: with the target media already saved, the learner
  // kept seeing the old source.
  it("with an upload and a link saved, swapping saves the source and the learner sees the swap, deleting nothing", () => {
    currentAssets = [videoAsset()];
    const { onUpdateLesson, lesson } = renderModal(
      { videoSource: "youtube", externalUrl: youtube, durationMinutes: 12, contentText: "body" },
      "Module 1",
      true,
    );
    const saved = () =>
      Object.assign({}, lesson, ...onUpdateLesson.mock.calls.map(([patch]) => patch)) as TeacherLesson;
    // The same calculation as the members area player (enrolled-course-workspace).
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

  it("without the target media, swapping stays on the screen only until a link or an upload", () => {
    const { onUpdateLesson, unmount } = renderModal({ videoSource: "youtube", externalUrl: youtube });
    fireEvent.click(screen.getByRole("button", { name: "Replace with upload" }));
    expect(onUpdateLesson).not.toHaveBeenCalled();
    unmount();

    currentAssets = [videoAsset()];
    const second = renderModal({ videoSource: "upload" });
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    expect(second.onUpdateLesson).not.toHaveBeenCalled();
  });

  // The mode was re-derived from the saved data on every render: deleting the link
  // sent the tab back to upload and removed the field the teacher was typing in.
  it("deleting the link of a YouTube lesson keeps the field on the screen", () => {
    const { onUpdateLesson } = renderModal({ videoSource: "youtube", externalUrl: youtube }, "Module 1", true);
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

  // Esc and clicking outside unmount the field without a blur that reaches React 19: the
  // typed, never-blurred link was lost on close.
  it("Esc and clicking outside save the typed link before closing", () => {
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

  // The public course page only reads "upload" from the saved source: with the source as
  // null, the free preview video vanished from the sales page.
  it("deleting the link with a saved upload saves the source as the upload, not null", () => {
    currentAssets = [videoAsset()];
    const { onUpdateLesson, lesson } = renderModal({ videoSource: "youtube", externalUrl: youtube }, "Module 1", true);

    fireEvent.change(linkField(), { target: { value: "" } });
    fireEvent.blur(linkField());

    expect(onUpdateLesson).toHaveBeenCalledExactlyOnceWith({ externalUrl: null, videoSource: "upload" });
    const saved = { ...lesson, ...onUpdateLesson.mock.calls[0][0] } as TeacherLesson;
    // The same calculation as the preview on the sales page (creator-course-detail).
    expect(resolveLessonVideoSource({
      declared: saved.videoSource,
      hasVideoAsset: saved.videoSource === "upload",
      hasTrustedEmbed: false,
    })).toBe("upload");
    expect(deleteCourseAsset).not.toHaveBeenCalled();
  });

  // Closing silently lost the link: declined, or with the swap unconfirmed.
  it("Esc with a declined link leaves the studio open and shows the error", () => {
    const { onUpdateLesson, onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    fireEvent.change(linkField(), { target: { value: "https://example.test/v.mp4" } });

    fireEvent.keyDown(linkField(), { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Only YouTube and Vimeo video links are accepted.");
    expect(onUpdateLesson).not.toHaveBeenCalled();
  });

  it("Esc and Cancel on the confirmation leave the studio open; the next Esc closes", () => {
    const { onUpdateLesson, onClose } = renderModal({ externalUrl: drive }, "Module 1", true);
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    fireEvent.change(linkField(), { target: { value: vimeo } });

    // The Esc that opened the question comes out canceled (preventDefault): in the browser,
    // without it, the same Esc closed the freshly opened dialog.
    expect(fireEvent.keyDown(linkField(), { key: "Escape" })).toBe(false);
    expect(replaceAsk()).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(onUpdateLesson).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    // With the question open, Esc belongs to it: the studio does not close underneath.
    fireEvent.keyDown(linkField(), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    declineReplace();
    expect(replaceAsk()).toBeNull();
    expect(onUpdateLesson).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Link not saved. The old link stays.");

    // The field went back to the saved value: nothing left to lose, the next Esc closes.
    fireEvent.keyDown(linkField(), { key: "Escape" });
    expect(replaceAsk()).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  // Before the files arrive, primaryVideo is null: deleting the link saved
  // the source as null even with an upload saved.
  it("before the lesson files arrive, the link is read-only and deleting saves nothing", () => {
    subscribeOutcome = "wait";
    currentAssets = [videoAsset()];
    const { onUpdateLesson } = renderModal({ videoSource: "youtube", externalUrl: youtube }, "Module 1", true);

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

  it("if the lesson files do not load, the link stays read-only with the load error", () => {
    subscribeOutcome = "fail";
    const { onUpdateLesson } = renderModal({ videoSource: "youtube", externalUrl: youtube });

    expect(linkField()).toHaveAttribute("readonly");
    expect(screen.getByText("We could not load lesson assets.")).toBeInTheDocument();
    fireEvent.change(linkField(), { target: { value: "" } });
    fireEvent.blur(linkField());
    expect(onUpdateLesson).not.toHaveBeenCalled();
  });

  // resetUploadState cleared the load error: after "Replace with link" or
  // a tab switch, the notice went back to "Loading..." forever.
  it("the load error stays on screen after switching mode and tab", () => {
    subscribeOutcome = "fail";
    const { onUpdateLesson } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    fireEvent.click(screen.getByRole("tab", { name: /^Description/ }));
    fireEvent.click(screen.getByRole("tab", { name: /^Video/ }));

    expect(linkField()).toHaveAttribute("readonly");
    expect(screen.getByText("We could not load lesson assets.")).toBeInTheDocument();
    expect(screen.queryByText("Loading this lesson's files...")).not.toBeInTheDocument();
    expect(onUpdateLesson).not.toHaveBeenCalled();
  });

  // "Replace with upload" before the files arrived did not save the source: the
  // studio showed the upload and the learner kept the link.
  it("Replace with upload before the load saves the source as the upload when the files arrive", () => {
    subscribeOutcome = "wait";
    currentAssets = [videoAsset()];
    const { onUpdateLesson, lesson } = renderModal({ videoSource: "youtube", externalUrl: youtube }, "Module 1", true);

    fireEvent.click(screen.getByRole("button", { name: "Replace with upload" }));
    expect(onUpdateLesson).not.toHaveBeenCalled();

    act(() => emitAssets(currentAssets));
    expect(onUpdateLesson).toHaveBeenCalledExactlyOnceWith({ videoSource: "upload" });
    const saved = { ...lesson, ...onUpdateLesson.mock.calls[0][0] } as TeacherLesson;
    expect(saved.externalUrl).toBe(youtube);
    // The same calculation as the members area player (enrolled-course-workspace).
    expect(resolveLessonVideoSource({ declared: saved.videoSource, hasVideoAsset: true, hasTrustedEmbed: true }))
      .toBe("upload");
    expect(deleteCourseAsset).not.toHaveBeenCalled();
  });

  it("if the load fails, or the teacher goes back to the link, choosing the upload saves nothing", () => {
    subscribeOutcome = "fail";
    currentAssets = [videoAsset()];
    const failed = renderModal({ videoSource: "youtube", externalUrl: youtube });
    fireEvent.click(screen.getByRole("button", { name: "Replace with upload" }));
    expect(failed.onUpdateLesson).not.toHaveBeenCalled();
    failed.unmount();

    subscribeOutcome = "wait";
    const back = renderModal({ videoSource: "youtube", externalUrl: youtube }, "Module 1", true);
    fireEvent.click(screen.getByRole("button", { name: "Replace with upload" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    act(() => emitAssets(currentAssets));
    expect(back.onUpdateLesson).not.toHaveBeenCalled();
  });

  // Before the load, link mode is just the screen's plan B. "Replace with upload" and
  // then "Replace with link" saved "youtube" and took the learner off the upload.
  it("going back and forth upload/link before the load does not take the learner off the upload", () => {
    subscribeOutcome = "wait";
    currentAssets = [videoAsset()];
    const { onUpdateLesson } = renderModal({ videoSource: "upload", externalUrl: youtube }, "Module 1", true);

    fireEvent.click(screen.getByRole("button", { name: "Replace with upload" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    expect(onUpdateLesson).not.toHaveBeenCalled();

    act(() => emitAssets(currentAssets));
    expect(onUpdateLesson).not.toHaveBeenCalled();
    // The learner stays on the upload: the preview shows the file, not the embed.
    expect(screen.getByTestId("storage-preview")).toBeInTheDocument();
    expect(screen.queryByTestId("embed-preview")).not.toBeInTheDocument();
  });

  // After a good load, a realtime reload that failed
  // left the alert pinned beside a list that stayed on screen.
  it("a good load followed by a reload that fails does not show a load alert", () => {
    currentAssets = [videoAsset()];
    renderModal({ videoSource: "upload" });
    expect(screen.getByRole("button", { name: "Upload file" })).toBeInTheDocument();

    act(() => emitLoadError(new Error("reload-failed")));

    expect(screen.queryByText("We could not load lesson assets.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("the load error is announced: in the link field, tied to it, and in upload mode", () => {
    subscribeOutcome = "fail";
    const linkMode = renderModal({ videoSource: "youtube", externalUrl: youtube });
    const hint = screen.getByText("We could not load lesson assets.");
    expect(hint).toHaveAttribute("role", "status");
    expect(linkField()).toHaveAccessibleDescription(/^We could not load lesson assets\. YouTube and Vimeo videos/);
    linkMode.unmount();

    // With no link, the tab opens in upload mode: the notice shows up there too.
    renderModal();
    expect(screen.getByRole("status")).toHaveTextContent("We could not load lesson assets.");
  });

  // F-11: the list failure was a dead end (only the sentence). "Try again" re-reads
  // through the same reload; focus stays in the dialog when the button goes away.
  it("the load error has Try again, which reads the files again", async () => {
    subscribeOutcome = "fail";
    reloadServesCurrentAssets = true;
    currentAssets = [videoAsset()];
    try {
      renderModal();
      expect(screen.getByRole("status")).toHaveTextContent("We could not load lesson assets.");
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(screen.queryByText("We could not load lesson assets.")).not.toBeInTheDocument());
      expect(screen.queryByRole("button", { name: /Try again|Trying again/ })).toBeNull();
      expect(screen.getByRole("dialog")).toHaveFocus();
      expect(subscribed).toHaveBeenCalledTimes(1);
    } finally {
      reloadServesCurrentAssets = false;
    }
  });
});

describe("LessonContentModal — video tab", () => {
  let restoreDialogs = () => {};
  beforeEach(() => {
    currentAssets = [];
    bunnyConfig.isBunnyConfigured = false;
    vi.clearAllMocks();
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn((file: File) => `blob:local-${file.name}`);
      static revokeObjectURL = vi.fn();
    });
    restoreDialogs = stubDialogs();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreDialogs();
  });

  // Removing the old link in the middle of an upload made the focused button vanish and focus
  // fell to the body (the swap button is disabled); the notice was never announced.
  it("during an upload, Remove old link is disabled", async () => {
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
    // One video per lesson: with the upload on screen, the link field does not appear.
    expect(screen.queryByLabelText("YouTube or Vimeo URL")).not.toBeInTheDocument();
    expect(form.compareDocumentPosition(screen.getByRole("button", { name: "Replace with link" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(onUpdateLesson).not.toHaveBeenCalled();
    expect(uploadCourseAsset).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: /^Video/ })).toHaveTextContent("Selected");

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
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-lesson.mp4");
  });

  // The owner's complaint: on upload, a huge block took over the screen (a
  // 1,453 px button, a full-width preview). During the upload the card keeps the name,
  // progress, a bar and Cancel; the tabs say why they are locked.
  it("during the upload the card is compact and the sentence explains the locked tabs", async () => {
    let finish!: () => void;
    uploadCourseAsset.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderModal();
    chooseVideoFile("my lesson.mp4");
    const videoTab = screen.getByRole("tab", { name: /^Video/ });
    // Half full (shape, not just color) and the word in the title for mouse users.
    expect(videoTab.querySelector(".lesson-modal__tab-dot")).toHaveAttribute("data-tone", "busy");
    expect(videoTab.querySelector(".lesson-modal__tab-dot")).toHaveAttribute("title", "Selected");
    expect(screen.queryByText("Tabs unlock when the upload finishes.")).not.toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Upload file" });
    act(() => submit.focus());
    fireEvent.click(submit);

    const progress = await screen.findByRole("progressbar", { name: "Uploading..." });
    const form = progress.closest("form")!;
    // The focused button goes away: with no Cancel on this upload, focus goes to the progress.
    expect(within(form).getByRole("status")).toHaveFocus();
    expect(within(form).getByText(/my lesson\.mp4/)).toBeInTheDocument();
    expect(within(form).getAllByRole("progressbar")).toHaveLength(1);
    // The upload button only repeated "Uploading...": it leaves the view, the field stays mounted.
    expect(within(form).queryByRole("button", { name: "Uploading..." })).not.toBeInTheDocument();
    expect(within(form).queryByRole("combobox", { name: "Video type" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Lesson video")).toBeInTheDocument();
    expect(screen.getByText("Tabs unlock when the upload finishes.")).toBeInTheDocument();
    // The tab label no longer changes its visible word (or its width).
    expect(within(videoTab).queryByText("Uploading...")?.className).toBe("sr-only");

    await act(async () => { finish(); });
    expect(screen.queryByText("Tabs unlock when the upload finishes.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload file" })).toBeVisible();
    // With no new file the upload stays off: focus goes back to the file field.
    expect(screen.getByLabelText("Lesson video")).toHaveFocus();
  });

  // F-04: the footer button says "Uploading..." while the file goes up, but
  // both labels sit in the same cell: the width does not change, and the name is
  // always the one in view.
  it("the footer button says Uploading... during the upload without changing width", async () => {
    let finish!: () => void;
    uploadCourseAsset.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderModal();
    const footer = document.querySelector(".lesson-modal__footer") as HTMLElement;
    const done = within(footer).getByRole("button", { name: "Done" });
    expect(within(done).getByText("Uploading...")).toHaveAttribute("aria-hidden", "true");
    chooseVideoFile();
    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));

    const busy = await within(footer).findByRole("button", { name: "Uploading..." });
    expect(busy).toBe(done);
    expect(busy).toBeDisabled();
    expect(within(busy).getByText("Done")).toHaveAttribute("aria-hidden", "true");
    expect(within(footer).queryByRole("button", { name: "Done" })).toBeNull();

    await act(async () => { finish(); });
    expect(within(footer).getByRole("button", { name: "Done" })).toBe(done);
    expect(done).toBeEnabled();
  });

  // The Delete in the file list waits without changing width: both faces
  // in the same cell. Only after the gray uppercase rule of the list moved from
  // `.lesson-modal-assets span` to `.lesson-modal-assets__meta` (globals.css),
  // otherwise each face became a gray block and the two stacked.
  it("the Delete in the file list keeps both labels in the same cell and is named by what is in view", async () => {
    currentAssets = [videoAsset()];
    let finish!: () => void;
    deleteCourseAsset.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderModal();
    const list = document.querySelector(".lesson-modal-assets") as HTMLElement;
    const remove = within(list).getByRole("button", { name: "Delete" });
    const idle = within(remove).getByText("Delete");
    const waiting = within(remove).getByText("Deleting...");
    expect(waiting).toHaveAttribute("aria-hidden", "true");
    expect(idle.parentElement).toBe(waiting.parentElement);
    expect(idle.parentElement).toHaveClass("inline-grid");
    // No span in the button carries the detail-line class.
    expect(remove.querySelector(".lesson-modal-assets__meta")).toBeNull();

    fireEvent.click(remove);
    clickConfirm(screen.getByRole("dialog", { name: "Delete this file?" }), "Delete file");

    const busy = await within(list).findByRole("button", { name: "Deleting..." });
    expect(busy).toBe(remove);
    expect(busy).toBeDisabled();
    expect(within(busy).getByText("Delete")).toHaveAttribute("aria-hidden", "true");

    await act(async () => { finish(); });
  });

  // The detail line (type and size) keeps the class that carries the
  // gray uppercase; the spans outside it do not.
  it("the file detail line carries lesson-modal-assets__meta", () => {
    currentAssets = [videoAsset()];
    renderModal();
    const list = document.querySelector(".lesson-modal-assets") as HTMLElement;
    const meta = Array.from(list.querySelectorAll("span")).filter((span) => span.classList.contains("lesson-modal-assets__meta"));
    expect(meta).toHaveLength(1);
    expect(meta[0].textContent).toMatch(/ - /);
  });

  // On the materials tab the name is editable: the three lines the old rule
  // painted (name label, type and size, original name) carry the class.
  it("on the materials tab, with an edited name, the three detail lines carry lesson-modal-assets__meta", () => {
    currentAssets = [videoAsset({
      id: "material-1", kind: "lesson_material", contentType: "application/pdf", fileName: "handout.pdf", title: "Final handout",
    })];
    renderModal({}, "Module 1", true);
    fireEvent.click(screen.getByRole("tab", { name: /^Materials/ }));
    const list = document.querySelector(".lesson-modal-assets") as HTMLElement;
    const meta = Array.from(list.querySelectorAll(".lesson-modal-assets__meta")).map((node) => node.textContent);
    expect(meta).toHaveLength(3);
    expect(meta[0]).toBe("Name students see");
    expect(meta[1]).toMatch(/ - /);
    expect(meta[2]).toBe("File: handout.pdf");
    expect(within(list).getByRole("button", { name: "Delete" }).querySelector(".lesson-modal-assets__meta")).toBeNull();
  });

  // Read as text (jsdom does not apply globals.css): no rule in the list
  // reaches an arbitrary span, and the block-level gray uppercase stays in the class.
  it("globals.css paints only the detail line of the list, not every span", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8")
      .replace(/\r\n/g, "\n")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = Array.from(css.matchAll(/([^{}]*\.lesson-modal-assets[^{}]*)\{/g))
      .flatMap((match) => match[1].split(","))
      .map((selector) => selector.trim());
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector, selector).not.toMatch(/(^|[\s>+~])span(?![\w-])/);
    }
    expect(css).toMatch(/\.lesson-modal-assets strong,\s*\.lesson-modal-assets__meta\s*\{\s*display: block;\s*\}/);
    // The rule itself (not the group one above, which comes after a comma).
    const meta = css.match(/\}\s*\.lesson-modal-assets__meta \{([^}]*)\}/)?.[1];
    expect(meta).toMatch(/color: var\(--color-ink-soft\);[\s\S]*font-size: 0\.6875rem;[\s\S]*text-transform: uppercase;/);
  });

  it("focus goes to Cancel when the upload starts and back to the field when it is canceled", async () => {
    bunnyConfig.isBunnyConfigured = true;
    const { CourseAssetUploadCancelled } = await import("@/lib/data/course-assets");
    let fail!: (error: Error) => void;
    const cancel = vi.fn(() => fail(new CourseAssetUploadCancelled()));
    uploadLessonVideoToBunny.mockImplementationOnce((input) => {
      (input as { onCancelAvailable: (cancel: () => void) => void }).onCancelAvailable(cancel);
      return new Promise<void>((_resolve, reject) => { fail = reject; });
    });
    renderModal();
    chooseVideoFile();
    const submit = screen.getByRole("button", { name: "Upload file" });
    act(() => submit.focus());
    fireEvent.click(submit);

    const cancelButton = await screen.findByRole("button", { name: "Cancel upload" });
    expect(cancelButton).toHaveFocus();
    await act(async () => { fireEvent.click(cancelButton); });
    expect(cancel).toHaveBeenCalledOnce();
    // Lesson with no video: the card goes away and the drop area comes back, with focus on it.
    await waitFor(() => expect(screen.getByLabelText("Upload a lesson video")).toHaveFocus());
  });

  it("on a lesson with a video, canceling returns focus to the card's file field", async () => {
    currentAssets = [videoAsset()];
    bunnyConfig.isBunnyConfigured = true;
    const { CourseAssetUploadCancelled } = await import("@/lib/data/course-assets");
    let fail!: (error: Error) => void;
    uploadLessonVideoToBunny.mockImplementationOnce((input) => {
      (input as { onCancelAvailable: (cancel: () => void) => void }).onCancelAvailable(() => fail(new CourseAssetUploadCancelled()));
      return new Promise<void>((_resolve, reject) => { fail = reject; });
    });
    renderModal({ videoSource: "upload" });
    fireEvent.change(screen.getByLabelText("Lesson video"), {
      target: { files: [new File(["video"], "new.mp4", { type: "video/mp4" })] },
    });
    const submit = screen.getByRole("button", { name: "Upload file" });
    act(() => submit.focus());
    fireEvent.click(submit);
    const cancelButton = await screen.findByRole("button", { name: "Cancel upload" });
    expect(cancelButton).toHaveFocus();
    await act(async () => { fireEvent.click(cancelButton); });
    await waitFor(() => expect(screen.getByLabelText("Lesson video")).toHaveFocus());
  });

  // The Settings tab said "Preview" or "Private"; without the mark, only whoever opened the
  // tab knew the lesson is open to the public.
  it.each([[true, "Preview", "on"], [false, "Private", "off"]] as const)(
    "the Settings tab shows whether the lesson is a free preview (%s)",
    (isFreePreview, label, tone) => {
      renderModal({}, "Module 1", false, "instant", isFreePreview);
      const settings = screen.getByRole("tab", { name: /^Settings/ });
      // The screen reader hears the state along with the tab name.
      expect(settings).toHaveAccessibleName(new RegExp(`${label}$`));
      const mark = settings.querySelector(".lesson-modal__tab-dot");
      expect(mark).toHaveAttribute("data-tone", tone);
      expect(mark).toHaveAttribute("title", label);
    },
  );

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
      const { onUpdateLesson } = renderModal({ externalUrl: url }, "Module $& intact", true);
      fireEvent.click(screen.getByRole("tab", { name: /^Description/ }));
      fireEvent.change(screen.getByLabelText("Lesson title"), { target: { value: "Café title $& intact" } });
      fireEvent.change(screen.getByPlaceholderText("Explain what the student is about to learn and why it matters."), {
        target: { value: "Authorial description — do not translate" },
      });
      fireEvent.click(screen.getByRole("tab", { name: /^Video/ }));
      // The lesson has a YouTube link: the tab opens on the link, and the upload is an explicit swap.
      fireEvent.click(screen.getByRole("button", { name: "Replace with upload" }));
      const file = chooseVideoFile("Lesson $& — café.mp4");
      const fileInput = screen.getByLabelText("Lesson video");
      fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
      await screen.findByText("50% - 512 B of 1.0 KB");
      const updatesBeforeLanguage = onUpdateLesson.mock.calls.length;

      fireEvent.click(screen.getByRole("button", { name: "Change language" }));
      expect(screen.getByText("50% - 512 B de 1.0 KB")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Cancelar subida" })).toBeEnabled();
      expect(screen.getByLabelText("Video de la lección")).toBe(fileInput);
      expect(screen.getByText(/Lesson \$& — café\.mp4/)).toBeInTheDocument();
      // The saved link was never touched by the swap or by the upload.
      expect(onUpdateLesson).not.toHaveBeenCalledWith(expect.objectContaining({ externalUrl: expect.anything() }));
      for (const name of [/^Video/, /^Descripción/, /^Materiales/, /^Ajustes/]) {
        expect(screen.getByRole("tab", { name })).toBeDisabled();
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
      await waitFor(() => expect(screen.getByRole("tab", { name: /^Descripción/ })).toBeEnabled());
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
      fireEvent.click(screen.getByRole("tab", { name: /^Description/ }));
      expect(screen.getByLabelText("Lesson title")).toHaveValue("Café title $& intact");
      expect(screen.getByDisplayValue("Authorial description — do not translate")).toBeInTheDocument();
      expect(subscribed).toHaveBeenCalledOnce();
      expect(uploadLessonVideoToBunny).toHaveBeenCalledOnce();
      if (outcome !== "success") expect(onUpdateLesson).toHaveBeenCalledTimes(updatesBeforeLanguage);
    },
  );

  it("translates a displayed validation error while preserving the literal filename", () => {
    bunnyConfig.isBunnyConfigured = true;
    renderModal({}, "Module 1", true);
    const file = new File(["notes"], "Material $& <authored>.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Upload a lesson video"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
    expect(screen.getByText('"Material $& <authored>.pdf" is not a video file. Use MP4, MOV or WebM.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByText('"Material $& <authored>.pdf" no es un archivo de video. Usa MP4, MOV o WebM.')).toBeInTheDocument();
    expect(uploadLessonVideoToBunny).not.toHaveBeenCalled();
    expect(uploadCourseAsset).not.toHaveBeenCalled();
  });

  it("the uploaded material appears in the list without waiting for a Realtime event", async () => {
    // course_assets is not in the Realtime publication: no emitAssets here,
    // only the reload the studio itself asks for after the upload.
    reloadServesCurrentAssets = true;
    uploadCourseAsset.mockImplementationOnce(async () => {
      currentAssets = [videoAsset({
        id: "material-1", kind: "lesson_material", contentType: "application/pdf", fileName: "handout.pdf",
      })];
    });
    try {
      renderModal({}, "Module 1", true);
      fireEvent.click(screen.getByRole("tab", { name: /^Materials/ }));
      expect(screen.queryByText("handout.pdf")).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Lesson material"), {
        target: { files: [new File(["pdf"], "handout.pdf", { type: "application/pdf" })] },
      });
      fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
      // The material name is now an editable field (the name the learner sees).
      expect(await screen.findByDisplayValue("handout.pdf")).toBeInTheDocument();
    } finally {
      reloadServesCurrentAssets = false;
    }
  });

  it("localizes materials and settings while preserving lesson values, type codes and authored placeholders", () => {
    currentAssets = [videoAsset({
      kind: "lesson_thumbnail", contentType: "image/png", fileName: "Thumbnail $&.png",
      downloadUrl: "https://example.supabase.co/storage/v1/object/public/public-media/thumbnail.png",
    })];
    const { onUpdateLesson } = renderModal({ type: "external_embed", durationMinutes: 12, dripDelayDays: 7 }, "Module $& {lessonIndex}", true, "time_drip_custom");
    fireEvent.click(screen.getByRole("tab", { name: /^Settings/ }));
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("tab", { name: /^Ajustes/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByLabelText("Tipo de lección")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Duración en minutos")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("7")).toBeInTheDocument();
    expect(screen.getByText("Módulo 1 - Module $& {lessonIndex} / Lección 1")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Usar esta lección como vista previa gratuita" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("tab", { name: /^Descripción/ }));
    expect(screen.getByRole("img", { name: "Miniatura de la lección: Thumbnail $&.png" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /^Materiales/ }));
    expect(screen.getByLabelText("Material de la lección")).toBeInTheDocument();
    expect(screen.getByText("Todavía no hay materiales complementarios.")).toBeInTheDocument();
    expect(onUpdateLesson).not.toHaveBeenCalled();
  });

  it("keeps full lesson identity in the content scroll, upload first and preview before guidance", () => {
    const title = "How to prepare a lesson with a full title that needs to stay readable on a small screen";
    const moduleTitle = "Planning and preparation of all the steps of the first module";
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

    fireEvent.click(screen.getByRole("tab", { name: /^Description/ }));
    expect(dialog).toHaveAccessibleName(title);
    expect(body).toContainElement(screen.getByRole("heading", { name: title }));
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.getByText("Uploads save immediately. Text and settings save with the course draft.")).toBeInTheDocument();
  });

  // Audit finding P-01: without this test, removing what opens the panel
  // leaves the teacher with no path to upload a video, and the suite stays
  // green. The upload form is the only door — Materials and Settings create
  // lesson_material and lesson_thumbnail, never the lesson video.
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

    // One video per lesson: the upload appears through the explicit swap.
    fireEvent.click(screen.getByRole("button", { name: "Replace with upload" }));
    chooseVideoFile();

    expect(
      screen.getByRole("button", { name: /upload file/i }),
    ).toBeInTheDocument();
  });

  // Choosing the file must not save the source: that is what left the lesson empty
  // for someone who had already paid when the teacher gave up on the upload.
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
    fireEvent.click(screen.getByRole("tab", { name: /^Description/ }));
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
        fireEvent.click(screen.getByRole("tab", { name }));
        expect(progress).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Cancel upload" })).toBeEnabled();
        expect(screen.getByRole("tab", { name })).toBeDisabled();
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
        expect(screen.getByRole("tab", { name: /^Description/ })).toBeEnabled();
      });
      expect(screen.queryByRole("button", { name: "Cancel upload" })).not.toBeInTheDocument();
      if (outcome === "success") {
        expect(onUpdateLesson).toHaveBeenCalledWith({ videoSource: "upload" });
      } else {
        expect(onUpdateLesson).not.toHaveBeenCalled();
      }
      fireEvent.click(screen.getByRole("tab", { name: /^Description/ }));
      expect(screen.getByLabelText("Lesson title")).toBeInTheDocument();
    },
  );

  // The same hole coming in through the back door: deleting the last video
  // left `videoSource` promising a file that no longer exists.
  it("clears the declared upload source when the last video asset is deleted", async () => {
    currentAssets = [videoAsset()];

    const { onUpdateLesson } = renderModal({
      videoSource: "upload",
      externalUrl: "https://www.youtube.com/watch?v=abc",
    });

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    // Nothing goes out before the confirm in the dialog; confirming deletes once.
    const asking = screen.getByRole("dialog", { name: "Delete this file?" });
    expect(deleteCourseAsset).not.toHaveBeenCalled();
    clickConfirm(asking, "Delete file");

    await waitFor(() => {
      expect(deleteCourseAsset).toHaveBeenCalledTimes(1);
    });

    expect(onUpdateLesson).toHaveBeenCalledWith({ videoSource: null });
  });

  it("keeps the source when another video asset survives the delete", async () => {
    currentAssets = [videoAsset(), videoAsset({ id: "asset-2" })];

    const { onUpdateLesson } = renderModal({ videoSource: "upload" });

    fireEvent.click(screen.getAllByRole("button", { name: /delete/i })[0]);
    clickConfirm(screen.getByRole("dialog", { name: "Delete this file?" }), "Delete file");

    await waitFor(() => {
      expect(deleteCourseAsset).toHaveBeenCalledTimes(1);
    });

    expect(onUpdateLesson).not.toHaveBeenCalled();
  });

  // Without Bunny, the video goes to Supabase Storage, whose plan ceiling is
  // ~50 MB. The validator refuses before any byte leaves — this is the only
  // size-refusal path here; a second, unreachable branch was
  // removed. If the validator goes back to accepting the bucket ceiling (500 MB), the
  // file reaches the upload and this test turns red.
  it("refuses a video above the plan ceiling before uploading", async () => {
    renderModal();

    const big = new File(["video-bytes"], "lesson.mp4", { type: "video/mp4" });
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
describe("LessonContentModal — processing on Bunny", () => {
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
    const { onUpdateLesson } = renderModal({ videoSource: "upload", durationMinutes: 1 }, "Module 1", true);

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

  it("keeps polling after a 429, like after a 5xx", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });
    fetchMock.mockResolvedValue({
      ok: true, status: 200, json: async () => ({ status: 4, encodeProgress: 100, lengthSeconds: 60 }),
    });
    const { onUpdateLesson } = renderModal({ videoSource: "upload" });

    await flush();
    expect(fetchMock).toHaveBeenCalledOnce();
    await tenSeconds();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(onUpdateLesson).toHaveBeenCalledExactlyOnceWith({ durationMinutes: 1 });
  });

  // 7 (JIT segmenting) does not play yet: only 4 and 8 are ready.
  it("treats status 7 as still processing and keeps polling until 8", async () => {
    replyWith(
      { status: 7, encodeProgress: 60, lengthSeconds: 90 },
      { status: 8, encodeProgress: 100, lengthSeconds: 90 },
    );
    const { onUpdateLesson } = renderModal({ videoSource: "upload" });

    await flush();
    expect(screen.getByText("Processing 60%")).toBeInTheDocument();
    expect(onUpdateLesson).not.toHaveBeenCalled();
    await tenSeconds();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(onUpdateLesson).toHaveBeenCalledExactlyOnceWith({ durationMinutes: 2 });
    await tenSeconds();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps polling while ready without a length, and writes the duration when it arrives", async () => {
    replyWith(
      { status: 4, encodeProgress: 100, lengthSeconds: null },
      { status: 4, encodeProgress: 100, lengthSeconds: 0 },
      { status: 4, encodeProgress: 100, lengthSeconds: 200 },
    );
    const { onUpdateLesson } = renderModal({ videoSource: "upload" });

    await flush();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    await tenSeconds();
    expect(onUpdateLesson).not.toHaveBeenCalled();
    await tenSeconds();
    expect(onUpdateLesson).toHaveBeenCalledExactlyOnceWith({ durationMinutes: 4 });
    await tenSeconds();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops asking for a missing length after 30 more polls", async () => {
    replyWith({ status: 4, encodeProgress: 100, lengthSeconds: null });
    const { onUpdateLesson } = renderModal({ videoSource: "upload" });

    await flush();
    for (let poll = 0; poll < 40; poll += 1) {
      await tenSeconds();
    }
    expect(fetchMock).toHaveBeenCalledTimes(31);
    expect(onUpdateLesson).not.toHaveBeenCalled();
  });

  // A rotated key or a Bunny outage answered 503 forever: the studio polled
  // every 10 s with no end.
  it("stops after 30 retries in a row on 5xx or 429 and says to reopen the lesson", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const { onUpdateLesson } = renderModal({ videoSource: "upload" });

    await flush();
    for (let poll = 0; poll < 40; poll += 1) {
      await tenSeconds();
    }
    expect(fetchMock).toHaveBeenCalledTimes(31);
    expect(screen.getByText("Status unavailable, reopen the lesson to check again")).toBeInTheDocument();
    expect(onUpdateLesson).not.toHaveBeenCalled();
  });

  it("an answer between failures resets the retry count", async () => {
    fetchMock.mockReset();
    const failure = { ok: false, status: 429, json: async () => ({}) };
    const answer = (status: number, lengthSeconds: number | null) => ({
      ok: true, status: 200, json: async () => ({ status, encodeProgress: 50, lengthSeconds }),
    });
    for (let call = 0; call < 29; call += 1) fetchMock.mockResolvedValueOnce(failure);
    fetchMock.mockResolvedValueOnce(answer(3, null));
    for (let call = 0; call < 29; call += 1) fetchMock.mockResolvedValueOnce(failure);
    fetchMock.mockResolvedValue(answer(4, 60));
    renderModal({ videoSource: "upload" });

    await flush();
    for (let poll = 0; poll < 60; poll += 1) {
      await tenSeconds();
    }
    expect(fetchMock).toHaveBeenCalledTimes(60);
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.queryByText("Status unavailable, reopen the lesson to check again")).not.toBeInTheDocument();
  });

  it("stops at once when the route answers 404 (video deleted on Bunny)", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    renderModal({ videoSource: "upload" });

    await flush();
    await tenSeconds();
    await tenSeconds();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not poll for a video that is not on Bunny", async () => {
    currentAssets = [videoAsset()];
    renderModal({ videoSource: "upload" });

    await flush();
    await tenSeconds();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
